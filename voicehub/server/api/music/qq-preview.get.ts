import {
  createError,
  getHeader,
  getQuery,
  sendStream,
  setResponseHeader,
  setResponseStatus
} from 'h3'

const QQ_MUSIC_API = 'https://u.y.qq.com/cgi-bin/musicu.fcg'
const QQ_MID_PATTERN = /^[A-Za-z0-9]{8,32}$/

async function resolveFreePreview(mid: string) {
  const response = await fetch(QQ_MUSIC_API, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'user-agent': 'Mozilla/5.0 VoiceHub free-preview'
    },
    body: JSON.stringify({
      comm: { uin: '0', format: 'json', ct: 24, cv: 0 },
      req_0: {
        module: 'vkey.GetVkeyServer',
        method: 'CgiGetVkey',
        param: {
          guid: '0',
          songmid: [mid],
          songtype: [0],
          uin: '0',
          loginflag: 1,
          platform: '20'
        }
      }
    }),
    signal: AbortSignal.timeout(8000)
  })

  if (!response.ok) throw createError({ statusCode: 502, message: 'QQ 音乐试听服务暂不可用' })
  const payload: any = await response.json()
  const data = payload?.req_0?.data
  const info = data?.midurlinfo?.[0]
  const purl = String(info?.purl || '').trim()
  if (!purl || Number(info?.result) !== 0) {
    throw createError({ statusCode: 404, message: '该歌曲暂无免费试听' })
  }

  const hosts = Array.isArray(data?.sip) ? data.sip : []
  const urls = hosts
    .map((host: unknown) => String(host || '').replace(/^http:/, 'https:'))
    .filter((host: string) => /^https:\/\//.test(host))
    .map((host: string) => new URL(purl, host).toString())
  if (!urls.length) throw createError({ statusCode: 502, message: 'QQ 音乐未返回试听地址' })
  return urls
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const mid = String(query.mid || '').trim()
  if (!QQ_MID_PATTERN.test(mid)) {
    throw createError({ statusCode: 400, message: 'QQ 音乐歌曲 MID 无效' })
  }

  const urls = await resolveFreePreview(mid)
  if (String(query.resolve || '') === '1') {
    return { available: true }
  }

  const range = getHeader(event, 'range')
  let upstream: Response | null = null
  for (const url of urls) {
    const candidate = await fetch(url, {
      headers: {
        accept: 'audio/*',
        'user-agent': 'Mozilla/5.0 VoiceHub free-preview',
        ...(range ? { range } : {})
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000)
    }).catch(() => null)
    if (candidate?.ok && candidate.body) {
      upstream = candidate
      break
    }
  }
  if (!upstream?.body) throw createError({ statusCode: 502, message: 'QQ 音乐试听音频暂不可用' })

  setResponseStatus(event, upstream.status)
  for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const value = upstream.headers.get(header)
    if (value) setResponseHeader(event, header, value)
  }
  setResponseHeader(event, 'cache-control', 'private, no-store')
  return sendStream(event, upstream.body)
})
