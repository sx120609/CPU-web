import type { H3Event } from 'h3'
import { getRequestHeader, getRequestURL, setCookie } from 'h3'

export const isSecureRequest = (event: H3Event): boolean => {
  return (
    getRequestURL(event).protocol === 'https:' ||
    getRequestHeader(event, 'x-forwarded-proto') === 'https'
  )
}

/**
 * 尽可能清除 auth-token：
 * 1) 清理 non-secure cookie
 * 2) 清理 secure cookie
 * 这样可覆盖反向代理/转发头不稳定导致的 cookie 残留问题。
 */
export const clearAuthTokenCookie = (event: H3Event) => {
  const baseOptions = {
    httpOnly: true as const,
    sameSite: 'lax' as const,
    maxAge: 0,
    path: '/'
  }

  setCookie(event, 'auth-token', '', {
    ...baseOptions,
    secure: false
  })

  setCookie(event, 'auth-token', '', {
    ...baseOptions,
    secure: true
  })
}

