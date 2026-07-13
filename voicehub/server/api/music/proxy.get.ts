const SOURCE_BASE_URL_MAP: Record<string, string> = {
  'netease-backup-1': 'https://api.voicehub.lao-shui.top:443',
  'vkeys-v3': 'https://api.vkeys.cn/music',
  vkeys: 'https://api.vkeys.cn/v2/music',
  'netease-backup-2': 'https://ncmapi.zcy.life:443',
  'meting-1': 'https://api.qijieya.cn/meting',
  'meting-2': 'https://api.obdo.cc/meting',
  bilibili: 'https://api.bilibili.com'
}

const DEFAULT_TIMEOUT_MS = 8000
const MAX_TIMEOUT_MS = 15000

const firstQueryValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? (value[0] ?? '') : (value ?? '')

const parseTimeout = (value: string) => {
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n) || n <= 0) {
    return DEFAULT_TIMEOUT_MS
  }
  return Math.min(n, MAX_TIMEOUT_MS)
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const source = firstQueryValue(query.source as string | string[] | undefined)
  const path = firstQueryValue(query.path as string | string[] | undefined)
  const q = firstQueryValue(query.q as string | string[] | undefined)
  const responseType = firstQueryValue(query.responseType as string | string[] | undefined) || 'json'
  const timeout = parseTimeout(firstQueryValue(query.timeout as string | string[] | undefined))

  const baseUrl = SOURCE_BASE_URL_MAP[source]
  if (!baseUrl) {
    throw createError({ statusCode: 400, message: `未知音源: ${source}` })
  }
  if (!path || !path.startsWith('/')) {
    throw createError({ statusCode: 400, message: 'path 参数无效' })
  }

  const targetUrl = `${baseUrl}${path}${q ? `?${q}` : ''}`

  let upstream: Response
  try {
    upstream = await fetch(targetUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(timeout),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: '*/*'
      }
    })
  } catch {
    throw createError({
      statusCode: 502,
      message: '上游请求失败'
    })
  }

  if (!upstream.ok) {
    throw createError({
      statusCode: 502,
      message: '上游服务不可用'
    })
  }

  if (responseType === 'resolve') {
    return { url: upstream.url, status: upstream.status }
  }

  if (responseType === 'text') {
    return await upstream.text()
  }

  const rawText = await upstream.text()
  try {
    return JSON.parse(rawText)
  } catch {
    return rawText
  }
})
