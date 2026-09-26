const neteaseEnhancedApiPromise = import('@neteasecloudmusicapienhanced/api').then((mod) => {
  return (mod.default || {}) as Record<string, (params: Record<string, any>) => Promise<any>>
})

// 前端（音源检索、详情、播放地址、歌词、播客）实际调用的只读接口，访客可用
const PUBLIC_ACTIONS = new Set([
  'cloudsearch',
  'search',
  'song_detail',
  'song_url_v1',
  'lyric',
  'lyric_new',
  'lyric_ttml',
  'dj_program'
])

// 涉及网易云账号或登录凭证的接口（扫码登录、歌单、最近播放、云盘上传），仅限已登录本站的用户
const ACCOUNT_ACTIONS = new Set([
  'login_qr_key',
  'login_qr_create',
  'login_qr_check',
  'login_status',
  'user_playlist',
  'playlist_create',
  'playlist_delete',
  'playlist_tracks',
  'playlist_track_all',
  'record_recent_song',
  'cloud_upload_token',
  'cloud_upload_complete'
])

// 控制出站网络行为的参数（代理、伪造来源 IP、改写请求域名、解锁模块路径）不允许调用方指定
const BLOCKED_PARAMS = new Set(['proxy', 'realip', 'randomcnip', 'ip', 'domain', 'source'])

const normalizeParams = (input: Record<string, any>) => {
  const output: Record<string, any> = {}
  for (const [key, value] of Object.entries(input || {})) {
    if (value === undefined || value === null || value === '') {
      continue
    }
    if (BLOCKED_PARAMS.has(key.toLowerCase())) {
      continue
    }
    output[key] = Array.isArray(value) ? value[value.length - 1] : value
  }
  return output
}

export default defineEventHandler(async (event) => {
  const rawPath = getRouterParam(event, 'path')
  const endpointPath = Array.isArray(rawPath) ? rawPath.join('/') : rawPath

  if (!endpointPath) {
    throw createError({
      statusCode: 400,
      message: '缺少网易云接口路径'
    })
  }

  const action = endpointPath.replace(/\//g, '_').replace(/-/g, '_')
  const requiresLogin = ACCOUNT_ACTIONS.has(action)

  if (!requiresLogin && !PUBLIC_ACTIONS.has(action)) {
    throw createError({
      statusCode: 404,
      message: `未找到接口: ${endpointPath}`
    })
  }

  if (requiresLogin && !event.context.user) {
    throw createError({
      statusCode: 401,
      message: '请先登录药大拾间'
    })
  }

  const api = await neteaseEnhancedApiPromise
  const handler = Object.prototype.hasOwnProperty.call(api, action) ? api[action] : undefined

  if (typeof handler !== 'function') {
    throw createError({
      statusCode: 404,
      message: `未找到接口: ${endpointPath}`
    })
  }

  const method = getMethod(event)
  const queryParams = normalizeParams(getQuery(event))
  let bodyParams: Record<string, any> = {}

  if (method !== 'GET') {
    const body = await readBody(event).catch(() => ({}))
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      bodyParams = normalizeParams(body as Record<string, any>)
    }
  }

  const params = { ...queryParams, ...bodyParams }

  try {
    const result = await handler(params)
    if (Array.isArray(result?.cookie) && result.cookie.length > 0) {
      setHeader(event, 'set-cookie', result.cookie)
    }
    if (typeof result?.status === 'number') {
      setResponseStatus(event, result.status)
    }
    return result?.body ?? result
  } catch (error: any) {
    throw createError({
      statusCode: error?.statusCode || error?.status || 500,
      message: error?.body?.message || error?.message || '网易云接口调用失败',
      data: error?.body || null
    })
  }
})
