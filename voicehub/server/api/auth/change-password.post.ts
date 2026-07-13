import bcrypt from 'bcrypt'
import { db } from '~/drizzle/db'
import { users } from '~/drizzle/schema'
import { eq } from 'drizzle-orm'
import { recordLoginFailure, recordLoginSuccess } from '../../services/securityService'
import { updateUserPassword } from '../../services/userService'
import { getClientIP } from '~~/server/utils/ip-utils'
import { clearAuthTokenCookie } from '~~/server/utils/auth-cookie'

export default defineEventHandler(async (event) => {
  // 验证用户身份
  const user = event.context.user
  if (!user) {
    throw createError({
      statusCode: 401,
      message: '未授权'
    })
  }

  const body = await readBody(event)
  const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : ''
  const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : ''

  if (!currentPassword || !newPassword) {
    throw createError({
      statusCode: 400,
      message: '当前密码和新密码都是必需的'
    })
  }

  if (newPassword.length < 8) {
    throw createError({
      statusCode: 400,
      message: '新密码长度至少为8位'
    })
  }

  if (currentPassword === newPassword) {
    throw createError({
      statusCode: 400,
      message: '新密码不能与当前密码相同'
    })
  }

  try {
    // 查询用户详细信息
    const userDetailsResult = await db
      .select({
        id: users.id,
        username: users.username,
        password: users.password
      })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1)

    const userDetails = userDetailsResult[0]

    if (!userDetails) {
      throw createError({
        statusCode: 404,
        message: '用户不存在'
      })
    }

    if (!userDetails.password) {
      throw createError({
        statusCode: 400,
        message: '当前账号未设置密码，请联系管理员重置密码'
      })
    }

    // 验证当前密码
    const isPasswordValid = await bcrypt.compare(currentPassword, userDetails.password)

    if (!isPasswordValid) {
      // 记录安全事件
      const clientIp = getClientIP(event)
      recordLoginFailure(userDetails.username, clientIp)

      throw createError({
        statusCode: 400,
        message: '当前密码不正确'
      })
    }

    // 更新密码
    await updateUserPassword(user.id, newPassword)

    // 记录成功的密码修改
    const clientIp = getClientIP(event)
    recordLoginSuccess(userDetails.username, clientIp)

    // 立即清除认证 cookie，避免旧 token 在前端引发 401 连锁
    clearAuthTokenCookie(event)

    return {
      success: true,
      message: '密码修改成功，请重新登录'
    }
  } catch (error: any) {
    // 已格式化的错误直接抛出
    if (error.statusCode) {
      throw error
    }

    // 记录错误信息
    console.error('修改密码过程中发生未处理的错误:', error)

    // 创建错误响应
    throw createError({
      statusCode: 500,
      message: '修改密码失败: ' + (error.message || '未知错误')
    })
  }
})
