type ErrorLike = {
  message?: unknown
  statusMessage?: unknown
}

const STACK_TRACE_PATTERN = /\bat\s+[^\n]+\([^\n]+\)/gi
const FILE_PATH_PATTERN = /(?:file:\/\/|\/)[\w./-]+\.(?:ts|js|mjs|cjs)(?::\d+(?::\d+)?)?/gi
const HTML_TAG_PATTERN = /<[^>]*>/g
const SUSPECT_PATTERN =
  /(?:<script|<\/script|javascript:|onerror=|onload=|select\s+.+\s+from|union\s+select|drop\s+table|insert\s+into|update\s+\w+\s+set|delete\s+from)/i

const MAX_PUBLIC_MESSAGE_LENGTH = 120

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim()

const stripControlChars = (value: string) =>
  Array.from(value)
    .filter((char) => {
      const code = char.charCodeAt(0)
      return !((code >= 0 && code <= 31) || code === 127)
    })
    .join('')

export const extractRawErrorMessage = (error: unknown): string => {
  if (typeof error === 'string') {
    return error
  }

  if (error && typeof error === 'object') {
    const typedError = error as ErrorLike

    if (typeof typedError.message === 'string' && typedError.message.trim()) {
      return typedError.message
    }

    if (typeof typedError.statusMessage === 'string' && typedError.statusMessage.trim()) {
      return typedError.statusMessage
    }
  }

  return ''
}

export const sanitizePublicMessage = (message: string, fallback: string): string => {
  if (!message) {
    return fallback
  }

  if (SUSPECT_PATTERN.test(message)) {
    return fallback
  }

  let sanitized = message
    .replace(HTML_TAG_PATTERN, ' ')
    .replace(STACK_TRACE_PATTERN, ' ')
    .replace(FILE_PATH_PATTERN, ' ')

  sanitized = stripControlChars(sanitized)
  sanitized = normalizeWhitespace(sanitized)

  if (!sanitized || SUSPECT_PATTERN.test(sanitized)) {
    return fallback
  }

  if (sanitized.length > MAX_PUBLIC_MESSAGE_LENGTH) {
    sanitized = sanitized.slice(0, MAX_PUBLIC_MESSAGE_LENGTH).trimEnd()
  }

  return sanitized || fallback
}

export const getRequestPath = (requestUrl?: string | null): string => {
  if (!requestUrl) {
    return ''
  }

  const path = requestUrl.split('?')[0] || ''
  return path
}

export const isApiPath = (path: string): boolean => {
  if (!path) {
    return false
  }
  return path === '/api' || path.startsWith('/api/') || path.includes('/api/')
}
