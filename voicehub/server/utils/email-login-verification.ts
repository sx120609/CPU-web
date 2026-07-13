import { randomInt } from 'crypto'

type PendingEmailLoginCode = {
  userId: number
  code: string
  expiresAt: number
  attempts: number
  lastSentAt: number
}

const CODE_EXPIRES_MS = 10 * 60 * 1000
const RESEND_COOLDOWN_MS = 60 * 1000
const MAX_VERIFY_ATTEMPTS = 5
const pendingEmailLoginCodes = new Map<string, PendingEmailLoginCode>()

const now = () => Date.now()

const cleanupExpiredCode = (email: string, record?: PendingEmailLoginCode | null) => {
  if (!record) {
    return null
  }

  if (record.expiresAt <= now()) {
    pendingEmailLoginCodes.delete(email)
    return null
  }

  return record
}

export const setPendingEmailLoginCode = (email: string, userId: number): PendingEmailLoginCode => {
  const record: PendingEmailLoginCode = {
    userId,
    code: randomInt(100000, 999999).toString(),
    expiresAt: now() + CODE_EXPIRES_MS,
    attempts: 0,
    lastSentAt: now()
  }

  pendingEmailLoginCodes.set(email, record)
  return record
}

export const getPendingEmailLoginCode = (email: string): PendingEmailLoginCode | null => {
  const record = pendingEmailLoginCodes.get(email)
  return cleanupExpiredCode(email, record)
}

export const getEmailLoginCodeResendRemainingSeconds = (email: string): number => {
  const record = getPendingEmailLoginCode(email)
  if (!record) {
    return 0
  }

  const remaining = Math.ceil((record.lastSentAt + RESEND_COOLDOWN_MS - now()) / 1000)
  return remaining > 0 ? remaining : 0
}

export const verifyPendingEmailLoginCode = (
  email: string,
  code: string
): { ok: true; userId: number } | { ok: false; message: string } => {
  const record = getPendingEmailLoginCode(email)

  if (!record) {
    return { ok: false, message: '验证码已过期或不存在，请重新发送' }
  }

  if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
    pendingEmailLoginCodes.delete(email)
    return { ok: false, message: '验证码尝试次数过多，请重新发送' }
  }

  if (record.code !== code) {
    record.attempts += 1
    pendingEmailLoginCodes.set(email, record)
    return {
      ok: false,
      message: `验证码错误，剩余尝试次数：${Math.max(0, MAX_VERIFY_ATTEMPTS - record.attempts)}`
    }
  }

  pendingEmailLoginCodes.delete(email)
  return { ok: true, userId: record.userId }
}

export const clearPendingEmailLoginCode = (email: string) => {
  pendingEmailLoginCodes.delete(email)
}
