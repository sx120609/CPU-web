const ALLOWED_HOST_PATTERNS = [
  /\.qq\.com$/i,
  /\.music\.126\.net$/i,
  /\.bilivideo\.com$/i,
  /\.bilibili\.com$/i
]

const isAllowedHost = (hostname: string) =>
  ALLOWED_HOST_PATTERNS.some((pattern) => pattern.test(hostname))

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const rawUrl = Array.isArray(query.url) ? query.url[0] : query.url

  if (!rawUrl || typeof rawUrl !== 'string') {
    throw createError({ statusCode: 400, message: '缺少 url 参数' })
  }

  let target: URL
  try {
    target = new URL(rawUrl)
  } catch {
    throw createError({ statusCode: 400, message: 'url 参数无效' })
  }

  if (target.protocol !== 'https:') {
    throw createError({ statusCode: 400, message: '仅允许 HTTPS 资源' })
  }

  if (!isAllowedHost(target.hostname)) {
    throw createError({ statusCode: 403, message: '目标域名不在允许列表' })
  }

  let upstream: Response
  try {
    upstream = await fetch(target.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: '*/*'
      }
    })
  } catch {
    throw createError({ statusCode: 502, message: '上游请求失败' })
  }

  if (!upstream.ok || !upstream.body) {
    throw createError({ statusCode: 502, message: '上游服务不可用' })
  }

  const headers = new Headers()
  const contentType = upstream.headers.get('content-type')
  const contentLength = upstream.headers.get('content-length')

  if (contentType) headers.set('content-type', contentType)
  if (contentLength) headers.set('content-length', contentLength)
  headers.set('cache-control', 'no-store')

  return new Response(upstream.body, {
    status: 200,
    headers
  })
})
