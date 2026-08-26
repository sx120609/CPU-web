import { requireQqMusicAdmin } from '~~/server/utils/qq_music_qr_login'
import { getQqMusicVipInfo } from '~~/server/utils/qq_music_auth'

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
    const vipInfo = await getQqMusicVipInfo(cookie)

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
      isLoggedIn: true,
      vipInfo: null,
      vipInfoError: '会员状态暂时无法读取'
    }
  }
})
