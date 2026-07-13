import { db } from '~/drizzle/db'
import { users } from '~/drizzle/schema'
import { eq } from 'drizzle-orm'
import { isValidQQEmail } from '~~/server/utils/qq-email'

export default defineEventHandler(async (event) => {
  // 检查请求方法
  if (getMethod(event) !== 'POST') {
    throw createError({
      statusCode: 405,
      message: '方法不被允许'
    })
  }

  // 检查用户认证
  const user = event.context.user

  if (!user) {
    throw createError({
      statusCode: 401,
      message: '未授权访问'
    })
  }

  try {
    // 获取用户邮箱信息
    const userResult = await db.select().from(users).where(eq(users.id, user.id)).limit(1)

    const currentUser = userResult[0]

    if (!currentUser?.email) {
      throw createError({
        statusCode: 400,
        message: '请先绑定QQ邮箱'
      })
    }

    const currentEmail = currentUser.email.toLowerCase()
    if (!isValidQQEmail(currentEmail)) {
      throw createError({
        statusCode: 400,
        message: '当前邮箱不是QQ邮箱，请先更换为QQ邮箱'
      })
    }

    if (!currentUser.emailVerified) {
      await db.update(users).set({ emailVerified: true }).where(eq(users.id, user.id))
    }

    return { success: true, message: 'QQ邮箱已自动验证，无需验证码' }
  } catch (error: any) {
    console.error('重新发送验证邮件失败:', error)

    if (error?.statusCode) {
      throw error
    }

    throw createError({
      statusCode: 500,
      message: '重新发送验证邮件失败'
    })
  }
})
