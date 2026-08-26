export default defineEventHandler(async (event) => {
  deleteCookie(event, 'qq_music_session')

  return {
    success: true,
    message: 'Logged out successfully'
  }
})
