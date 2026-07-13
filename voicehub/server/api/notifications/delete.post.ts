import { createError, defineEventHandler, readBody } from 'h3'
import { eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { notifications } from '~/drizzle/schema'

export default defineEventHandler(async (event) => {
  const user = event.context.user

  if (!user) {
    throw createError({
      statusCode: 401,
      message: '需要登录才能删除通知'
    })
  }

  const body = await readBody(event)
  const id = Number(body?.notificationId)

  if (!Number.isInteger(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      message: '无效的通知ID'
    })
  }

  try {
    const notificationResult = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, id))
      .limit(1)
    const notification = notificationResult[0]

    if (!notification) {
      throw createError({
        statusCode: 404,
        message: '通知不存在'
      })
    }

    if (notification.userId !== user.id) {
      throw createError({
        statusCode: 403,
        message: '无权删除此通知'
      })
    }

    await db.delete(notifications).where(eq(notifications.id, id))

    return {
      success: true
    }
  } catch (error: any) {
    if (error?.statusCode) {
      throw error
    }

    console.error('删除通知失败:', error)
    throw createError({
      statusCode: 500,
      message: '删除通知失败'
    })
  }
})
