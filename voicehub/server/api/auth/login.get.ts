export default defineEventHandler(() => {
  throw createError({
    statusCode: 405,
    message: 'Method Not Allowed'
  })
})
