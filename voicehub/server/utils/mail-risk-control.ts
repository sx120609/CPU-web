type MailRiskInput = {
  to: string
  subject: string
  htmlContent: string
  ipAddress?: string
}

const parseIntEnv = (name: string, fallback: number) => {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

const MAIL_RISK_GUARD_ENABLED = process.env.MAIL_RISK_GUARD_ENABLED !== '0'
const MAIL_MAX_HTML_LENGTH = parseIntEnv('MAIL_MAX_HTML_LENGTH', 120000)
const MAIL_PER_IP_WINDOW_SEC = parseIntEnv('MAIL_PER_IP_WINDOW_SEC', 600)
const MAIL_PER_IP_LIMIT = parseIntEnv('MAIL_PER_IP_LIMIT', 20)
const MAIL_PER_RECIPIENT_WINDOW_SEC = parseIntEnv('MAIL_PER_RECIPIENT_WINDOW_SEC', 600)
const MAIL_PER_RECIPIENT_LIMIT = parseIntEnv('MAIL_PER_RECIPIENT_LIMIT', 8)
const MAIL_RECIPIENT_COOLDOWN_SEC = parseIntEnv('MAIL_RECIPIENT_COOLDOWN_SEC', 10)

const allowedRecipientList = (process.env.MAIL_ALLOWED_RECIPIENTS || '')
  .split(',')
  .map((v) => v.trim().toLowerCase())
  .filter(Boolean)

const allowedDomainList = (process.env.MAIL_ALLOWED_DOMAINS || '')
  .split(',')
  .map((v) => v.trim().toLowerCase())
  .filter(Boolean)

const allowedRecipients =
  allowedRecipientList.length > 0 ? new Set(allowedRecipientList) : null
const allowedDomains = allowedDomainList.length > 0 ? new Set(allowedDomainList) : null

const ipSendBuckets = new Map<string, number[]>()
const recipientSendBuckets = new Map<string, number[]>()
const recipientCooldownMap = new Map<string, number>()

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const RISKY_CONTENT_PATTERN =
  /(?:<script|<\/script|javascript:|onerror=|onload=|data:text\/html|<iframe|<object|<embed)/i

const trimOldTimestamps = (list: number[], cutoff: number) => {
  while (list.length > 0 && list[0] < cutoff) {
    list.shift()
  }
}

const reject = (message: string) => {
  const error = new Error(message) as Error & { code?: string }
  error.code = 'MAIL_RISK_BLOCKED'
  throw error
}

const normalizeRecipient = (to: string) => to.trim().toLowerCase()

export const assertMailSendAllowed = (input: MailRiskInput) => {
  if (!MAIL_RISK_GUARD_ENABLED) {
    return
  }

  const recipient = normalizeRecipient(input.to)
  if (!EMAIL_REGEX.test(recipient)) {
    reject('收件人邮箱格式不合法')
  }

  if (allowedRecipients && !allowedRecipients.has(recipient)) {
    reject('收件人不在允许列表中')
  }

  const recipientDomain = recipient.split('@')[1] || ''
  if (allowedDomains && !allowedDomains.has(recipientDomain)) {
    reject('收件人域名不在允许范围内')
  }

  if (input.subject.length > 200) {
    reject('邮件主题过长，已被安全策略阻止')
  }

  if (input.htmlContent.length > MAIL_MAX_HTML_LENGTH) {
    reject('邮件内容过大，已被安全策略阻止')
  }

  const mergedContent = `${input.subject}\n${input.htmlContent}`
  if (RISKY_CONTENT_PATTERN.test(mergedContent)) {
    reject('邮件内容命中高风险规则，已被阻止')
  }

  const now = Date.now()
  const recipientWindowCutoff = now - MAIL_PER_RECIPIENT_WINDOW_SEC * 1000
  const recipientBucket = recipientSendBuckets.get(recipient) || []
  trimOldTimestamps(recipientBucket, recipientWindowCutoff)

  const lastRecipientSendAt = recipientCooldownMap.get(recipient) || 0
  if (now - lastRecipientSendAt < MAIL_RECIPIENT_COOLDOWN_SEC * 1000) {
    reject('同一收件人发送过于频繁，请稍后重试')
  }

  if (recipientBucket.length >= MAIL_PER_RECIPIENT_LIMIT) {
    reject('同一收件人邮件发送过于频繁，请稍后重试')
  }

  if (input.ipAddress && input.ipAddress !== 'unknown') {
    const ipKey = input.ipAddress.trim()
    const ipWindowCutoff = now - MAIL_PER_IP_WINDOW_SEC * 1000
    const ipBucket = ipSendBuckets.get(ipKey) || []
    trimOldTimestamps(ipBucket, ipWindowCutoff)
    if (ipBucket.length >= MAIL_PER_IP_LIMIT) {
      reject('当前IP邮件发送频率过高，请稍后重试')
    }
    ipBucket.push(now)
    ipSendBuckets.set(ipKey, ipBucket)
  }

  recipientBucket.push(now)
  recipientSendBuckets.set(recipient, recipientBucket)
  recipientCooldownMap.set(recipient, now)
}
