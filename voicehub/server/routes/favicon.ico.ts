import { db } from '~/drizzle/db'
import { systemSettings } from '~/drizzle/schema'
import { getPublicOrigin } from '~~/server/utils/public-url'

const normalizeAppBase = (baseURL: string) => {
  const withLeadingSlash = baseURL.startsWith('/') ? baseURL : `/${baseURL}`
  const normalized = withLeadingSlash.replace(/\/{2,}/g, '/')
  if (normalized === '/') return ''
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized
}

const withBase = (path: string, basePrefix: string) => {
  if (!basePrefix) return path
  if (path.startsWith(`${basePrefix}/`) || path === basePrefix) {
    return path
  }
  return `${basePrefix}${path}`
}

const normalizePathname = (path: string) => {
  const base = (path || '/').split('?')[0].replace(/\/{2,}/g, '/')
  if (!base) return '/'
  return base.endsWith('/') && base !== '/' ? base.slice(0, -1) : base
}

const toPathname = (target: string, currentOrigin: string) => {
  try {
    if (target.startsWith('http://') || target.startsWith('https://')) {
      return new URL(target).pathname
    }
    return new URL(target, currentOrigin).pathname
  } catch {
    return target
  }
}

const isSameOriginAbsoluteUrl = (url: string, currentOrigin: string): boolean => {
  try {
    return new URL(url).origin === new URL(currentOrigin).origin
  } catch {
    return false
  }
}

const resolveFaviconTarget = (logoUrl: string, basePrefix: string, currentOrigin: string) => {
  const value = (logoUrl || '').trim()
  const fallback = withBase('/images/logo.png', basePrefix)

  if (!value || value === '/favicon.ico' || value.endsWith('/favicon.ico')) {
    return fallback
  }

  if (value.startsWith('http://') || value.startsWith('https://')) {
    // 同源绝对地址不走代理，避免“代理自己”导致的循环/网关错误
    if (isSameOriginAbsoluteUrl(value, currentOrigin)) {
      try {
        const parsed = new URL(value)
        return `${parsed.pathname}${parsed.search}`
      } catch {
        return fallback
      }
    }

    return withBase(`/api/proxy/image?url=${encodeURIComponent(value)}`, basePrefix)
  }

  if (value.startsWith('data:')) {
    return fallback
  }

  if (value.startsWith('/')) {
    return withBase(value, basePrefix)
  }

  return withBase(`/${value.replace(/^\/+/, '')}`, basePrefix)
}

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig(event)
  const basePrefix = normalizeAppBase((runtimeConfig as any)?.app?.baseURL || '/')
  const currentOrigin = getPublicOrigin(event)
  const fallback = withBase('/images/logo.png', basePrefix)

  let logoUrl = ''
  try {
    const settingsResult = await db
      .select({
        siteLogoUrl: systemSettings.siteLogoUrl
      })
      .from(systemSettings)
      .limit(1)
    logoUrl = settingsResult[0]?.siteLogoUrl || ''
  } catch (error) {
    console.warn('[favicon] 获取站点 logo 配置失败，使用默认 logo', error)
  }

  let target = resolveFaviconTarget(logoUrl, basePrefix, currentOrigin)
  const requestPath = normalizePathname(getRequestURL(event).pathname)
  const targetPath = normalizePathname(toPathname(target, currentOrigin))
  const faviconPath = normalizePathname(withBase('/favicon.ico', basePrefix))

  // 防止 favicon 请求被重定向到 favicon 自己导致循环。
  if (targetPath === requestPath || targetPath === faviconPath) {
    target = fallback
  }

  return sendRedirect(event, target, 302)
})
