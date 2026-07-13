import { getQuery, sendRedirect } from 'h3'
import { and, eq } from 'drizzle-orm'
import { db, users } from '~/drizzle/db'
import {
  extractRegistrationActivationRedirectOrigin,
  verifyRegistrationActivationToken
} from '~~/server/utils/registration-verification'
import { buildPublicAppUrl, buildPublicAppUrlFromOrigin } from '~~/server/utils/public-url'

const buildLoginRedirectUrl = (event: any, activation: string, redirectOrigin?: string | null) => {
  const loginPath = `/login?activation=${encodeURIComponent(activation)}`
  if (redirectOrigin) {
    return buildPublicAppUrlFromOrigin(event, redirectOrigin, loginPath)
  }
  return buildPublicAppUrl(event, loginPath)
}

const safeSendLoginRedirect = (
  event: any,
  activation: string,
  redirectOrigin?: string | null,
  fallbackActivation: string = 'server'
) => {
  try {
    const target = buildLoginRedirectUrl(event, activation, redirectOrigin)
    return sendRedirect(event, target, 302)
  } catch (redirectError) {
    console.error('[Register Activation] 构建重定向地址失败:', redirectError)
    return sendRedirect(event, `/login?activation=${encodeURIComponent(fallbackActivation)}`, 302)
  }
}

const resolveActivationStatusFromError = (error: any): 'expired' | 'invalid' | 'blocked' | 'server' => {
  const message = typeof error?.message === 'string' ? error.message : ''
  if (error?.statusCode === 403) {
    return 'blocked'
  }
  if (message.includes('过期')) {
    return 'expired'
  }
  if (message.includes('无效') || message.includes('缺少')) {
    return 'invalid'
  }
  return 'server'
}

export default defineEventHandler(async (event) => {
  let redirectOrigin: string | null = null

  try {
    const query = getQuery(event)
    const token = typeof query.token === 'string' ? query.token.trim() : ''
    redirectOrigin = token ? extractRegistrationActivationRedirectOrigin(token) : null

    if (!token || token.length > 4096) {
      return safeSendLoginRedirect(event, 'invalid', redirectOrigin, 'invalid')
    }

    const verifyResult = verifyRegistrationActivationToken(token)
    if (!verifyResult.ok) {
      const status = verifyResult.message.includes('过期') ? 'expired' : 'invalid'
      return safeSendLoginRedirect(event, status, redirectOrigin, status)
    }

    const {
      userId,
      email,
      redirectOrigin: verifiedRedirectOrigin
    } = verifyResult.payload
    const finalRedirectOrigin = verifiedRedirectOrigin || redirectOrigin

    const userResult = await db
      .select({
        id: users.id,
        status: users.status,
        emailVerified: users.emailVerified
      })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.email, email)))
      .limit(1)

    const user = userResult[0]
    if (!user) {
      return safeSendLoginRedirect(event, 'invalid', finalRedirectOrigin, 'invalid')
    }

    if (user.status !== 'active') {
      return safeSendLoginRedirect(event, 'blocked', finalRedirectOrigin, 'blocked')
    }

    if (!user.emailVerified) {
      await db.update(users).set({ emailVerified: true }).where(eq(users.id, user.id))
      return safeSendLoginRedirect(event, 'success', finalRedirectOrigin, 'success')
    }

    return safeSendLoginRedirect(event, 'already', finalRedirectOrigin, 'already')
  } catch (error: any) {
    const status = resolveActivationStatusFromError(error)
    console.error('[Register Activation] 激活流程异常:', error)
    return safeSendLoginRedirect(event, status, redirectOrigin, 'server')
  }
})
