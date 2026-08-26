import {
  createQqMusicQrSession,
  requireQqMusicAdmin
} from '~~/server/utils/qq_music_qr_login'

export default defineEventHandler(async (event) => {
  const user = requireQqMusicAdmin(event)

  try {
    const session = await createQqMusicQrSession(user.id)

    return {
      success: true,
      ...session
    }
  } catch (error: unknown) {
    throw createError({
      statusCode: 502,
      message: error instanceof Error ? error.message : 'QQ 音乐二维码生成失败'
    })
  }
})
