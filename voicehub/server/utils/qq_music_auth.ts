import { txRequest } from './native_tx'

const QQ_MUSIC_API_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg'

export interface QqMusicCredential {
  musicid: string
  musickey: string
}

export interface QqMusicVipInfo {
  hasVip: boolean
  vipType: number
  level: number
  expireTime: number
}

const asRecord = (value: unknown): Record<string, unknown> => {
  return value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}
}

const asNumber = (value: unknown) => {
  const result = Number(value)
  return Number.isFinite(result) ? result : 0
}

const firstPositiveNumber = (...values: unknown[]) => {
  for (const value of values) {
    const number = asNumber(value)
    if (number > 0) return number
  }
  return 0
}

const parseExpireTime = (...values: unknown[]) => {
  for (const value of values) {
    const numeric = asNumber(value)
    if (numeric > 0) {
      return numeric > 10_000_000_000 ? Math.floor(numeric / 1000) : Math.floor(numeric)
    }

    if (typeof value === 'string' && value.trim()) {
      const timestamp = Date.parse(value)
      if (Number.isFinite(timestamp)) return Math.floor(timestamp / 1000)
    }
  }
  return 0
}

export const parseQqMusicCredentialCookie = (cookie: string): QqMusicCredential | null => {
  const values = new Map<string, string>()
  for (const item of cookie.split(';')) {
    const separator = item.indexOf('=')
    if (separator <= 0) continue
    values.set(item.slice(0, separator).trim(), item.slice(separator + 1).trim())
  }

  const musicid = values.get('musicid') || values.get('qqmusic_uin') || values.get('uin') || ''
  const musickey = values.get('qm_keyst') || values.get('qqmusic_key') || ''
  if (!musicid || !musickey || /[;\r\n]/.test(musicid) || /[;\r\n]/.test(musickey)) {
    return null
  }
  return { musicid, musickey }
}

export const buildQqMusicCookieHeader = (credential: QqMusicCredential) => {
  return [
    `uin=${credential.musicid}`,
    `qqmusic_uin=${credential.musicid}`,
    `musicid=${credential.musicid}`,
    `qqmusic_key=${credential.musickey}`,
    `qm_keyst=${credential.musickey}`
  ].join('; ')
}

export const buildQqMusicRequestHeaders = (credential: QqMusicCredential) => ({
  Cookie: buildQqMusicCookieHeader(credential),
  Referer: 'https://y.qq.com/',
  Origin: 'https://y.qq.com',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
})

export const qqMusicHash33 = (value: string, initial = 5381) => {
  let hash = initial
  for (const character of value) {
    hash = ((hash << 5) + hash + character.charCodeAt(0)) & 0x7fffffff
  }
  return hash
}

export const buildQqMusicAuthComm = (credential: QqMusicCredential) => {
  const gTk = qqMusicHash33(credential.musickey)
  return {
    ct: 24,
    cv: 4747474,
    platform: 'yqq.json',
    chid: '0',
    uin: Number(credential.musicid) || credential.musicid,
    g_tk: gTk,
    g_tk_new_20200303: gTk,
    format: 'json',
    inCharset: 'utf-8',
    outCharset: 'utf-8',
    notice: 0,
    need_new_code: 1
  }
}

export const normalizeQqMusicVipInfo = (value: unknown): QqMusicVipInfo => {
  const data = asRecord(value)
  const identity = asRecord(data.identity)
  const userinfo = asRecord(data.userinfo)

  // Keep the former response shape as a compatibility fallback while the
  // current QQ Music client API uses identity/userinfo.
  const legacyPackage = asRecord(data.musipackage_vip)
  const vip = firstPositiveNumber(identity.vip, legacyPackage.vip_level)
  const hugeVip = firstPositiveNumber(identity.HugeVip, data.svip)
  const hasVip = vip > 0 || hugeVip > 0

  return {
    hasVip,
    vipType: hugeVip > 0 ? 8 : hasVip ? 4 : 0,
    level: firstPositiveNumber(identity.level, legacyPackage.vip_level),
    expireTime: parseExpireTime(
      userinfo.expire,
      identity.HugeVipEnd,
      identity.vip_end,
      legacyPackage.vip_end_time
    )
  }
}

export const getQqMusicVipInfo = async (cookie: string): Promise<QqMusicVipInfo> => {
  const credential = parseQqMusicCredentialCookie(cookie)
  if (!credential) throw new Error('QQ 音乐登录凭据不完整')

  const payload = {
    comm: buildQqMusicAuthComm(credential),
    req_0: {
      module: 'VipLogin.VipLoginInter',
      method: 'vip_login_base',
      param: {}
    }
  }
  const response = asRecord(await txRequest(QQ_MUSIC_API_URL, payload, {
    headers: buildQqMusicRequestHeaders(credential)
  }))
  const request = asRecord(response.req_0)
  if (
    !Object.hasOwn(response, 'req_0')
    || !Object.hasOwn(request, 'data')
    || asNumber(response.code) !== 0
    || asNumber(request.code) !== 0
  ) {
    throw new Error(`QQ 音乐会员接口返回异常（code=${request.code ?? response.code ?? 'unknown'}）`)
  }
  return normalizeQqMusicVipInfo(request.data)
}
