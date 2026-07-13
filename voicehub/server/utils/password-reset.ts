import jwt from 'jsonwebtoken'

const PASSWORD_RESET_EXPIRES_MINUTES = 60
const PASSWORD_RESET_EXPIRES_SECONDS = PASSWORD_RESET_EXPIRES_MINUTES * 60

const getJwtSecret = (): string => {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is required for password reset links')
  }
  return process.env.JWT_SECRET
}

export const getPasswordResetExpiresMinutes = (): number => {
  return PASSWORD_RESET_EXPIRES_MINUTES
}

export const createPasswordResetToken = (email: string, userId: number): string => {
  return jwt.sign(
    {
      type: 'password_reset',
      userId,
      email: email.toLowerCase()
    },
    getJwtSecret(),
    {
      expiresIn: PASSWORD_RESET_EXPIRES_SECONDS
    }
  )
}

export const verifyPasswordResetToken = (
  token: string
): { ok: true; payload: { userId: number; email: string } } | { ok: false; message: string } => {
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as {
      type?: string
      userId?: number
      email?: string
    }

    if (decoded?.type !== 'password_reset') {
      return { ok: false, message: '重置链接无效，请重新发送' }
    }

    const userId = Number(decoded.userId)
    const email = typeof decoded.email === 'string' ? decoded.email.toLowerCase() : ''
    if (!userId || !email) {
      return { ok: false, message: '重置链接无效，请重新发送' }
    }

    return {
      ok: true,
      payload: { userId, email }
    }
  } catch (error: any) {
    if (error?.name === 'TokenExpiredError') {
      return { ok: false, message: '重置链接已过期，请重新发送' }
    }
    return { ok: false, message: '重置链接无效，请重新发送' }
  }
}
