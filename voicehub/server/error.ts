import type { NitroErrorHandler } from 'nitropack'
import { setResponseHeader } from 'h3'
import { extractRawErrorMessage, getRequestPath, isApiPath, sanitizePublicMessage } from './utils/public-error'

const errorHandler: NitroErrorHandler = async (error, event) => {
  const requestUrl = event?.node?.req?.url || ''
  const requestMethod = event?.node?.req?.method || 'UNKNOWN'
  const requestPath = getRequestPath(requestUrl)
  const rawMessage = extractRawErrorMessage(error)
  const statusCode = Number.isFinite(error.statusCode) ? Number(error.statusCode) : 500

  const isDatabaseError =
    rawMessage.includes('ECONNRESET') ||
    rawMessage.includes('ENOTFOUND') ||
    rawMessage.includes('ETIMEDOUT') ||
    rawMessage.includes('Connection terminated') ||
    rawMessage.includes('Connection lost') ||
    rawMessage.includes('CONNECTION_ENDED') ||
    rawMessage.includes('Prisma')

  const fallbackMessage = statusCode >= 500 ? '服务暂时不可用，请稍后重试' : '请求处理失败'
  const publicMessage = sanitizePublicMessage(rawMessage, fallbackMessage)
  const finalStatusCode = isDatabaseError ? 503 : statusCode
  const finalMessage = isDatabaseError ? '服务暂时不可用，请稍后重试' : publicMessage
  const finalCode = isDatabaseError
    ? 'UPSTREAM_UNAVAILABLE'
    : finalStatusCode >= 500
      ? 'INTERNAL_ERROR'
      : 'REQUEST_REJECTED'

  console.error('Nitro Error Handler:', {
    url: requestPath,
    method: requestMethod,
    statusCode: finalStatusCode,
    error: rawMessage || 'unknown error',
    timestamp: new Date().toISOString()
  })

  const payload = {
    success: false,
    code: finalCode,
    message: finalMessage,
    timestamp: new Date().toISOString()
  }

  if (event && isApiPath(requestPath)) {
    setResponseHeader(event, 'content-type', 'application/json; charset=utf-8')
    setResponseHeader(event, 'x-content-type-options', 'nosniff')
    setResponseHeader(event, 'cache-control', 'no-store')
    return {
      statusCode: finalStatusCode,
      statusMessage: finalMessage,
      data: payload
    }
  }

  return {
    statusCode: finalStatusCode,
    statusMessage: finalMessage,
    data: payload
  }
}

export default errorHandler
