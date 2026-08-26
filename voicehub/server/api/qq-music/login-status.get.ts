import type { VipInfo } from '~~/server/utils/qq_music_owned_source'

interface VipInfoInternal {
  hasVip: boolean
  vipType: number
  level: number
  expireTime: number
}

async function getVipInfoInternal(cookie: string): Promise<VipInfoInternal> {
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

  const response = await fetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookie,
      'Referer': 'https://y.qq.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    body: JSON.stringify(payload)
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  const data: any = await response.json()

  if (data?.code !== 0 || !data?.GetVipInfo) {
    throw new Error(`GetVipInfo failed: code=${data?.code}`)
  }

  const vipData = data.GetVipInfo.data || {}
  const musicPackage = vipData.musipackage_vip || {}

  return {
    hasVip: (musicPackage.vip_level || 0) > 0,
    vipType: musicPackage.vip_type || 0,
    level: musicPackage.vip_level || 0,
    expireTime: musicPackage.vip_end_time || 0
  }
}

export default defineEventHandler(async (event) => {
  const cookie = getCookie(event, 'qq_music_session')

  if (!cookie) {
    return {
      isLoggedIn: false,
      vipInfo: null
    }
  }

  try {
    const vipInfo = await getVipInfoInternal(cookie)

    return {
      isLoggedIn: true,
      vipInfo
    }
  } catch (error: any) {
    console.error('[LoginStatus] Failed to get VIP info:', error.message)
    return {
      isLoggedIn: false,
      vipInfo: null
    }
  }
})
