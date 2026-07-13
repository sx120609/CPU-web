import { db, eq, users } from '~/drizzle/db'
import { SmtpService } from '~~/server/services/smtpService'
import { getClientIP } from '~~/server/utils/ip-utils'
import { requireQQEmailOrNumber } from '~~/server/utils/qq-email'
import {
  createRegistrationActivationToken,
  getRegistrationActivationExpiresDays
} from '~~/server/utils/registration-verification'
import { buildPublicAppUrl, getPublicOrigin } from '~~/server/utils/public-url'

const buildActivationUrl = (event: any, token: string) => {
  return buildPublicAppUrl(event, `/api/auth/register/activate?token=${encodeURIComponent(token)}`)
}

type VerificationDispatchStatus = 'sent' | 'failed' | 'queued'
const registerMailTimeoutRaw = Number(process.env.REGISTER_MAIL_TIMEOUT_MS || 3000)
const VERIFICATION_MAIL_TIMEOUT_MS =
  Number.isFinite(registerMailTimeoutRaw) && registerMailTimeoutRaw >= 1000
    ? registerMailTimeoutRaw
    : 3000

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const qqEmail = requireQQEmailOrNumber(body?.email ?? body?.qqNumber ?? body?.qq)

    const userResult = await db
      .select({
        id: users.id,
        name: users.name,
        username: users.username,
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
        message: '账号不存在'
      })
    }

    if (user.status !== 'active') {
      throw createError({
        statusCode: 403,
        message: '账号当前不可用，请联系管理员处理'
      })
    }

    if (user.emailVerified) {
      return {
        success: true,
        message: '账号已激活，请直接登录'
      }
    }

    const activationToken = createRegistrationActivationToken(qqEmail, user.id, getPublicOrigin(event))
    const activationUrl = buildActivationUrl(event, activationToken)
    const expiresInDays = getRegistrationActivationExpiresDays()
    const smtp = SmtpService.getInstance()

    const sendPromise = smtp
      .renderAndSend(
        qqEmail,
        'verification.link',
        {
          name: user.name || user.username,
          email: qqEmail,
          action: '账号激活',
          actionUrl: activationUrl,
          activationUrl,
          expiresInDays
        },
        getClientIP(event)
      )
      .then((ok) => (ok ? 'sent' : 'failed') as VerificationDispatchStatus)
      .catch((mailError) => {
        console.error('[Register] 重发激活邮件失败:', mailError)
        return 'failed' as VerificationDispatchStatus
      })

    let timeoutHandle: NodeJS.Timeout | null = null
    const timeoutPromise = new Promise<VerificationDispatchStatus>((resolve) => {
      timeoutHandle = setTimeout(() => resolve('queued'), VERIFICATION_MAIL_TIMEOUT_MS)
    })

    const status = await Promise.race([sendPromise, timeoutPromise])
    if (timeoutHandle) {
      clearTimeout(timeoutHandle)
    }
    if (status === 'queued') {
      // 后台继续发送，避免接口超时。
      void sendPromise
    }

    if (status === 'failed') {
      throw createError({
        statusCode: 500,
        message: '激活链接发送失败，请检查SMTP配置或联系管理员手动激活'
      })
    }

    return {
      success: true,
      verificationSent: status === 'sent',
      verificationPending: status === 'queued',
      message:
        status === 'queued'
          ? `激活邮件正在发送，请稍后查收邮箱（${expiresInDays}天内有效）`
          : `激活链接已发送，请查收邮箱（${expiresInDays}天内有效）`,
      resendCooldownSeconds: 0
    }
  } catch (error: any) {
    console.error('[Register] 重发激活链接失败:', error)
    if (error?.statusCode) {
      throw error
    }
    throw createError({
      statusCode: 500,
      message: '重发激活链接失败，请稍后重试'
    })
  }
})
