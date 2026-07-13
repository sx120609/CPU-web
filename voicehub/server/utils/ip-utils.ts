import type { H3Event } from 'h3'
import { getHeaders } from 'h3'
import { isIP } from 'node:net'

const DEFAULT_EXCLUDED_CLIENT_IPS = ['202.119.186.117']

function createIPSet(values: string[]): Set<string> {
  return new Set(values.map((v) => normalizeIP(v)).filter((v): v is string => Boolean(v)))
}

const TRUSTED_PROXY_IPS = createIPSet((process.env.TRUSTED_PROXY_IPS || '').split(','))
const EXCLUDED_CLIENT_IPS = createIPSet([
  ...DEFAULT_EXCLUDED_CLIENT_IPS,
  ...(process.env.EXCLUDED_CLIENT_IPS || '').split(',')
])

function normalizeIP(raw: string | undefined | null): string | null {
  if (!raw) return null
  let value = raw.trim()
  if (!value) return null

  // RFC7239 Forwarded: for=1.2.3.4;proto=https
  if (value.toLowerCase().startsWith('for=')) {
    value = value.slice(4).trim()
  }

  // 去掉参数部分（;proto=...）
  if (value.includes(';')) {
    value = value.split(';')[0].trim()
  }

  // 去掉包裹引号
  value = value.replace(/^"+|"+$/g, '')

  // IPv6 带中括号: [2001:db8::1]:443
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    if (end > 1) {
      value = value.slice(1, end)
    }
  } else {
    // IPv4:port
    const colonCount = (value.match(/:/g) || []).length
    if (colonCount === 1 && value.includes('.')) {
      value = value.split(':')[0].trim()
    }
  }

  // IPv4-mapped IPv6
  value = value.replace(/^::ffff:/i, '')

  if (!isIP(value)) return null
  return value
}

function parseIPList(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((part) => normalizeIP(part))
    .filter((ip): ip is string => Boolean(ip))
}

function parseForwarded(raw: string | undefined): string[] {
  if (!raw) return []
  const ips: string[] = []
  const entries = raw.split(',')
  for (const entry of entries) {
    const segments = entry.split(';')
    for (const seg of segments) {
      const ip = normalizeIP(seg)
      if (ip) {
        ips.push(ip)
      }
    }
  }
  return ips
}

function getHeaderValue(headers: ReturnType<typeof getHeaders>, key: string): string | undefined {
  const value = headers[key]
  return typeof value === 'string' ? value : undefined
}

function dedupeIPs(ips: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const ip of ips) {
    if (seen.has(ip)) continue
    seen.add(ip)
    result.push(ip)
  }
  return result
}

function collectHeaderIPs(headers: ReturnType<typeof getHeaders>): string[] {
  const xForwardedFor = parseIPList(getHeaderValue(headers, 'x-forwarded-for'))
  const forwarded = parseForwarded(getHeaderValue(headers, 'forwarded'))
  const xRealIP = parseIPList(getHeaderValue(headers, 'x-real-ip'))
  const xClientIP = parseIPList(getHeaderValue(headers, 'x-client-ip'))
  const xOriginalForwardedFor = parseIPList(getHeaderValue(headers, 'x-original-forwarded-for'))
  const trueClientIP = parseIPList(getHeaderValue(headers, 'true-client-ip'))
  const cfConnectingIP = parseIPList(getHeaderValue(headers, 'cf-connecting-ip'))
  const xForwarded = parseIPList(getHeaderValue(headers, 'x-forwarded'))
  const forwardedFor = parseIPList(getHeaderValue(headers, 'forwarded-for'))

  return dedupeIPs([
    ...xForwardedFor,
    ...forwarded,
    ...xRealIP,
    ...xClientIP,
    ...xOriginalForwardedFor,
    ...trueClientIP,
    ...cfConnectingIP,
    ...xForwarded,
    ...forwardedFor
  ])
}

function isExcludedIP(ip: string): boolean {
  return EXCLUDED_CLIENT_IPS.has(ip)
}

export function sanitizeStoredClientIP(ip: string | null | undefined): string | null {
  if (!ip) return null
  const raw = String(ip).trim()
  if (!raw || raw.toLowerCase() === 'unknown') return null

  const normalized = normalizeIP(raw)
  if (!normalized) return raw
  if (isExcludedIP(normalized)) return null
  return normalized
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map((n) => Number(n))
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false
  const [a, b] = parts
  if (a === 10) return true
  if (a === 127) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 169 && b === 254) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

function isPrivateIP(ip: string): boolean {
  if (isIP(ip) === 4) return isPrivateIPv4(ip)
  const lower = ip.toLowerCase()
  if (lower === '::1') return true
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true // fc00::/7
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
    return true // fe80::/10
  }
  return false
}

/**
 * 获取客户端真实IP（兼容多层反代）
 * 默认自动识别：
 * 1) 优先使用 X-Forwarded-For / Forwarded 链路中的首个公网IP（通常是客户端）
 * 2) 若无公网IP则使用链路首个有效IP
 * 3) 最后回退到 X-Real-IP / socket.remoteAddress
 *
 * TRUSTED_PROXY_IPS 为可选增强配置，不填也可正常工作。
 */
export function getClientIP(event: H3Event): string {
  const headers = getHeaders(event)

  const socketIP = normalizeIP(event.node.req.socket?.remoteAddress)
  const headerIPs = collectHeaderIPs(headers)

  if (headerIPs.length > 0) {
    // 剔除已知代理IP、显式排除IP、以及当前连接端IP（通常为最近一层代理）
    const filtered = headerIPs.filter(
      (ip) => !TRUSTED_PROXY_IPS.has(ip) && !isExcludedIP(ip) && (!socketIP || ip !== socketIP)
    )

    // 1) 优先使用链路中的首个公网IP
    for (const ip of filtered) {
      if (!isPrivateIP(ip)) return ip
    }

    // 2) 无公网IP时，使用首个可用IP
    if (filtered[0]) return filtered[0]
  }

  // 3) 兜底 socketIP
  if (socketIP && !TRUSTED_PROXY_IPS.has(socketIP) && !isExcludedIP(socketIP)) {
    return socketIP
  }

  return 'unknown'
}

/**
 * 格式化IP地址用于邮件显示
 * @param ip IP地址
 * @returns 格式化后的IP地址字符串
 */
export function formatIPForEmail(ip: string): string {
  if (!ip || ip === 'unknown') {
    return '未知'
  }

  // 如果是本地/内网IP，显示为本地网络
  if (isPrivateIP(ip)) {
    return `${ip} (本地网络)`
  }

  return ip
}
