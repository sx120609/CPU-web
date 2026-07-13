import { createError } from 'h3'

export default defineEventHandler((event) => {
  const user = event.context.user
  if (!user) {
    throw createError({ statusCode: 401, message: '请先登录药大拾间' })
  }
  return { user, valid: true, source: 'cpu-web' }
})
