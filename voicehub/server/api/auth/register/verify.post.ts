import { db, eq, users } from '~/drizzle/db'
import { JWTEnhanced } from '~~/server/utils/jwt-enhanced'
import { requireQQEmailOrNumber } from '~~/server/utils/qq-email'
import { getBeijingTime } from '~/utils/timeUtils'
import { getClientIP, sanitizeStoredClientIP } from '~~/server/utils/ip-utils'
import { verifyRegistrationActivationToken } from '~~/server/utils/registration-verification'
import { resolveQQDisplayProfile } from '~~/server/utils/qq-profile'
import { normalizeRoleOrDefault } from '~~/server/utils/role'
import { resolvePreferredAvatar } from '~~/server/utils/user-avatar'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const token = (body?.token || '').toString().trim()
  if (!token) {
    throw createError({
      statusCode: 400,
      message: '缺少激活令牌，请通过邮件中的激活链接完成验证'
    })
  }

  const verifyResult = verifyRegistrationActivationToken(token)
  if (!verifyResult.ok) {
    throw createError({
      statusCode: 400,
      message: verifyResult.message
    })
  }

  const qqEmail = requireQQEmailOrNumber(verifyResult.payload.email)
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
    if (verifyResult.payload.userId !== user.id) {
      throw createError({
        statusCode: 400,
        message: '激活链接与账号不匹配，请重新获取'
      })
    }

    await db
      .update(users)
      .set({
        emailVerified: true,
        lastLogin: getBeijingTime(),
        lastLoginIp: sanitizeStoredClientIP(getClientIP(event))
      })
      .where(eq(users.id, user.id))
  }

  const authToken = JWTEnhanced.generateToken(user.id, normalizedRole)
  const isSecure =
    getRequestURL(event).protocol === 'https:' ||
    getRequestHeader(event, 'x-forwarded-proto') === 'https'

  setCookie(event, 'auth-token', authToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/'
  })
  const qqProfile = await resolveQQDisplayProfile(user.username, qqEmail)
  return {
    success: true,
    message: '账号激活成功，已自动登录',
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
})
