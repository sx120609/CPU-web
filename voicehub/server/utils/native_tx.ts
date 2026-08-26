import crypto from 'node:crypto'

export const txHeaders = {
  'User-Agent': 'QQMusic 14090508(android 12)'
}

const TX_MUSICU_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg'
const QQ_MID_PREFIX_RE = /^qqmid:/i
const QQ_LEGACY_ID_RE = /^\d+$/
const TX_DETAIL_CACHE_TTL = 6 * 60 * 60 * 1000
const PART_1_INDEXES = [23, 14, 6, 36, 16, 40, 7, 19]
const PART_2_INDEXES = [16, 1, 32, 12, 19, 27, 8, 5]
const SCRAMBLE_VALUES = [89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179]

const TX_REQUEST_TIMEOUT_MS = 8000
const TX_MAX_RETRIES_PER_HOST = 2
const TX_RETRY_BASE_DELAY_MS = 250
const TX_RETRYABLE_ERROR_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT'
])

const txEnvHosts = (process.env.TX_API_HOSTS || '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean)

const TX_FALLBACK_HOSTS = Array.from(new Set([...txEnvHosts, 'u.y.qq.com', 'u6.y.qq.com', 'u1.y.qq.com']))

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const pickHashByIdx = (hash: string, indexes: number[]) => {
  return indexes.map((index) => hash[index]).join('')
}

const base64Encode = (data: Buffer | string) => {
  return Buffer.from(data).toString('base64').replace(/[\\/+=]/g, '')
}

/**
 * QQ 音乐客户端 zzc 签名。来自 VoiceHub 最新版，签名端点比普通
 * musicu.fcg 搜索更稳定。
 */
export async function zzcSign(text: string) {
  const hash = crypto.createHash('sha1').update(text).digest('hex')
  const part1 = pickHashByIdx(hash, PART_1_INDEXES)
  const part2 = pickHashByIdx(hash, PART_2_INDEXES)
  const part3 = SCRAMBLE_VALUES.map((value, index) => {
    return value ^ parseInt(hash.slice(index * 2, index * 2 + 2), 16)
  })
  const encoded = base64Encode(Buffer.from(part3))
  return `zzc${part1}${encoded}${part2}`.toLowerCase()
}

export interface TxRequestOptions {
  headers?: Record<string, string>
}

export const txSignedRequest = async (
  body: Record<string, unknown>,
  options: TxRequestOptions = {}
) => {
  const sign = await zzcSign(JSON.stringify(body))
  return txRequest(`https://u.y.qq.com/cgi-bin/musics.fcg?sign=${sign}`, body, options)
}

type TxIdType = 'legacy-id' | 'mid'

interface TxNormalizedMusicId {
  rawMusicId: string
  normalizedMusicId: string
  idType: TxIdType
}

interface TxSongPlayableInfo extends TxNormalizedMusicId {
  songmid: string
  songId?: string
  strMediaMid?: string
}

const txSongDetailCache = new Map<string, { expiresAt: number; value: TxSongPlayableInfo }>()

const getTxErrorCode = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') {
    return
  }

  const typedError = error as { code?: unknown; cause?: unknown }
  if (typeof typedError.code === 'string') {
    return typedError.code
  }

  return getTxErrorCode(typedError.cause)
}

const getTxErrorMessage = (error: unknown) => {
  if (!error || typeof error !== 'object') {
    return String(error)
  }
  const typedError = error as { message?: unknown }
  return typeof typedError.message === 'string' ? typedError.message : String(error)
}

const isRetryableTxError = (error: unknown) => {
  const code = getTxErrorCode(error)
  return Boolean(code && TX_RETRYABLE_ERROR_CODES.has(code))
}

const buildTxCandidateUrls = (url: string) => {
  try {
    const parsed = new URL(url)
    if (!parsed.hostname.endsWith('y.qq.com')) {
      return [url]
    }

    const candidates = [url]
    for (const host of TX_FALLBACK_HOSTS) {
      const next = new URL(parsed.toString())
      next.hostname = host
      candidates.push(next.toString())
    }
    return Array.from(new Set(candidates))
  } catch {
    return [url]
  }
}

export const createTxSearchBody = (str: string, page: number, limit: number) => {
  return {
    comm: {
      ct: '11',
      cv: '14090508',
      v: '14090508',
      tmeAppID: 'qqmusic',
      phonetype: 'EBG-AN10',
      deviceScore: '553.47',
      devicelevel: '50',
      newdevicelevel: '20',
      rom: 'HuaWei/EMOTION/EmotionUI_14.2.0',
      os_ver: '12',
      OpenUDID: '0',
      OpenUDID2: '0',
      QIMEI36: '0',
      udid: '0',
      chid: '0',
      aid: '0',
      oaid: '0',
      taid: '0',
      tid: '0',
      wid: '0',
      uid: '0',
      sid: '0',
      modeSwitch: '6',
      teenMode: '0',
      ui_mode: '2',
      nettype: '1020',
      v4ip: ''
    },
    req: {
      module: 'music.search.SearchCgiService',
      method: 'DoSearchForQQMusicMobile',
      param: {
        search_type: 0,
        query: str,
        page_num: page,
        num_per_page: limit,
        highlight: 0,
        nqc_flag: 0,
        multi_zhida: 0,
        cat: 2,
        grp: 1,
        sin: 0,
        sem: 0
      }
    }
  }
}

export const normalizeTxMusicId = (musicId: string | number): TxNormalizedMusicId => {
  const rawMusicId = String(musicId ?? '').trim()
  const normalizedMusicId = rawMusicId.replace(QQ_MID_PREFIX_RE, '').trim()

  if (!normalizedMusicId) {
    throw createError({ statusCode: 400, message: '缺少 QQ 音乐 ID' })
  }

  return {
    rawMusicId,
    normalizedMusicId,
    idType: QQ_LEGACY_ID_RE.test(normalizedMusicId) ? 'legacy-id' : 'mid'
  }
}

export const upgradeTxAudioUrl = (url: string) => {
  return url.startsWith('http://') ? url.replace('http://', 'https://') : url
}

export const createTxSongDetailBody = (musicId: TxNormalizedMusicId) => {
  const param = musicId.idType === 'legacy-id'
    ? { song_type: 0, song_id: Number(musicId.normalizedMusicId) }
    : { song_type: 0, song_mid: musicId.normalizedMusicId }

  return {
    comm: { ct: '19', cv: '1859', uin: '0' },
    req: {
      module: 'music.pf_song_detail_svr',
      method: 'get_song_detail_yqq',
      param
    }
  }
}

const getCachedTxSongDetail = (key: string) => {
  const cached = txSongDetailCache.get(key)
  if (!cached) return null
  if (cached.expiresAt <= Date.now()) {
    txSongDetailCache.delete(key)
    return null
  }
  return cached.value
}

const setCachedTxSongDetail = (key: string, value: TxSongPlayableInfo) => {
  if (txSongDetailCache.size >= 1000) {
    const firstKey = txSongDetailCache.keys().next().value
    if (firstKey !== undefined) txSongDetailCache.delete(firstKey)
  }
  txSongDetailCache.set(key, {
    expiresAt: Date.now() + TX_DETAIL_CACHE_TTL,
    value
  })
}

export const getTxSongPlayableInfo = async (
  musicId: string | number
): Promise<TxSongPlayableInfo> => {
  const normalized = normalizeTxMusicId(musicId)
  const cacheKey = `${normalized.idType}:${normalized.normalizedMusicId}`
  const cached = getCachedTxSongDetail(cacheKey)
  if (cached) return cached

  let result: any
  try {
    result = await txRequest(TX_MUSICU_URL, createTxSongDetailBody(normalized))
  } catch (error) {
    if (normalized.idType === 'mid') {
      const value = { ...normalized, songmid: normalized.normalizedMusicId }
      setCachedTxSongDetail(cacheKey, value)
      return value
    }
    throw error
  }

  if (!result || result.code !== 0 || result.req?.code !== 0) {
    if (normalized.idType === 'mid') {
      const value = { ...normalized, songmid: normalized.normalizedMusicId }
      setCachedTxSongDetail(cacheKey, value)
      return value
    }
    throw createError({ statusCode: 502, message: 'QQ 音乐详情接口异常' })
  }

  const trackInfo = result.req?.data?.track_info
  const songmid = String(trackInfo?.mid || normalized.normalizedMusicId).trim()
  if (!songmid) {
    throw createError({ statusCode: 502, message: 'QQ 音乐详情缺少 MID' })
  }

  const value: TxSongPlayableInfo = {
    ...normalized,
    songmid,
    songId: String(trackInfo?.id || normalized.normalizedMusicId),
    strMediaMid: trackInfo?.file?.media_mid
  }

  setCachedTxSongDetail(cacheKey, value)
  setCachedTxSongDetail(`mid:${songmid}`, {
    ...value,
    normalizedMusicId: songmid,
    idType: 'mid'
  })
  return value
}

export const txRequest = async (
  url: string,
  body: Record<string, unknown>,
  options: TxRequestOptions = {}
) => {
  const candidateUrls = buildTxCandidateUrls(url)
  let lastError: unknown

  for (const candidateUrl of candidateUrls) {
    for (let attempt = 0; attempt <= TX_MAX_RETRIES_PER_HOST; attempt++) {
      try {
        const response = await $fetch(candidateUrl, {
          method: 'POST',
          headers: {
            ...txHeaders,
            ...options.headers
          },
          body,
          responseType: 'json',
          timeout: TX_REQUEST_TIMEOUT_MS
        })
        return response
      } catch (error: unknown) {
        lastError = error

        if (!isRetryableTxError(error)) {
          throw error
        }

        if (attempt < TX_MAX_RETRIES_PER_HOST) {
          await sleep(TX_RETRY_BASE_DELAY_MS * (attempt + 1))
        }
      }
    }
  }

  console.error('TX Request Error:', {
    url,
    attemptedUrls: candidateUrls,
    code: getTxErrorCode(lastError),
    message: getTxErrorMessage(lastError)
  })

  throw lastError
}
