/**
 * QQ Music Owned Source Resolver
 * Uses official QQ Music API with user cookies to resolve high-quality playback URLs
 */

import type { H3Event } from 'h3'
import { randomUUID } from 'node:crypto'
import {
  getTxSongPlayableInfo,
  txRequest,
  upgradeTxAudioUrl,
  type TxSongPlayableInfo
} from './native_tx'
import {
  buildQqMusicAuthComm,
  buildQqMusicCookieHeader,
  buildQqMusicRequestHeaders,
  getQqMusicVipInfo,
  parseQqMusicCredentialCookie,
  type QqMusicVipInfo
} from './qq_music_auth'

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
const vipInfoCache = new Map<string, { info: QqMusicVipInfo; expiresAt: number }>()

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

function getCachedVipInfo(musicid: string): QqMusicVipInfo | null {
  const cached = vipInfoCache.get(musicid)
  if (!cached) return null

  if (cached.expiresAt <= Date.now()) {
    vipInfoCache.delete(musicid)
    return null
  }

  return cached.info
}

function setCachedVipInfo(musicid: string, info: QqMusicVipInfo): void {
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
  const credential = parseQqMusicCredentialCookie(cookieHeader)
  return credential ? buildQqMusicCookieHeader(credential) : null
}

// ============================================================================
// VIP Info Query
// ============================================================================

async function getVipInfo(cookie: string): Promise<QqMusicVipInfo> {
  const musicid = parseQqMusicCredentialCookie(cookie)?.musicid

  // Check cache
  if (musicid) {
    const cached = getCachedVipInfo(musicid)
    if (cached) {
      console.log(`[VipInfo] Cache hit for musicid=${musicid}`)
      return cached
    }
  }

  try {
    const vipInfo = await getQqMusicVipInfo(cookie)

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
  cookie: string
): Promise<{ url: string; quality: string } | null> {
  const { songmid, strMediaMid } = playableInfo
  const credential = parseQqMusicCredentialCookie(cookie)

  if (!strMediaMid || !credential) {
    console.warn('[OwnedSource] Missing media MID or QQ Music credential, cannot resolve')
    return null
  }

  const qualityFormats: Record<string, { prefix: string; extension: string }> = {
    flac24bit: { prefix: 'AI00', extension: '.flac' },
    flac: { prefix: 'F000', extension: '.flac' },
    '320k': { prefix: 'M800', extension: '.mp3' },
    '128k': { prefix: 'M500', extension: '.mp3' }
  }

  // Try each quality in the chain
  for (const quality of qualityChain) {
    try {
      const format = qualityFormats[quality]
      if (!format) continue
      const filename = `${format.prefix}${strMediaMid}${format.extension}`

      const payload = {
        comm: buildQqMusicAuthComm(credential),
        req_0: {
          module: 'music.vkey.GetVkey',
          method: 'UrlGetVkey',
          param: {
            guid: randomUUID().replaceAll('-', ''),
            songmid: [songmid],
            songtype: [0],
            uin: credential.musicid,
            filename: [filename],
            ctx: 0
          }
        }
      }

      const response: any = await txRequest('https://u.y.qq.com/cgi-bin/musicu.fcg', payload, {
        headers: buildQqMusicRequestHeaders(credential)
      })

      if (response?.code !== 0 || response?.req_0?.code !== 0 || !response?.req_0?.data) {
        continue
      }

      const data = response.req_0.data
      const midurlInfo = data.midurlinfo?.[0]

      if (!midurlInfo || !midurlInfo.purl) {
        continue
      }

      // Construct full URL
      const purl = midurlInfo.purl
      const sip = data.sip?.[0] || 'https://isure.stream.qqmusic.qq.com/'
      const fullUrl = /^https?:\/\//i.test(purl)
        ? purl
        : sip.endsWith('/') ? `${sip}${purl}` : `${sip}/${purl}`

      // Validate URL
      const validatedUrl = upgradeTxAudioUrl(fullUrl)
      if (validatedUrl.endsWith(INVALID_URL_SUFFIX)) {
        console.warn(`[OwnedSource] Invalid URL suffix detected for quality=${quality}`)
        continue
      }

      console.log(`[OwnedSource] Successfully resolved with quality=${quality}`)
      return { url: validatedUrl, quality }
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
    const resolved = await resolveWithOfficialApi(playableInfo, qualityChain, cookie)

    if (!resolved) {
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
    setCachedPlayUrl(cacheKey, {
      url: resolved.url,
      quality: resolved.quality,
      expiresAt: Date.now() + PLAY_URL_CACHE_TTL,
      source: 'owned-source'
    })

    return {
      success: true,
      url: resolved.url,
      quality: resolved.quality,
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
