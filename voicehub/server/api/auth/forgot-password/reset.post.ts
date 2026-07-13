import { and, eq } from 'drizzle-orm'
import { db, users } from '~/drizzle/db'
import { updateUserPassword } from '~~/server/services/userService'
import { verifyPasswordResetToken } from '~~/server/utils/password-reset'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const token = (body?.token || '').toString().trim()
  const newPassword = (body?.password || '').toString()

  if (!token) {
    throw createError({
      statusCode: 400,
      message: '缺少重置令牌'
    })
  }

  if (!newPassword || newPassword.length < 6) {
    throw createError({
      statusCode: 400,
      message: '新密码长度不能少于6位'
    })
  }

  const verifyResult = verifyPasswordResetToken(token)
  if (!verifyResult.ok) {
    throw createError({
      statusCode: 400,
      message: verifyResult.message
    })
  }

  const { userId, email } = verifyResult.payload

  const userResult = await db
    .select({
      id: users.id,
      status: users.status,
      email: users.email
    })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.email, email)))
    .limit(1)

  const user = userResult[0]
  if (!user) {
    throw createError({
      statusCode: 404,
      message: '账号不存在或重置链接无效'
    })
  }

  if (user.status !== 'active') {
    throw createError({
      statusCode: 403,
      message: '账号当前不可用，请联系管理员处理'
    })
  }

  await updateUserPassword(user.id, newPassword, false)

  return {
    success: true,
    message: '密码重置成功，请使用新密码登录'
  }
})
