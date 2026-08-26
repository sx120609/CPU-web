import {
  closeQqMusicQrSession,
  requireQqMusicAdmin
} from '~~/server/utils/qq_music_qr_login'

export default defineEventHandler(async (event) => {
  const user = requireQqMusicAdmin(event)
  closeQqMusicQrSession(user.id)
  deleteCookie(event, 'qq_music_session', { path: '/' })

  return {
    success: true,
    message: 'Logged out successfully'
  }
})
