import { createError, defineEventHandler } from 'h3'
import { eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { notifications } from '~/drizzle/schema'

export default defineEventHandler(async (event) => {
  const user = event.context.user

  if (!user) {
    throw createError({
      statusCode: 401,
      message: '需要登录才能清空通知'
    })
  }

  try {
    const result = await db.delete(notifications).where(eq(notifications.userId, user.id))

    return {
      success: true,
      count: result.rowCount || 0
    }
  } catch (error) {
    console.error('清空通知失败:', error)
    throw createError({
      statusCode: 500,
      message: '清空通知失败'
    })
  }
})
