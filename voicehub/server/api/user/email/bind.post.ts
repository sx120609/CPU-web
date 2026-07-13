import { db } from '~/drizzle/db'
import { users } from '~/drizzle/schema'
import { eq } from 'drizzle-orm'
import { requireQQEmail } from '~~/server/utils/qq-email'

export default defineEventHandler(async (event) => {
  // 检查请求方法
  if (event.method !== 'POST') {
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
    const body = await readBody(event)

    const email = requireQQEmail(body.email)

    // 检查邮箱是否已被其他用户绑定
    const existingUser = await db.select().from(users).where(eq(users.email, email)).limit(1)

    if (existingUser.length > 0 && existingUser[0].id !== user.id) {
      throw createError({
        statusCode: 400,
        message: '该邮箱已被其他用户绑定'
      })
    }

    // 更新用户邮箱
    await db
      .update(users)
      .set({
        email: email,
        emailVerified: true
      })
      .where(eq(users.id, user.id))

    return {
      success: true,
      message: 'QQ邮箱绑定成功'
    }
  } catch (error: any) {
    console.error('绑定邮箱失败:', error)

    if (error?.statusCode) {
      throw error
    }

    throw createError({
      statusCode: 500,
      message: '绑定邮箱失败'
    })
  }
})
