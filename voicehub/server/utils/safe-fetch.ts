import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { pipeline, type Readable } from 'node:stream'
import zlib from 'node:zlib'

/**
 * 访问调用方提供的外部地址时使用的出站请求守卫（防 SSRF）：
 * - 只允许 http/https，拒绝 URL 内嵌账号密码；
 * - 在建立连接时校验实际使用的解析结果，拒绝回环、私有、链路本地、CGNAT、组播、未指定等地址
 *   （含 IPv4 映射/兼容的 IPv6），因此 DNS 重绑定也无法绕过；
 * - 手动跟随重定向并逐跳重新校验，限制跳数；
 * - 限制响应体大小，超限立即中止。
 */

export class OutboundRequestError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 400) {
    super(message)
    this.name = 'OutboundRequestError'
    this.statusCode = statusCode
  }
}

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_REDIRECTS = 5
export const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024

type IPv4Bytes = [number, number, number, number]
type IPv6Words = [number, number, number, number, number, number, number, number]

const parseIPv4 = (address: string): IPv4Bytes | null => {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  const bytes = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN))
  return bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
    ? (bytes as IPv4Bytes)
    : null
}

const isBlockedIPv4 = ([a, b]: IPv4Bytes) =>
  a === 0 || // 0.0.0.0/8 未指定地址
  a === 10 || // 10.0.0.0/8 私有地址
  a === 127 || // 127.0.0.0/8 回环
  (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT
  (a === 169 && b === 254) || // 169.254.0.0/16 链路本地（含云厂商元数据地址）
  (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 私有地址
  (a === 192 && b === 168) || // 192.168.0.0/16 私有地址
  a >= 224 // 224.0.0.0/4 组播、240.0.0.0/4 保留及广播地址

const parseIPv6 = (input: string): IPv6Words | null => {
  let address = (input.replace(/^\[|\]$/g, '').split('%')[0] || '').toLowerCase()
  if (address.includes('.')) {
    const lastColon = address.lastIndexOf(':')
    const embedded = parseIPv4(address.slice(lastColon + 1))
    if (!embedded) return null
    const [b0, b1, b2, b3] = embedded
    address = `${address.slice(0, lastColon + 1)}${((b0 << 8) | b1).toString(16)}:${((b2 << 8) | b3).toString(16)}`
  }

  const halves = address.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - head.length - tail.length
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null

  const groups = [...head, ...new Array(halves.length === 2 ? missing : 0).fill('0'), ...tail]
  const words = groups.map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : Number.NaN))
  return words.length === 8 && !words.some((word) => Number.isNaN(word)) ? (words as IPv6Words) : null
}

const isBlockedIPv6 = (words: IPv6Words) => {
  const [w0, w1, w2, w3, w4, w5, w6, w7] = words
  const zeroUntil = (end: number) => words.slice(0, end).every((word) => word === 0)

  // ::/96（含 :: 与 ::1）、::ffff:0:0/96（IPv4 映射）、64:ff9b::/96（NAT64）按内嵌 IPv4 判断
  if (
    zeroUntil(6) ||
    (zeroUntil(5) && w5 === 0xffff) ||
    (w0 === 0x64 && w1 === 0xff9b && w2 === 0 && w3 === 0 && w4 === 0 && w5 === 0)
  ) {
    return isBlockedIPv4([w6 >> 8, w6 & 0xff, w7 >> 8, w7 & 0xff])
  }

  // 2002::/16（6to4）内嵌 IPv4
  if (w0 === 0x2002) {
    return isBlockedIPv4([w1 >> 8, w1 & 0xff, w2 >> 8, w2 & 0xff])
  }

  const first = w0
  return (
    (first & 0xfe00) === 0xfc00 || // fc00::/7 唯一本地地址
    (first & 0xffc0) === 0xfe80 || // fe80::/10 链路本地
    (first & 0xffc0) === 0xfec0 || // fec0::/10 站点本地（已废弃）
    (first & 0xff00) === 0xff00 // ff00::/8 组播
  )
}

/** 非公网可路由地址（或无法识别的地址）返回 true。 */
export function isBlockedIpAddress(address: string): boolean {
  const normalized = String(address || '').trim().replace(/^\[|\]$/g, '')
  const family = net.isIP(normalized)
  if (family === 4) {
    const bytes = parseIPv4(normalized)
    return !bytes || isBlockedIPv4(bytes)
  }
  if (family === 6) {
    const words = parseIPv6(normalized)
    return !words || isBlockedIPv6(words)
  }
  return true
}

/** 校验协议、账号信息与 IP 字面量；域名会在建立连接时按实际解析结果校验。 */
export function assertSafeOutboundUrl(input: string | URL): URL {
  let url: URL
  try {
    url = new URL(String(input))
  } catch {
    throw new OutboundRequestError('URL 无效')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new OutboundRequestError('仅支持 http/https 地址')
  }
  if (url.username || url.password) {
    throw new OutboundRequestError('URL 不能包含账号信息')
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (!hostname) {
    throw new OutboundRequestError('URL 缺少主机名')
  }
  if (net.isIP(hostname) && isBlockedIpAddress(hostname)) {
    throw new OutboundRequestError('不允许访问内网或保留地址', 403)
  }
  return url
}

// 连接前校验 DNS 解析出的全部地址，任一地址不可公网路由即拒绝
const guardedLookup = ((hostname: string, options: any, callback: any) => {
  const lookupOptions = typeof options === 'object' && options !== null ? options : {}
  dns.lookup(hostname, { ...lookupOptions, all: true }, (error, addresses) => {
    if (error) {
      callback(error)
      return
    }

    const list = (Array.isArray(addresses) ? addresses : []) as dns.LookupAddress[]
    const [first] = list
    if (!first || list.some((entry) => isBlockedIpAddress(entry.address))) {
      callback(new OutboundRequestError(`目标主机 ${hostname} 解析到内网或保留地址`, 403))
      return
    }

    if (lookupOptions.all) {
      callback(null, list)
    } else {
      callback(null, first.address, first.family)
    }
  })
}) as unknown as net.LookupFunction

// 独立连接池：池中每个连接建立时都经过 guardedLookup 校验
const httpAgent = new http.Agent({ keepAlive: true, timeout: 30_000 })
const httpsAgent = new https.Agent({ keepAlive: true, timeout: 30_000 })

const REQUEST_BODY_HEADERS = new Set([
  'content-type',
  'content-length',
  'content-encoding',
  'content-language',
  'content-location'
])

const createTimeoutError = () => Object.assign(new Error('请求超时'), { name: 'AbortError' })

export interface SafeFetchOptions {
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
  /** 超时时间；未设置 bodyTimeoutMs 时同时覆盖读取响应体的时间 */
  timeoutMs?: number
  /** 收到响应头后读取响应体的超时时间（单独计时） */
  bodyTimeoutMs?: number
  maxRedirects?: number
  /** 响应体（解压后）大小上限，0 表示不限制（仅用于流式转发） */
  maxBytes?: number
}

export interface SafeFetchResponse {
  status: number
  statusText: string
  ok: boolean
  /** 跟随重定向后的最终地址 */
  url: string
  headers: Headers
  /** 已解压的响应体流；通过 buffer()/text() 读取时会执行大小限制 */
  body: Readable
  buffer(): Promise<Buffer>
  text(): Promise<string>
  /** 丢弃响应体并释放连接 */
  discard(): void
}

const requestOnce = (
  url: URL,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  signal: AbortSignal
) =>
  new Promise<http.IncomingMessage>((resolve, reject) => {
    const isHttps = url.protocol === 'https:'
    const requestHeaders: Record<string, string> = { ...headers }
    if (body !== undefined) {
      requestHeaders['Content-Length'] = String(Buffer.byteLength(body))
    }

    const request = (isHttps ? https : http).request(
      url,
      {
        method,
        headers: requestHeaders,
        agent: isHttps ? httpsAgent : httpAgent,
        lookup: guardedLookup,
        signal
      },
      resolve
    )
    request.on('error', reject)
    request.end(body)
  })

const decodeBody = (message: http.IncomingMessage): { stream: Readable; decoded: boolean } => {
  const encoding = String(message.headers['content-encoding'] || '')
    .trim()
    .toLowerCase()
  let decoder: zlib.Gunzip | zlib.Inflate | zlib.BrotliDecompress | null = null

  if (encoding === 'gzip' || encoding === 'x-gzip') {
    decoder = zlib.createGunzip({
      flush: zlib.constants.Z_SYNC_FLUSH,
      finishFlush: zlib.constants.Z_SYNC_FLUSH
    })
  } else if (encoding === 'deflate') {
    decoder = zlib.createInflate({
      flush: zlib.constants.Z_SYNC_FLUSH,
      finishFlush: zlib.constants.Z_SYNC_FLUSH
    })
  } else if (encoding === 'br') {
    decoder = zlib.createBrotliDecompress({
      flush: zlib.constants.BROTLI_OPERATION_FLUSH,
      finishFlush: zlib.constants.BROTLI_OPERATION_FLUSH
    })
  }

  if (!decoder) {
    return { stream: message, decoded: false }
  }
  return { stream: pipeline(message, decoder, () => {}), decoded: true }
}

const createResponse = (
  message: http.IncomingMessage,
  url: URL,
  maxBytes: number,
  state: { timedOut: boolean },
  cleanup: () => void
): SafeFetchResponse => {
  const { stream, decoded } = decodeBody(message)
  stream.once('close', cleanup)

  const headers = new Headers()
  for (const [name, value] of Object.entries(message.headers)) {
    if (value === undefined) continue
    // 响应体已解压，原始的编码与长度不再适用于 body
    if (decoded && (name === 'content-encoding' || name === 'content-length')) continue
    try {
      headers.set(name, Array.isArray(value) ? value.join(', ') : value)
    } catch {
      // 忽略无法表示的响应头
    }
  }

  const status = message.statusCode || 0

  const buffer = async () => {
    const declaredLength = Number(message.headers['content-length'])
    if (maxBytes > 0 && Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      stream.destroy()
      throw new OutboundRequestError('响应内容超过大小限制', 413)
    }

    const chunks: Buffer[] = []
    let total = 0
    try {
      for await (const chunk of stream) {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        total += data.length
        if (maxBytes > 0 && total > maxBytes) {
          stream.destroy()
          throw new OutboundRequestError('响应内容超过大小限制', 413)
        }
        chunks.push(data)
      }
    } catch (error) {
      if (state.timedOut) throw createTimeoutError()
      throw error
    }
    return Buffer.concat(chunks, total)
  }

  return {
    status,
    statusText: message.statusMessage || '',
    ok: status >= 200 && status < 300,
    url: url.toString(),
    headers,
    body: stream,
    buffer,
    text: async () => (await buffer()).toString('utf8'),
    discard: () => {
      stream.destroy()
      message.destroy()
    }
  }
}

/**
 * 安全的出站 HTTP 请求。重定向按 fetch 的规则处理（303 及 POST 的 301/302 改为 GET），
 * 每一跳都会重新校验地址。
 */
export async function safeFetch(
  input: string | URL,
  options: SafeFetchOptions = {}
): Promise<SafeFetchResponse> {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_RESPONSE_BYTES
  const state = { timedOut: false }
  const controller = new AbortController()
  const startTimer = (ms: number) =>
    setTimeout(() => {
      state.timedOut = true
      controller.abort()
    }, ms)
  let timer = startTimer(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const cleanup = () => clearTimeout(timer)

  let url = assertSafeOutboundUrl(input)
  let method: string = options.method || 'GET'
  let headers: Record<string, string> = { ...(options.headers || {}) }
  let body = options.body
  // 与 fetch 一致：默认声明支持压缩，响应体会自动解压
  if (!Object.keys(headers).some((name) => name.toLowerCase() === 'accept-encoding')) {
    headers['Accept-Encoding'] = 'gzip, deflate, br'
  }

  try {
    for (let redirects = 0; ; redirects++) {
      const message = await requestOnce(url, method, headers, body, controller.signal)
      const status = message.statusCode || 0
      const location = message.headers.location

      if (status >= 300 && status < 400 && status !== 304 && location) {
        message.resume()
        message.destroy()
        if (redirects >= maxRedirects) {
          throw new OutboundRequestError('重定向次数过多', 502)
        }

        let nextUrl: URL
        try {
          nextUrl = new URL(location, url)
        } catch {
          throw new OutboundRequestError('重定向地址无效', 502)
        }
        url = assertSafeOutboundUrl(nextUrl)

        if (status === 303 || ((status === 301 || status === 302) && method === 'POST')) {
          method = 'GET'
          body = undefined
          headers = Object.fromEntries(
            Object.entries(headers).filter(([name]) => !REQUEST_BODY_HEADERS.has(name.toLowerCase()))
          )
        }
        continue
      }

      if (options.bodyTimeoutMs !== undefined) {
        cleanup()
        timer = startTimer(options.bodyTimeoutMs)
      }
      return createResponse(message, url, maxBytes, state, cleanup)
    }
  } catch (error) {
    cleanup()
    controller.abort()
    if (state.timedOut) throw createTimeoutError()
    throw error
  }
}
