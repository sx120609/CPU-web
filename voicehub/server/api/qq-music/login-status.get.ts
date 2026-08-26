import { requireQqMusicAdmin } from '~~/server/utils/qq_music_qr_login'

interface VipInfoInternal {
  hasVip: boolean
  vipType: number
  level: number
  expireTime: number
}

interface VipQueryResponse {
  code?: number
  GetVipInfo?: {
    data?: {
      musipackage_vip?: {
        vip_level?: number
        vip_type?: number
        vip_end_time?: number
      }
    }
  }
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

  const data = await response.json() as VipQueryResponse

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
  requireQqMusicAdmin(event)
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
  } catch (error: unknown) {
    console.error(
      '[LoginStatus] Failed to get VIP info:',
      error instanceof Error ? error.message : String(error)
    )
    return {
      isLoggedIn: false,
      vipInfo: null
    }
  }
})
