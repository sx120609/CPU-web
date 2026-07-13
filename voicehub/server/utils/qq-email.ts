import { createError } from 'h3'

// QQ 邮箱账号通常为 5-11 位数字，首位不能为 0
const QQ_EMAIL_REGEX = /^[1-9]\d{4,10}@qq\.com$/i
const QQ_NUMBER_REGEX = /^[1-9]\d{4,10}$/

export const normalizeEmail = (email: string): string => email.trim().toLowerCase()

export const isValidQQEmail = (email: string): boolean => QQ_EMAIL_REGEX.test(email)
export const isValidQQNumber = (qq: string): boolean => QQ_NUMBER_REGEX.test(qq)

export const normalizeQQEmailOrNumber = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) {
    return ''
  }

  const normalized = value.trim().toLowerCase()
  if (isValidQQEmail(normalized)) {
    return normalized
  }

  if (isValidQQNumber(normalized)) {
    return `${normalized}@qq.com`
  }

  return normalized
}

export const requireQQEmail = (email: unknown, fieldName = 'QQ邮箱'): string => {
  if (typeof email !== 'string' || !email.trim()) {
    throw createError({
      statusCode: 400,
      message: `${fieldName}不能为空`
    })
  }

  const normalized = normalizeEmail(email)
  if (!isValidQQEmail(normalized)) {
    throw createError({
      statusCode: 400,
      message: `请输入有效的${fieldName}（仅支持 @qq.com）`
    })
  }

  return normalized
}

export const requireQQEmailOrNumber = (value: unknown, fieldName = 'QQ邮箱/QQ号'): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw createError({
      statusCode: 400,
      message: `${fieldName}不能为空`
    })
  }

  const normalized = normalizeQQEmailOrNumber(value)
  if (!isValidQQEmail(normalized)) {
    throw createError({
      statusCode: 400,
      message: `请输入有效的${fieldName}（支持 QQ号 或 @qq.com 邮箱）`
    })
  }

  return normalized
}
