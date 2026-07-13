import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { db } from '~/drizzle/db'
import { users, userStatusLogs } from '~/drizzle/schema'
import { eq } from 'drizzle-orm'
import { updateUserPassword } from '~~/server/services/userService'
import { normalizeEmail, requireQQEmail } from '~~/server/utils/qq-email'
import { normalizeRole, normalizeRoleOrDefault } from '~~/server/utils/role'
import { sanitizeStoredClientIP } from '~~/server/utils/ip-utils'

export default defineEventHandler(async (event) => {
  try {
    // 检查认证和权限
    const user = event.context.user
    const operatorRole = normalizeRole(user?.role)
    if (!user || !operatorRole || !['ADMIN', 'SUPER_ADMIN'].includes(operatorRole)) {
      throw createError({
        statusCode: 403,
        statusMessage: '没有权限访问'
      })
    }

    const userId = getRouterParam(event, 'id')
    const parsedUserId = Number.parseInt(userId || '', 10)
    if (Number.isNaN(parsedUserId)) {
      throw createError({
        statusCode: 400,
        message: '无效的用户ID'
      })
    }

    const body = (await readBody(event)) as Record<string, unknown>
    const { name, username, password, role, grade, class: userClass, status, email, emailVerified } = body

    if (emailVerified !== undefined && typeof emailVerified !== 'boolean') {
      throw createError({
        statusCode: 400,
        message: 'emailVerified 必须是布尔值'
      })
    }

    // 检查用户是否存在
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.id, parsedUserId))
      .limit(1)

    if (existingUser.length === 0) {
      throw createError({
        statusCode: 404,
        message: '用户不存在'
      })
    }

    const targetUser = existingUser[0]

    // 1. 禁止修改系统初始超级管理员 (ID: 1)
    if (targetUser.id === 1) {
      throw createError({
        statusCode: 403,
        message: '无法修改系统初始超级管理员'
      })
    }

    // 2. 禁止对自身进行任何用户管理操作（包括角色、资料、状态、密码等）
    // 使用 String 转换确保 ID 比较的准确性
    if (String(userId) === String(user.id)) {
      throw createError({
        statusCode: 400,
        message: '禁止在用户管理中修改自己的账户'
      })
    }

    // 3. 越级修改保护
    // 如果目标用户是 SUPER_ADMIN，操作者必须是 SUPER_ADMIN
    const targetUserRole = normalizeRoleOrDefault(targetUser.role, 'USER')
    if (targetUserRole === 'SUPER_ADMIN' && operatorRole !== 'SUPER_ADMIN') {
      throw createError({
        statusCode: 403,
        message: '权限不足：普通管理员无法修改超级管理员信息'
      })
    }

    // 字段归一化（允许局部更新）
    const normalizedUsername =
      typeof username === 'string' ? username.trim() : (targetUser.username || '').trim()
    const normalizedName =
      typeof name === 'string' ? name.trim() : (targetUser.name || targetUser.username || '').trim()

    if (!normalizedUsername) {
      throw createError({
        statusCode: 400,
        message: '用户名不能为空'
      })
    }

    const normalizedFinalName = normalizedName || normalizedUsername

    // 检查用户名是否被其他用户使用
    if (normalizedUsername !== targetUser.username) {
      const duplicateUser = await db
        .select()
        .from(users)
        .where(eq(users.username, normalizedUsername))
        .limit(1)

      if (duplicateUser.length > 0) {
        throw createError({
          statusCode: 400,
          message: '用户名已被其他用户使用'
        })
      }
    }

    // 角色权限控制
    let validRole = targetUserRole
    if (typeof role === 'string') {
      const requestedRole = normalizeRole(role)
      if (!requestedRole) {
        throw createError({
          statusCode: 400,
          message: '无效的用户角色'
        })
      }
      // 超级管理员可以设置任何角色
      if (operatorRole === 'SUPER_ADMIN') {
        validRole = requestedRole
      }
      // 管理员只能设置管理员以下的角色（USER, SONG_ADMIN）
      else if (operatorRole === 'ADMIN') {
        if (['USER', 'SONG_ADMIN'].includes(requestedRole)) {
          validRole = requestedRole
        } else {
          throw createError({
            statusCode: 403,
            message: '管理员只能设置用户和歌曲管理员角色'
          })
        }
      }
      // 其他角色不能设置角色
      else {
        throw createError({
          statusCode: 403,
          message: '没有权限设置用户角色'
        })
      }
    }

    // 邮箱字段兼容：普通用户编辑时校验 QQ 邮箱，管理员账号允许非 QQ 邮箱
    let normalizedEmailValue = targetUser.email
    if (email !== undefined) {
      if (typeof email !== 'string') {
        throw createError({
          statusCode: 400,
          message: '邮箱格式无效'
        })
      }
      const trimmedEmail = email.trim()
      if (!trimmedEmail) {
        normalizedEmailValue = null
      } else if (validRole === 'USER' || targetUserRole === 'USER') {
        normalizedEmailValue = requireQQEmail(trimmedEmail)
      } else {
        normalizedEmailValue = normalizeEmail(trimmedEmail)
      }
    }

    if (
      normalizedEmailValue &&
      normalizedEmailValue !== (targetUser.email || '').toLowerCase()
    ) {
      const duplicateEmail = await db
        .select()
        .from(users)
        .where(eq(users.email, normalizedEmailValue))
        .limit(1)
      if (duplicateEmail.length > 0) {
        throw createError({
          statusCode: 400,
          message: '该邮箱已被其他用户使用'
        })
      }
    }

    // 验证 status 字段的有效性
    if (status !== undefined && status !== null && (typeof status !== 'string' || !['active', 'withdrawn'].includes(status))) {
      throw createError({
        statusCode: 400,
        message: '用户状态只能是active或withdrawn'
      })
    }

    // 准备更新数据
    const updateData: Record<string, any> = {
      name: normalizedFinalName,
      username: normalizedUsername,
      email: normalizedEmailValue,
      emailVerified: emailVerified ?? targetUser.emailVerified,
      role: validRole,
      grade: typeof grade === 'string' ? grade.trim() : targetUser.grade,
      class: typeof userClass === 'string' ? userClass.trim() : targetUser.class
    }

    // 如果提供了status，则更新状态相关字段
    if (typeof status === 'string' && status !== existingUser[0].status) {
      updateData.status = status
      updateData.statusChangedAt = new Date()
      updateData.statusChangedBy = user.id
    }

    // 如果提供了密码，则使用统一服务更新密码
    if (typeof password === 'string' && password) {
      await updateUserPassword(parsedUserId, password, true)
    }

    // 更新用户其他信息
    const updatedUser = await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, parsedUserId))
      .returning({
        id: users.id,
        name: users.name,
        username: users.username,
        email: users.email,
        emailVerified: users.emailVerified,
        role: users.role,
        grade: users.grade,
        class: users.class,
        status: users.status,
        statusChangedAt: users.statusChangedAt,
        statusChangedBy: users.statusChangedBy,
        lastLogin: users.lastLogin,
        lastLoginIp: users.lastLoginIp,
        passwordChangedAt: users.passwordChangedAt,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt
      })

    // 如果状态发生变更，记录到状态变更日志
    if (typeof status === 'string' && status !== existingUser[0].status) {
      await db.insert(userStatusLogs).values({
        userId: parsedUserId,
        oldStatus: existingUser[0].status,
        newStatus: status,
        reason: `管理员${user.name || user.username}修改用户状态`,
        operatorId: user.id
      })
    }

    // 清除相关缓存
    try {
      const { cache } = await import('~~/server/utils/cache-helpers')
      await cache.deletePattern('songs:*')
      // 清除该用户的认证缓存（角色或权限可能已变更）
      await cache.delete(`auth:user:${parsedUserId}`)
      console.log('[Cache] 歌曲和用户认证缓存已清除（用户更新）')
    } catch (cacheError) {
      console.warn('[Cache] 清除缓存失败:', cacheError)
    }

    return {
      success: true,
      user: {
        ...updatedUser[0],
        lastLoginIp: sanitizeStoredClientIP(updatedUser[0]?.lastLoginIp)
      },
      message: '用户更新成功'
    }
  } catch (error) {
    console.error('更新用户失败:', error)

    if (error.statusCode) {
      throw error
    }

    throw createError({
      statusCode: 500,
      message: '更新用户失败: ' + error.message
    })
  }
})
