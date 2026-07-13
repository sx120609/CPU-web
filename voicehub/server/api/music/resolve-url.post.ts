import {
  getTxSongPlayableInfo,
  normalizeTxMusicId,
  upgradeTxAudioUrl
} from '~~/server/utils/native_tx'

const DEFAULT_QUALITY = 8
const INVALID_TX_AUDIO_URL_SUFFIX = '/2149972737147268278.mp3'

const txQualityMap: Record<string, string> = {
  '4': '128k',
  '8': '320k',
  '10': 'flac',
  '11': 'flac24bit',
  '14': 'flac24bit',
  '128': '128k',
  '320': '320k',
  '128k': '128k',
  '320k': '320k',
  flac: 'flac',
  sq: 'flac',
  hires: 'flac24bit',
  flac24bit: 'flac24bit'
}

const normalizeTxQuality = (quality: unknown) => {
  const key = String(quality ?? DEFAULT_QUALITY).toLowerCase()
  return txQualityMap[key] || '320k'
}

const resolveTxWithHuibq = async (songmid: string, quality: string) => {
  const response = await fetch(
    `https://lxmusicapi.onrender.com/url/tx/${encodeURIComponent(songmid)}/${encodeURIComponent(quality)}`,
    {
      headers: {
        'X-Request-Key': 'share-v3',
        'User-Agent': 'lx-music-desktop/2.11.0'
      },
      signal: AbortSignal.timeout(8000)
    }
  )

  if (!response.ok) throw new Error(`返回 HTTP ${response.status}`)

  const data: any = await response.json()
  if (data?.code !== 0 || !data?.url) {
    throw new Error(data?.msg || data?.message || '未返回播放链接')
  }
  return upgradeTxAudioUrl(String(data.url))
}

const resolveTxWithDreamMeting = async (songmid: string) => {
  const response = await fetch(
    `https://music.3e0.cn/?server=tencent&type=url&id=${encodeURIComponent(songmid)}`,
    {
      redirect: 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      signal: AbortSignal.timeout(8000)
    }
  )

  const location = response.headers.get('location')
  if (!location) throw new Error(`未返回播放重定向（HTTP ${response.status}）`)
  return upgradeTxAudioUrl(location)
}

const validateResolvedTxUrl = (url: string, source: string) => {
  const normalizedUrl = upgradeTxAudioUrl(url.trim())
  if (!/^https:\/\//i.test(normalizedUrl)) {
    throw new Error(`${source} 返回了无效链接`)
  }

  const withoutParams = normalizedUrl.split('?')[0].split('#')[0]
  if (withoutParams.endsWith(INVALID_TX_AUDIO_URL_SUFFIX)) {
    throw new Error(`${source} 返回了已知无效音频链接`)
  }
  return normalizedUrl
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const platform = String(body?.platform || '').trim()
  const musicId = body?.musicId
  const playUrl = String(body?.playUrl || '').trim()

  if (playUrl) {
    return {
      success: true,
      url: platform === 'tencent' ? upgradeTxAudioUrl(playUrl) : playUrl,
      source: 'play-url',
      normalizedMusicId: musicId ? String(musicId).trim() : ''
    }
  }

  if (platform !== 'tencent') {
    throw createError({ statusCode: 400, message: '暂不支持该音乐平台' })
  }

  const normalized = normalizeTxMusicId(musicId)
  const playableInfo = await getTxSongPlayableInfo(musicId)
  const quality = normalizeTxQuality(body?.quality)
  const attempts: Array<{ source: string; status: 'success' | 'error'; error?: string }> = []

  const resolvers = [
    {
      source: 'huibq',
      resolve: () => resolveTxWithHuibq(playableInfo.songmid, quality)
    },
    {
      source: 'music.3e0.cn',
      resolve: () => resolveTxWithDreamMeting(playableInfo.songmid)
    }
  ]

  for (const resolver of resolvers) {
    try {
      const url = validateResolvedTxUrl(await resolver.resolve(), resolver.source)
      return {
        success: true,
        url,
        source: resolver.source,
        normalizedMusicId: playableInfo.songmid,
        idType: normalized.idType,
        mediaId: playableInfo.strMediaMid,
        attempts: [...attempts, { source: resolver.source, status: 'success' as const }]
      }
    } catch (error: any) {
      attempts.push({
        source: resolver.source,
        status: 'error',
        error: String(error?.message || error)
      })
    }
  }

  throw createError({
    statusCode: 502,
    message: `QQ 音乐播放链接解析失败：${attempts.map((item) => `${item.source}: ${item.error}`).join('；')}`,
    data: { attempts }
  })
})
