import bcrypt from 'bcrypt'
import { db } from '~/drizzle/db'
import { users } from '~/drizzle/schema'
import { eq } from 'drizzle-orm'
import { requireQQEmail } from '~~/server/utils/qq-email'
import { normalizeRole } from '~~/server/utils/role'

export default defineEventHandler(async (event) => {
  // 检查认证和权限
  const user = event.context.user
  const operatorRole = normalizeRole(user?.role)
  if (!user || !operatorRole || !['ADMIN', 'SUPER_ADMIN'].includes(operatorRole)) {
    throw createError({
      statusCode: 403,
      message: '没有权限访问'
    })
  }

  const body = await readBody(event)

  // 验证必填字段
  if (!body.name || !body.username || !body.password || !body.email) {
    throw createError({
      statusCode: 400,
      message: '姓名、账号名、QQ邮箱和密码不能为空'
    })
  }

  try {
    const qqEmail = requireQQEmail(body.email)
    if (body.emailVerified !== undefined && typeof body.emailVerified !== 'boolean') {
      throw createError({
        statusCode: 400,
        message: 'emailVerified 必须是布尔值'
      })
    }

    // 检查用户名是否已存在
    const existingUserResult = await db
      .select()
      .from(users)
      .where(eq(users.username, body.username))
      .limit(1)
    const existingUser = existingUserResult[0]

    if (existingUser) {
      throw createError({
        statusCode: 400,
        message: '账号名已存在'
      })
    }

    // 检查 QQ 邮箱是否已存在
    const existingEmailResult = await db.select().from(users).where(eq(users.email, qqEmail)).limit(1)
    if (existingEmailResult[0]) {
      throw createError({
        statusCode: 400,
        message: '该QQ邮箱已被其他用户绑定'
      })
    }

    // 加密密码
    const hashedPassword = await bcrypt.hash(body.password, 10)

    // 角色权限控制
    let validRole = 'USER'
    const requestedRole = normalizeRole(body.role)
    if (requestedRole) {
      // 超级管理员可以创建任何角色的用户
      if (operatorRole === 'SUPER_ADMIN') {
        validRole = requestedRole
      }
      // 管理员只能创建管理员以下的角色（USER, SONG_ADMIN）
      else if (operatorRole === 'ADMIN') {
        if (['USER', 'SONG_ADMIN'].includes(requestedRole)) {
          validRole = requestedRole
        } else {
          throw createError({
            statusCode: 403,
            message: '管理员只能创建用户和歌曲管理员角色'
          })
        }
      }
      // 其他角色不能创建用户
      else {
        throw createError({
          statusCode: 403,
          message: '没有权限创建用户'
        })
      }
    }

    // 创建用户
    const newUserResult = await db
      .insert(users)
      .values({
        name: body.name,
        username: body.username,
        password: hashedPassword,
        role: validRole,
        grade: body.grade,
        class: body.class,
        email: qqEmail,
        emailVerified: body.emailVerified ?? true
      })
      .returning({
        id: users.id,
        name: users.name,
        username: users.username,
        email: users.email,
        emailVerified: users.emailVerified,
        role: users.role,
        grade: users.grade,
        class: users.class,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt
      })
    const newUser = newUserResult[0]

    // 清除相关缓存
    try {
      const { cache } = await import('~~/server/utils/cache-helpers')
      await cache.deletePattern('songs:*')
      await cache.deletePattern('stats:*')
      console.log('[Cache] 歌曲和统计缓存已清除（用户创建）')
    } catch (cacheError) {
      console.warn('[Cache] 清除缓存失败:', cacheError)
    }

    return {
      success: true,
      user: newUser,
      message: '用户创建成功'
    }
  } catch (error) {
    console.error('创建用户失败:', error)
    if ((error as any)?.statusCode) {
      throw error
    }
    throw createError({
      statusCode: 500,
      message: '创建用户失败'
    })
  }
})
