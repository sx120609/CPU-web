import { extractRawErrorMessage, getRequestPath, isApiPath, sanitizePublicMessage } from '../utils/public-error'

const RISKY_RESPONSE_KEYS = new Set(['message', 'error', 'statusMessage', 'detail', 'stack'])

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object') {
    return false
  }
  return Object.getPrototypeOf(value) === Object.prototype
}

const sanitizeResponseBody = (
  value: unknown,
  statusCode: number,
  seen: WeakSet<object>
): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeResponseBody(item, statusCode, seen))
  }

  if (!isPlainObject(value)) {
    return value
  }

  if (seen.has(value)) {
    return value
  }
  seen.add(value)

  const fallback = statusCode >= 500 ? '服务暂时不可用，请稍后重试' : '请求处理失败'
  const sanitized: Record<string, unknown> = {}

  for (const [key, item] of Object.entries(value)) {
    const loweredKey = key.toLowerCase()
    if (loweredKey === 'stack') {
      continue
    }

    if (typeof item === 'string' && RISKY_RESPONSE_KEYS.has(loweredKey)) {
      sanitized[key] = sanitizePublicMessage(item, fallback)
      continue
    }

    sanitized[key] = sanitizeResponseBody(item, statusCode, seen)
  }

  return sanitized
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('beforeResponse', (event, response) => {
    const requestUrl = event?.node?.req?.url || ''
    const path = getRequestPath(requestUrl)
    if (!isApiPath(path)) {
      return
    }

    const statusCode =
      typeof response?.statusCode === 'number'
        ? response.statusCode
        : Number(event.node.res.statusCode || 200)

    const body = response?.body
    if (body === null || body === undefined) {
      return
    }

    if (typeof body === 'string') {
      if (statusCode >= 500) {
        response.body = sanitizePublicMessage(body, '服务暂时不可用，请稍后重试')
      } else if (statusCode >= 400) {
        response.body = sanitizePublicMessage(body, '请求处理失败')
      }
      return
    }

    response.body = sanitizeResponseBody(body, statusCode, new WeakSet())
  })

  nitroApp.hooks.hook('error', (error, event) => {
    const requestUrl = event?.node?.req?.url || ''
    const path = getRequestPath(requestUrl)
    const message = sanitizePublicMessage(
      extractRawErrorMessage(error),
      '服务暂时不可用，请稍后重试'
    )
    console.error('[API Response Sanitizer][error]', {
      path,
      statusCode: (error as { statusCode?: unknown })?.statusCode,
      message
    })
  })
})
