import { db, eq, users } from '~/drizzle/db'
import { SmtpService } from '~~/server/services/smtpService'
import { getClientIP } from '~~/server/utils/ip-utils'
import { requireQQEmailOrNumber } from '~~/server/utils/qq-email'
import {
  createPasswordResetToken,
  getPasswordResetExpiresMinutes
} from '~~/server/utils/password-reset'
import { buildPublicAppUrl } from '~~/server/utils/public-url'

const buildForgotPasswordUrl = (event: any, token: string) => {
  return buildPublicAppUrl(event, `/forgot-password?token=${encodeURIComponent(token)}`)
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const qqEmail = requireQQEmailOrNumber(body?.email ?? body?.qqNumber ?? body?.qq)
  const expiresInMinutes = getPasswordResetExpiresMinutes()

  try {
    const userResult = await db
      .select({
        id: users.id,
        name: users.name,
        username: users.username,
        status: users.status
      })
      .from(users)
      .where(eq(users.email, qqEmail))
      .limit(1)

    const user = userResult[0]
    if (user && user.status === 'active') {
      const token = createPasswordResetToken(qqEmail, user.id)
      const resetUrl = buildForgotPasswordUrl(event, token)
      const smtp = SmtpService.getInstance()

      await smtp.renderAndSend(
        qqEmail,
        'password.reset.link',
        {
          name: user.name || user.username,
          email: qqEmail,
          action: '找回密码',
          actionUrl: resetUrl,
          resetUrl,
          expiresInMinutes
        },
        getClientIP(event)
      )
    }
  } catch (error) {
    console.error('[ForgotPassword] send-link failed:', error)
  }

  // 统一返回，避免邮箱枚举
  return {
    success: true,
    message: `如果该账号存在，重置链接已发送到邮箱（${expiresInMinutes}分钟内有效）`
  }
})
