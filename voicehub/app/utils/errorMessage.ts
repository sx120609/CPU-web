const REQUEST_PREFIX_RE =
  /\[(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\]\s*"[^"]*":\s*/gi
const NO_RESPONSE_RE = /<no response>\s*/gi
const LEADING_ERROR_RE = /^(FetchError|TypeError|Error):\s*/i

export const sanitizeErrorMessage = (raw: unknown): string => {
  if (typeof raw !== 'string') return ''

  let message = raw.trim()
  if (!message) return ''

  // 只保留首行，避免堆栈信息泄漏到 UI。
  message = message.split('\n')[0]?.trim() || ''
  message = message.replace(LEADING_ERROR_RE, '')
  message = message.replace(REQUEST_PREFIX_RE, '')
  message = message.replace(NO_RESPONSE_RE, '')
  message = message.replace(/^[\s:,-]+/, '').trim()

  return message
}

export const extractDisplayErrorMessage = (error: any, fallback = '请求失败'): string => {
  const candidates = [
    error?.data?.message,
    error?.data?.statusMessage,
    error?.statusMessage,
    error?.message
  ]

  for (const candidate of candidates) {
    const normalized = sanitizeErrorMessage(candidate)
    if (normalized) return normalized
  }

  return fallback
}
