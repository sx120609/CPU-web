import { db } from '~/drizzle/db'
import { users } from '~/drizzle/schema'
import {
  createBatchSystemNotifications,
  createSystemNotification
} from '../../../services/notificationService'
import { getClientIP } from '~~/server/utils/ip-utils'
import { and, inArray } from 'drizzle-orm'
import { visibleUserCondition } from '~~/server/utils/ghost-user'

export default defineEventHandler(async (event) => {
  // 检查用户是否为管理员
  const user = event.context.user

  if (!user) {
    throw createError({
      statusCode: 401,
      message: '未授权访问'
    })
  }

  if (!['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    throw createError({
      statusCode: 403,
      message: '只有管理员可以发送系统通知'
    })
  }

  try {
    // 获取客户端IP地址
    const clientIP = getClientIP(event)

    // 获取请求数据
    const body = await readBody(event)
    const { title, message, content, scope, filter, userId } = body

    // 处理单个用户通知（用于权限变更等系统通知）
    if (userId && title && (message || content)) {
      const notificationContent = message || content
      const result = await createSystemNotification(userId, title, notificationContent, clientIP)

      if (result?.count) {
        return {
          success: true,
          message: '通知发送成功',
          sentCount: result.count,
          totalUsers: 1
        }
      } else {
        throw createError({
          statusCode: 400,
          message: '该用户尚未对接主站账号，通知未发送'
        })
      }
    }

    // 验证批量通知请求数据
    if (!title || !content) {
      throw createError({
        statusCode: 400,
        message: '通知标题和内容不能为空'
      })
    }

    if (!scope || !['ALL', 'SPECIFIC_USERS'].includes(scope)) {
      throw createError({
        statusCode: 400,
        message: '无效的通知范围'
      })
    }

    // 查询符合条件的用户IDs
    let userIds: number[] = []

    if (scope === 'ALL') {
      // 查询所有用户
      const allUsers = await db
        .select({ id: users.id })
        .from(users)
        .where(visibleUserCondition())
      userIds = allUsers.map((user) => user.id)
    } else if (scope === 'SPECIFIC_USERS') {
      // 指定用户
      if (!filter?.userIds || !Array.isArray(filter.userIds) || filter.userIds.length === 0) {
        throw createError({
          statusCode: 400,
          message: '未选择任何用户'
        })
      }

      const requestedIds = filter.userIds
        .map((id: unknown) => Number(id))
        .filter((id: number) => Number.isInteger(id) && id > 0)
      if (requestedIds.length > 0) {
        const visibleUsers = await db
          .select({ id: users.id })
          .from(users)
          .where(and(inArray(users.id, requestedIds), visibleUserCondition()))
        userIds = visibleUsers.map((visibleUser) => visibleUser.id)
      }
    }

    if (userIds.length === 0) {
      return {
        success: true,
        message: '没有找到符合条件的用户',
        sentCount: 0,
        totalUsers: 0
      }
    }

    // 使用通知服务批量发送通知
    const result = await createBatchSystemNotifications(userIds, title, content, clientIP)

    if (!result) {
      throw new Error('发送通知失败')
    }

    // 处理结果
    let sentCount = 0
    let totalUsers = userIds.length

    // 判断result类型
    if (Array.isArray(result)) {
      sentCount = result.length
    } else if (result && typeof result === 'object' && 'count' in result) {
      sentCount = result.count
      totalUsers = result.total || userIds.length
    }

    return {
      success: true,
      message: '通知发送成功',
      sentCount,
      totalUsers
    }
  } catch (error: unknown) {
    console.error('发送通知失败:', error)

    const statusCode =
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? Number(error.statusCode) || 500
        : 500
    const message = error instanceof Error ? error.message : '发送通知失败'

    throw createError({
      statusCode,
      message
    })
  }
})
