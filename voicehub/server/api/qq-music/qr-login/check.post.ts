import {
  getQqMusicQrSession,
  requireQqMusicAdmin
} from '~~/server/utils/qq_music_qr_login'

export default defineEventHandler(async (event) => {
  const user = requireQqMusicAdmin(event)
  const body = await readBody(event)
  const qrKey = body?.qrKey

  if (!qrKey) {
    throw createError({
      statusCode: 400,
      message: 'Missing qrKey parameter'
    })
  }

  const session = getQqMusicQrSession(user.id, String(qrKey))

  if (session.status === 'success' && session.credentialCookie) {
    setCookie(event, 'qq_music_session', session.credentialCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60
    })
  }

  return {
    status: session.status,
    success: session.status === 'success',
    error: session.error
  }
})
