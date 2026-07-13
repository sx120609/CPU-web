import { createError, getMethod, getRequestURL, sendError } from 'h3'
import { resolveCpuWebAuth } from '~~/server/utils/cpu-web-auth'

const normalizeBaseURL = (baseURL: string) => {
  const withLeadingSlash = baseURL.startsWith('/') ? baseURL : `/${baseURL}`
  const normalized = withLeadingSlash.replace(/\/{2,}/g, '/')
  return normalized.endsWith('/') ? normalized : `${normalized}/`
}

const stripBaseFromPath = (path: string, baseURL: string) => {
  const normalizedBase = normalizeBaseURL(baseURL)
  const basePrefix = normalizedBase === '/' ? '' : normalizedBase.slice(0, -1)
  if (!basePrefix) return path
  if (path === basePrefix) return '/'
  return path.startsWith(`${basePrefix}/`) ? path.slice(basePrefix.length) : path
}

const PUBLIC_API_PREFIXES = [
  '/api/healthz',
  '/api/auth/verify',
  '/api/semesters/current',
  '/api/play-times',
  '/api/schedules/public',
  '/api/songs/count',
  '/api/songs/public',
  '/api/site-config',
  '/api/user/avatar-file/',
  '/api/proxy/',
  '/api/bilibili/',
  '/api/api-enhanced/',
  '/api/native-api/',
  '/api/system/location',
  '/api/open/',
  '/api/music/state',
  '/api/music/websocket',
  '/api/music/proxy'
]

export default defineEventHandler(async (event) => {
  if (event.context.user) delete event.context.user

  const runtimeConfig = useRuntimeConfig(event)
  const baseURL =
    (runtimeConfig as any)?.app?.baseURL ||
    (runtimeConfig as any)?.public?.appBaseURL ||
    process.env.NUXT_APP_BASE_URL ||
    '/voicehub/'
  const routePath = stripBaseFromPath(getRequestURL(event).pathname, baseURL)
  if (!routePath.startsWith('/api/')) return
  const method = getMethod(event).toUpperCase()

  // VoiceHub 原账号、密码、OAuth 与注册入口全部停用，唯一身份源为 CPU-web 会话。
  if (routePath.startsWith('/api/auth/') && routePath !== '/api/auth/verify') {
    return sendError(event, createError({
      statusCode: 410,
      message: '药苑之声已接入本站账号，请从药大拾间登录'
    }))
  }

  const cpuManagedUserWrite = method !== 'GET' && (
    routePath.startsWith('/api/user/profile') ||
    routePath.startsWith('/api/user/avatar') ||
    routePath.startsWith('/api/user/email') ||
    routePath.startsWith('/api/user/2fa')
  )
  if (routePath.startsWith('/api/admin/users') || cpuManagedUserWrite) {
    return sendError(event, createError({
      statusCode: 410,
      message: '用户资料与账号权限请在药大拾间管理'
    }))
  }

  try {
    event.context.user = await resolveCpuWebAuth(event)
  } catch (error) {
    const isPublic = PUBLIC_API_PREFIXES.some((path) => routePath.startsWith(path))
    if (!isPublic) throw error
    console.warn('[cpu-auth] 公开请求未能同步本站用户，将按访客继续', error)
  }

  const isPublic = PUBLIC_API_PREFIXES.some((path) => routePath.startsWith(path))
    || (method === 'GET' && routePath === '/api/songs')
    || (method === 'GET' && routePath.startsWith('/api/songs/comments/'))

  if (!event.context.user && !isPublic) {
    return sendError(event, createError({
      statusCode: 401,
      message: '请先登录药大拾间'
    }))
  }

  if (
    routePath.startsWith('/api/admin') &&
    !['ADMIN', 'SUPER_ADMIN', 'SONG_ADMIN'].includes(event.context.user?.role)
  ) {
    return sendError(event, createError({ statusCode: 403, message: '需要广播站管理权限' }))
  }
})
