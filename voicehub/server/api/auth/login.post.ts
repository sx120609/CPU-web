import bcrypt from 'bcrypt'
import { db, eq, or, users } from '~/drizzle/db'
import { JWTEnhanced } from '~~/server/utils/jwt-enhanced'
import { getBeijingTime } from '~/utils/timeUtils'
import { getClientIP, sanitizeStoredClientIP } from '~~/server/utils/ip-utils'
import { isRegistrationEmailVerificationEnabled } from '~~/server/utils/registration-verification'
import { resolveQQDisplayProfile } from '~~/server/utils/qq-profile'
import { normalizeRoleOrDefault } from '~~/server/utils/role'
import { resolvePreferredAvatar } from '~~/server/utils/user-avatar'

export default defineEventHandler(async (event) => {
  const startTime = Date.now()
  const normalizeLoginFailureError = () =>
    createError({
      statusCode: 401,
      message: '账号或密码错误'
    })

  try {
    const body = await readBody(event)
    let clientIp = 'unknown'
    try {
      clientIp = getClientIP(event)
    } catch (ipError) {
      console.error('[Login] 获取客户端IP失败，使用unknown:', ipError)
    }

    if (!body.username || !body.password) {
      throw createError({
        statusCode: 400,
        message: '账号名和密码不能为空'
      })
    }
    const rawAccount = String(body.username).trim()
    const normalizedAccount = rawAccount.toLowerCase()
    const qqPrefixFromEmail = normalizedAccount.endsWith('@qq.com')
      ? normalizedAccount.slice(0, -'@qq.com'.length)
      : ''
    const usernameForLookup = qqPrefixFromEmail || rawAccount

    if (!process.env.JWT_SECRET) {
      console.error('JWT_SECRET environment variable is not set')
      throw createError({
        statusCode: 500,
        message: '服务器配置错误'
      })
    }

    // 数据库连接检查 - 使用简单的查询测试连接
    try {
      await db.select().from(users).limit(1)
    } catch (error) {
      console.error('Database connection error:', error)
      throw createError({
        statusCode: 503,
        message: '数据库服务暂时不可用'
      })
    }

    // 查找用户
    const userResult = await db
      .select({
        id: users.id,
        username: users.username,
        name: users.name,
        grade: users.grade,
        class: users.class,
        avatar: users.avatar,
        password: users.password,
        role: users.role,
        lastLogin: users.lastLogin,
        lastLoginIp: users.lastLoginIp,
        passwordChangedAt: users.passwordChangedAt,
        status: users.status,
        email: users.email,
        emailVerified: users.emailVerified
      })
      .from(users)
      .where(
        qqPrefixFromEmail
          ? or(eq(users.username, usernameForLookup), eq(users.email, normalizedAccount))
          : eq(users.username, usernameForLookup)
      )
      .limit(1)

    const user = userResult[0] || null

    if (!user) {
      throw normalizeLoginFailureError()
    }
    const normalizedRole = normalizeRoleOrDefault(user.role, 'USER')

    // 验证密码
    let isPasswordValid = false
    try {
      const passwordHash = typeof user.password === 'string' ? user.password : ''
      isPasswordValid = await bcrypt.compare(String(body.password), passwordHash)
    } catch (passwordCheckError) {
      // 历史脏数据或非法哈希不应导致接口崩溃，按密码错误处理。
      console.error('[Login] 密码校验异常:', passwordCheckError)
      isPasswordValid = false
    }

    if (!isPasswordValid) {
      throw normalizeLoginFailureError()
    }

    // 检查用户状态 (移到2FA之前，防止已注销用户进行2FA验证)
    if (user.status === 'withdrawn') {
      throw createError({
        statusCode: 403,
        message: '该账号已注销'
      })
    } else if (user.status === 'banned') {
      throw createError({
        statusCode: 403,
        message: '该账号已被封禁'
      })
    }

    const requireEmailVerification = await isRegistrationEmailVerificationEnabled()
    const shouldEnforceUserActivation = requireEmailVerification && normalizedRole === 'USER'

    if (shouldEnforceUserActivation && !user.emailVerified) {
      throw createError({
        statusCode: 403,
        message: '账号尚未激活，请先点击邮箱中的激活链接完成激活，或联系管理员手动激活',
        data: {
          code: 'ACCOUNT_NOT_ACTIVATED',
          email: user.email
        }
      })
    }

    // 管理员类账号不强制邮箱激活，首次登录自动补齐标记，避免后续被误拦截
    if (normalizedRole !== 'USER' && !user.emailVerified) {
      await db.update(users).set({ emailVerified: true }).where(eq(users.id, user.id))
      user.emailVerified = true
    }

    // 更新登录信息
    await db
      .update(users)
      .set({
        lastLogin: getBeijingTime(),
        lastLoginIp: sanitizeStoredClientIP(clientIp)
      })
      .where(eq(users.id, user.id))
      .catch((err) => console.error('Error updating user login info:', err))

    // 生成JWT
    const token = JWTEnhanced.generateToken(user.id, normalizedRole)

    // 自动判断是否需要secure
    const isSecure =
      getRequestURL(event).protocol === 'https:' ||
      getRequestHeader(event, 'x-forwarded-proto') === 'https'

    // 设置cookie
    setCookie(event, 'auth-token', token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7天
      path: '/'
    })

    const processingTime = Date.now() - startTime
    console.log(`Login for ${user.username} processed in ${processingTime}ms`)
    const qqProfile = await resolveQQDisplayProfile(user.username, user.email)
    return {
      success: true,
      user: {
        id: user.id,
        username: user.username,
        name: user.name || qqProfile?.name || user.username,
        grade: user.grade,
        class: user.class,
        role: normalizedRole,
        avatar: resolvePreferredAvatar({
          customAvatar: user.avatar,
          qqAvatar: qqProfile?.avatar
        }),
        needsPasswordChange: !user.passwordChangedAt
      }
    }
  } catch (error: any) {
    const errorTime = Date.now() - startTime
    console.error(`Login error after ${errorTime}ms:`, error)

    if (error.statusCode) {
      throw error
    }

    throw createError({
      statusCode: 500,
      message: '登录过程中发生未知错误'
    })
  }
})
