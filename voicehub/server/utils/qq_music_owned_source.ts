/**
 * QQ Music Owned Source Resolver
 * Uses official QQ Music API with user cookies to resolve high-quality playback URLs
 */

import type { H3Event } from 'h3'
import {
  getTxSongPlayableInfo,
  txSignedRequest,
  upgradeTxAudioUrl,
  type TxSongPlayableInfo
} from './native_tx'

// ============================================================================
// Types
// ============================================================================

export interface ResolveResult {
  success: boolean
  url?: string
  quality?: string
  source?: string
  error?: string
  attempts?: Array<{
    source: string
    status: 'success' | 'error'
    error?: string
  }>
}

interface VipInfo {
  hasVip: boolean
  vipType: number
  level: number
  expireTime: number
}

interface CachedPlayUrl {
  url: string
  quality: string
  expiresAt: number
  source: string
}

// ============================================================================
// Constants
// ============================================================================

const PLAY_URL_CACHE_TTL = 4 * 60 * 60 * 1000 // 4 hours
const VIP_INFO_CACHE_TTL = 60 * 60 * 1000 // 1 hour
const CACHE_MAX_SIZE = 500
const VIP_CACHE_MAX_SIZE = 100

const INVALID_URL_SUFFIX = '/2149972737147268278.mp3'

// Quality chains by VIP level
const QUALITY_CHAINS = {
  super: ['flac24bit', 'flac', '320k', '128k'], // vipType >= 4
  green: ['flac', '320k', '128k'],              // vipType > 0
  normal: ['320k', '128k']                      // vipType === 0
}

// ============================================================================
// Cache Storage
// ============================================================================

const playUrlCache = new Map<string, CachedPlayUrl>()
const vipInfoCache = new Map<string, { info: VipInfo; expiresAt: number }>()

function getCachedPlayUrl(key: string): CachedPlayUrl | null {
  const cached = playUrlCache.get(key)
  if (!cached) return null

  if (cached.expiresAt <= Date.now()) {
    playUrlCache.delete(key)
    return null
  }

  return cached
}

function setCachedPlayUrl(key: string, value: CachedPlayUrl): void {
  if (playUrlCache.size >= CACHE_MAX_SIZE) {
    const firstKey = playUrlCache.keys().next().value
    if (firstKey) playUrlCache.delete(firstKey)
  }
  playUrlCache.set(key, value)
}

function getCachedVipInfo(musicid: string): VipInfo | null {
  const cached = vipInfoCache.get(musicid)
  if (!cached) return null

  if (cached.expiresAt <= Date.now()) {
    vipInfoCache.delete(musicid)
    return null
  }

  return cached.info
}

function setCachedVipInfo(musicid: string, info: VipInfo): void {
  if (vipInfoCache.size >= VIP_CACHE_MAX_SIZE) {
    const firstKey = vipInfoCache.keys().next().value
    if (firstKey) vipInfoCache.delete(firstKey)
  }
  vipInfoCache.set(musicid, {
    info,
    expiresAt: Date.now() + VIP_INFO_CACHE_TTL
  })
}

// ============================================================================
// Cookie Detection
// ============================================================================

function detectCookieFromRequest(event: H3Event): string | null {
  const cookieHeader = getHeader(event, 'cookie')
  if (!cookieHeader) return null

  // Check for QQ Music specific cookies
  const hasQqMusicKey = /qqmusic_key=/.test(cookieHeader)
  const hasQmKeyst = /qm_keyst=/.test(cookieHeader)

  if (hasQqMusicKey || hasQmKeyst) {
    return cookieHeader
  }

  return null
}

function extractMusicIdFromCookie(cookie: string): string | null {
  const match = cookie.match(/musicid=([^;]+)/)
  return match ? match[1] : null
}

// ============================================================================
// VIP Info Query
// ============================================================================

async function getVipInfo(cookie: string): Promise<VipInfo> {
  const musicid = extractMusicIdFromCookie(cookie)

  // Check cache
  if (musicid) {
    const cached = getCachedVipInfo(musicid)
    if (cached) {
      console.log(`[VipInfo] Cache hit for musicid=${musicid}`)
      return cached
    }
  }

  // Query VIP status from QQ Music API
  const payload = {
    comm: {
      g_tk: 5,
      format: 'json',
      ct: 24,
      cv: 0
    },
    GetVipInfo: {
      module: 'VipQuery.VipQueryServer',
      method: 'GetVipInfo',
      param: {}
    }
  }

  try {
    const response: any = await txSignedRequest(payload)

    if (response?.code !== 0 || !response?.GetVipInfo) {
      throw new Error(`GetVipInfo failed: code=${response?.code}`)
    }

    const vipData = response.GetVipInfo.data || {}
    const musicPackage = vipData.musipackage_vip || {}

    const vipInfo: VipInfo = {
      hasVip: (musicPackage.vip_level || 0) > 0,
      vipType: musicPackage.vip_type || 0,
      level: musicPackage.vip_level || 0,
      expireTime: musicPackage.vip_end_time || 0
    }

    // Cache result
    if (musicid) {
      setCachedVipInfo(musicid, vipInfo)
    }

    console.log(`[VipInfo] hasVip=${vipInfo.hasVip}, vipType=${vipInfo.vipType}, level=${vipInfo.level}`)

    return vipInfo
  } catch (error: any) {
    console.error('[VipInfo] Query failed:', error.message)
    // Return default (non-VIP)
    return {
      hasVip: false,
      vipType: 0,
      level: 0,
      expireTime: 0
    }
  }
}

// ============================================================================
// Quality Selection
// ============================================================================

function normalizeQualityParam(quality: unknown): string {
  if (!quality) return '320k'

  const qualityMap: Record<string, string> = {
    '4': '128k',
    '8': '320k',
    '10': 'flac',
    '11': 'flac24bit',
    '14': 'flac24bit',
    '128': '128k',
    '320': '320k',
    '128k': '128k',
    '320k': '320k',
    'flac': 'flac',
    'sq': 'flac',
    'hires': 'flac24bit',
    'flac24bit': 'flac24bit'
  }

  const key = String(quality).toLowerCase()
  return qualityMap[key] || '320k'
}

function selectQualityChain(vipType: number, requestedQuality: string): string[] {
  let baseChain: string[]

  if (vipType >= 4) {
    baseChain = QUALITY_CHAINS.super
  } else if (vipType > 0) {
    baseChain = QUALITY_CHAINS.green
  } else {
    baseChain = QUALITY_CHAINS.normal
  }

  // Reorder chain to prioritize requested quality
  const normalized = normalizeQualityParam(requestedQuality)
  const index = baseChain.indexOf(normalized)

  if (index === -1) {
    return baseChain
  }

  // Move requested quality to front, keep fallback order
  return [
    ...baseChain.slice(index),
    ...baseChain.slice(0, index)
  ]
}

// ============================================================================
// URL Resolution
// ============================================================================

async function resolveWithOfficialApi(
  playableInfo: TxSongPlayableInfo,
  qualityChain: string[],
  cookie?: string
): Promise<string | null> {
  const { songmid, strMediaMid } = playableInfo

  if (!strMediaMid) {
    console.warn('[OwnedSource] Missing strMediaMid, cannot resolve')
    return null
  }

  // Try each quality in the chain
  for (const quality of qualityChain) {
    try {
      const fileExt = quality.includes('flac') ? 'flac' : 'm4a'
      const filename = `${strMediaMid}.${fileExt}`

      const payload = {
        comm: {
          g_tk: 5,
          uin: 0,
          format: 'json',
          ct: 24,
          cv: 0
        },
        GetPlayUrl: {
          module: 'vkey.GetVkeyServer',
          method: 'CgiGetVkey',
          param: {
            guid: '0',
            songmid: [songmid],
            songtype: [0],
            uin: '0',
            loginflag: cookie ? 1 : 0,
            platform: '20',
            filename: [filename]
          }
        }
      }

      const response: any = await txSignedRequest(payload)

      if (response?.code !== 0 || !response?.GetPlayUrl?.data) {
        continue
      }

      const data = response.GetPlayUrl.data
      const midurlInfo = data.midurlinfo?.[0]

      if (!midurlInfo || !midurlInfo.purl) {
        continue
      }

      // Construct full URL
      const purl = midurlInfo.purl
      const sip = data.sip?.[0] || 'https://ws.stream.qqmusic.qq.com/'
      const fullUrl = sip.endsWith('/') ? `${sip}${purl}` : `${sip}/${purl}`

      // Validate URL
      const validatedUrl = upgradeTxAudioUrl(fullUrl)
      if (validatedUrl.endsWith(INVALID_URL_SUFFIX)) {
        console.warn(`[OwnedSource] Invalid URL suffix detected for quality=${quality}`)
        continue
      }

      console.log(`[OwnedSource] Successfully resolved with quality=${quality}`)
      return validatedUrl
    } catch (error: any) {
      console.warn(`[OwnedSource] Failed to resolve quality=${quality}:`, error.message)
    }
  }

  return null
}

// ============================================================================
// Main Export
// ============================================================================

/**
 * Resolve QQ Music playback URL using owned source (official API with cookies)
 */
export async function resolveQqMusicOwnedSource(
  event: H3Event,
  musicId: string | number,
  quality?: unknown
): Promise<ResolveResult> {
  const attempts: ResolveResult['attempts'] = []

  try {
    // Step 1: Detect cookie - check both request headers and server-side session
    let cookie = detectCookieFromRequest(event)

    // If no cookie from request, check server-side session cookie
    if (!cookie) {
      const sessionCookie = getCookie(event, 'qq_music_session')
      if (sessionCookie) {
        cookie = sessionCookie
      }
    }

    if (!cookie) {
      return {
        success: false,
        error: '未检测到 QQ 音乐 Cookie',
        attempts: [{
          source: 'owned-source',
          status: 'error',
          error: '未检测到 Cookie'
        }]
      }
    }

    // Step 2: Get song metadata
    const playableInfo = await getTxSongPlayableInfo(musicId)
    const { songmid } = playableInfo

    // Step 3: Query VIP status
    const vipInfo = await getVipInfo(cookie)
    const normalizedQuality = normalizeQualityParam(quality)

    // Step 4: Check cache
    const cacheKey = `tx_play_url:${songmid}:${normalizedQuality}:${vipInfo.hasVip}`
    const cached = getCachedPlayUrl(cacheKey)

    if (cached) {
      console.log(`[OwnedSource] Cache hit: ${cacheKey}`)
      return {
        success: true,
        url: cached.url,
        quality: cached.quality,
        source: 'owned-source',
        attempts: [{
          source: 'owned-source',
          status: 'success'
        }]
      }
    }

    // Step 5: Select quality chain
    const qualityChain = selectQualityChain(vipInfo.vipType, normalizedQuality)
    console.log(`[OwnedSource] Quality chain:`, qualityChain)

    // Step 6: Resolve with official API
    const url = await resolveWithOfficialApi(playableInfo, qualityChain, cookie)

    if (!url) {
      return {
        success: false,
        error: '官方接口未返回有效播放链接',
        attempts: [{
          source: 'owned-source',
          status: 'error',
          error: '未返回有效播放链接'
        }]
      }
    }

    // Step 7: Cache result
    const actualQuality = qualityChain[0] // First in chain is what we got
    setCachedPlayUrl(cacheKey, {
      url,
      quality: actualQuality,
      expiresAt: Date.now() + PLAY_URL_CACHE_TTL,
      source: 'owned-source'
    })

    return {
      success: true,
      url,
      quality: actualQuality,
      source: 'owned-source',
      attempts: [{
        source: 'owned-source',
        status: 'success'
      }]
    }
  } catch (error: any) {
    console.error('[OwnedSource] Resolution failed:', error.message)
    return {
      success: false,
      error: error.message || '未知错误',
      attempts: [{
        source: 'owned-source',
        status: 'error',
        error: error.message || '未知错误'
      }]
    }
  }
}
