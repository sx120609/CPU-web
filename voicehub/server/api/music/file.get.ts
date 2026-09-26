import { Readable } from 'node:stream'
import { safeFetch, type SafeFetchResponse } from '~~/server/utils/safe-fetch'

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

  // 重定向目标可能不在允许列表内（CDN 跳转），但每一跳都会校验不得指向内网地址
  let upstream: SafeFetchResponse
  try {
    upstream = await safeFetch(target, {
      method: 'GET',
      timeoutMs: 20000,
      maxBytes: 0, // 流式转发，不在内存中缓存
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: '*/*'
      }
    })
  } catch {
    throw createError({ statusCode: 502, message: '上游请求失败' })
  }

  if (!upstream.ok) {
    upstream.discard()
    throw createError({ statusCode: 502, message: '上游服务不可用' })
  }

  const headers = new Headers()
  const contentType = upstream.headers.get('content-type')
  const contentLength = upstream.headers.get('content-length')

  if (contentType) headers.set('content-type', contentType)
  if (contentLength) headers.set('content-length', contentLength)
  headers.set('cache-control', 'no-store')

  return new Response(Readable.toWeb(upstream.body) as ReadableStream, {
    status: 200,
    headers
  })
})
