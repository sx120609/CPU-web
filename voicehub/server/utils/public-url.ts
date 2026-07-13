import { getRequestHeader, getRequestURL } from 'h3'
import type { H3Event } from 'h3'
import { useRuntimeConfig } from '#imports'

const getFirstHeaderValue = (value?: string | null): string => {
  if (!value) {
    return ''
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .find(Boolean) || ''
}

const normalizeProtocol = (proto: string, fallback: string): string => {
  const normalized = proto.trim().toLowerCase().replace(/:$/, '')
  if (normalized === 'http' || normalized === 'https') {
    return `${normalized}:`
  }
  return fallback
}

export const normalizePublicOrigin = (origin?: string | null): string | null => {
  if (!origin || typeof origin !== 'string') {
    return null
  }
  try {
    const parsed = new URL(origin.trim())
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    return parsed.origin
  } catch {
    return null
  }
}

export const getPublicOrigin = (event: H3Event): string => {
  const requestUrl = getRequestURL(event)

  // 浏览器同源请求会携带 Origin，优先使用，避免反向代理 Host 配置不正确导致域名错误
  const originHeader = getFirstHeaderValue(getRequestHeader(event, 'origin'))
  if (originHeader) {
    try {
      return new URL(originHeader).origin
    } catch {
      // ignore
    }
  }

  const refererHeader = getFirstHeaderValue(getRequestHeader(event, 'referer'))
  if (refererHeader) {
    try {
      return new URL(refererHeader).origin
    } catch {
      // ignore
    }
  }

  const forwardedHost = getFirstHeaderValue(getRequestHeader(event, 'x-forwarded-host'))
  const forwardedProto = getFirstHeaderValue(getRequestHeader(event, 'x-forwarded-proto'))
  const forwardedPort = getFirstHeaderValue(getRequestHeader(event, 'x-forwarded-port'))

  let host = forwardedHost || getFirstHeaderValue(getRequestHeader(event, 'host')) || requestUrl.host
  const protocol = normalizeProtocol(forwardedProto, requestUrl.protocol)

  if (host && forwardedPort && !host.includes(':')) {
    const isStandardPort =
      (protocol === 'https:' && forwardedPort === '443') ||
      (protocol === 'http:' && forwardedPort === '80')
    if (!isStandardPort) {
      host = `${host}:${forwardedPort}`
    }
  }

  if (!host) {
    return requestUrl.origin
  }

  return `${protocol}//${host}`
}

export const buildPublicAppUrl = (event: H3Event, path: string): string => {
  const origin = getPublicOrigin(event)
  return buildPublicAppUrlFromOrigin(event, origin, path)
}

export const buildPublicAppUrlFromOrigin = (
  event: H3Event,
  origin: string,
  path: string
): string => {
  const runtimeConfig = useRuntimeConfig(event)
  const rawBaseURL = (runtimeConfig.app?.baseURL || '/').toString()
  const normalizedBaseURL = rawBaseURL === '/' ? '' : rawBaseURL.replace(/\/$/, '')
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const normalizedOrigin = normalizePublicOrigin(origin) || getPublicOrigin(event)
  return `${normalizedOrigin}${normalizedBaseURL}${normalizedPath}`
}
