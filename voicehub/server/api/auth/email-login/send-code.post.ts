import { db, eq, users } from '~/drizzle/db'
import { SmtpService } from '~~/server/services/smtpService'
import { getClientIP } from '~~/server/utils/ip-utils'
import { requireQQEmailOrNumber } from '~~/server/utils/qq-email'
import {
  getEmailLoginCodeResendRemainingSeconds,
  setPendingEmailLoginCode
} from '~~/server/utils/email-login-verification'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const qqEmail = requireQQEmailOrNumber(body?.email ?? body?.qqNumber ?? body?.qq)

    const userResult = await db
      .select({
        id: users.id,
        name: users.name,
        username: users.username,
        email: users.email,
        emailVerified: users.emailVerified,
        status: users.status
      })
      .from(users)
      .where(eq(users.email, qqEmail))
      .limit(1)

    const user = userResult[0]
    if (!user) {
      throw createError({
        statusCode: 404,
        message: '账号不存在，请先注册'
      })
    }

    if (user.status !== 'active') {
      throw createError({
        statusCode: 403,
        message: '账号当前不可用，请联系管理员处理'
      })
    }

    if (!user.email) {
      throw createError({
        statusCode: 400,
        message: '账号未绑定邮箱，无法使用验证码登录'
      })
    }

    if (!user.emailVerified) {
      throw createError({
        statusCode: 403,
        message: '账号邮箱尚未激活，请先完成激活后登录'
      })
    }

    const resendRemaining = getEmailLoginCodeResendRemainingSeconds(qqEmail)
    if (resendRemaining > 0) {
      throw createError({
        statusCode: 429,
        message: `发送过于频繁，请在 ${resendRemaining} 秒后重试`
      })
    }

    const pendingCode = setPendingEmailLoginCode(qqEmail, user.id)
    const smtp = SmtpService.getInstance()

    const sent = await smtp.renderAndSend(
      qqEmail,
      'verification.code',
      {
        name: user.name || user.username,
        email: qqEmail,
        code: pendingCode.code,
        expiresInMinutes: 10,
        action: '验证码登录'
      },
      getClientIP(event)
    )

    if (!sent) {
      throw createError({
        statusCode: 500,
        message: '验证码发送失败，请检查SMTP配置后重试'
      })
    }

    return {
      success: true,
      message: '验证码已发送，请查收邮箱',
      resendCooldownSeconds: 60
    }
  } catch (error: any) {
    console.error('[EmailLogin] send-code failed:', error)
    if (error?.statusCode) {
      throw error
    }
    throw createError({
      statusCode: 500,
      message: '发送登录验证码失败，请稍后重试'
    })
  }
})
