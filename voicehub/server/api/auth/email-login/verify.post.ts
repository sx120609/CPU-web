import { db, eq, users } from '~/drizzle/db'
import { JWTEnhanced } from '~~/server/utils/jwt-enhanced'
import { getClientIP, sanitizeStoredClientIP } from '~~/server/utils/ip-utils'
import { requireQQEmailOrNumber } from '~~/server/utils/qq-email'
import { getBeijingTime } from '~/utils/timeUtils'
import { verifyPendingEmailLoginCode } from '~~/server/utils/email-login-verification'
import { resolveQQDisplayProfile } from '~~/server/utils/qq-profile'
import { normalizeRoleOrDefault } from '~~/server/utils/role'
import { resolvePreferredAvatar } from '~~/server/utils/user-avatar'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const qqEmail = requireQQEmailOrNumber(body?.email ?? body?.qqNumber ?? body?.qq)
    const code = (body?.code || '').toString().trim()

    if (!/^\d{6}$/.test(code)) {
      throw createError({
        statusCode: 400,
        message: '请输入 6 位数字验证码'
      })
    }

    const userResult = await db
      .select({
        id: users.id,
        username: users.username,
        name: users.name,
        avatar: users.avatar,
        grade: users.grade,
        class: users.class,
        role: users.role,
        status: users.status,
        emailVerified: users.emailVerified
      })
      .from(users)
      .where(eq(users.email, qqEmail))
      .limit(1)

    const user = userResult[0]
    if (!user) {
      throw createError({
        statusCode: 404,
        message: '账号不存在'
      })
    }
    const normalizedRole = normalizeRoleOrDefault(user.role, 'USER')

    if (user.status !== 'active') {
      throw createError({
        statusCode: 403,
        message: '账号当前不可用，请联系管理员处理'
      })
    }

    if (!user.emailVerified) {
      throw createError({
        statusCode: 403,
        message: '账号邮箱尚未激活，请先完成激活后登录'
      })
    }

    const verifyResult = verifyPendingEmailLoginCode(qqEmail, code)
    if (!verifyResult.ok) {
      throw createError({
        statusCode: 400,
        message: verifyResult.message
      })
    }

    if (verifyResult.userId !== user.id) {
      throw createError({
        statusCode: 400,
        message: '验证码与账号不匹配，请重新获取'
      })
    }

    const clientIp = getClientIP(event)
    await db
      .update(users)
      .set({
        lastLogin: getBeijingTime(),
        lastLoginIp: sanitizeStoredClientIP(clientIp)
      })
      .where(eq(users.id, user.id))

    if (!process.env.JWT_SECRET) {
      throw createError({
        statusCode: 500,
        message: '服务器配置错误：JWT_SECRET 未设置'
      })
    }

    const token = JWTEnhanced.generateToken(user.id, normalizedRole)
    const isSecure =
      getRequestURL(event).protocol === 'https:' ||
      getRequestHeader(event, 'x-forwarded-proto') === 'https'

    setCookie(event, 'auth-token', token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/'
    })
    const qqProfile = await resolveQQDisplayProfile(user.username, qqEmail)
    return {
      success: true,
      message: '登录成功',
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
        needsPasswordChange: false
      }
    }
  } catch (error: any) {
    console.error('[EmailLogin] verify failed:', error)
    if (error?.statusCode) {
      throw error
    }
    throw createError({
      statusCode: 500,
      message: '验证码登录失败，请稍后重试'
    })
  }
})
