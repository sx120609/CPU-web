import { navigateTo, useState } from '#app'
import type { User } from '~/types'
import { extractDisplayErrorMessage } from '~/utils/errorMessage'
import { navigateToCpuWeb } from '~/utils/cpuWebNavigation'

interface LoginResponse {
  success: boolean
  user?: User
  requires2FA?: boolean
  userId?: number
  methods?: string[]
  tempToken?: string // 预认证临时令牌
}

const normalizeRole = (role?: string | null): string => {
  if (!role) return 'USER'
  const normalized = role.trim().toUpperCase().replace(/[-\s]/g, '_')
  if (normalized === 'SONGADMIN') return 'SONG_ADMIN'
  if (normalized === 'SUPERADMIN') return 'SUPER_ADMIN'
  if (['USER', 'SONG_ADMIN', 'ADMIN', 'SUPER_ADMIN'].includes(normalized)) {
    return normalized
  }
  return 'USER'
}

const AUTH_VERIFY_UNAUTH_COOLDOWN_MS = 30 * 1000
let initAuthInFlight: Promise<User | null> | null = null
let lastUnauthVerifyAt = 0

export const useAuth = () => {
  const user = useState<User | null>('user', () => null)
  const token = useState<string | null>('token', () => null)
  const isAuthenticated = useState<boolean>('isAuthenticated', () => false)
  const isAdmin = useState<boolean>('isAdmin', () => false)
  const loading = useState<boolean>('loading', () => false)

  const clearAuthState = () => {
    user.value = null
    token.value = null
    isAuthenticated.value = false
    isAdmin.value = false
  }

  const clearAuthCookie = () => {
    if (!import.meta.client) return
    document.cookie = 'auth-token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax'
    if (window.location.protocol === 'https:') {
      document.cookie =
        'auth-token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax; Secure'
    }
  }

  const invalidateSessionLocally = () => {
    clearAuthState()
    clearAuthCookie()
    lastUnauthVerifyAt = Date.now()
    initAuthInFlight = null
  }

  const setAuthState = (loggedInUser: User) => {
    const normalizedUser = {
      ...loggedInUser,
      role: normalizeRole(loggedInUser.role)
    }
    token.value = 'cookie-based'
    user.value = normalizedUser
    isAuthenticated.value = true
    isAdmin.value = ['ADMIN', 'SUPER_ADMIN', 'SONG_ADMIN'].includes(normalizedUser.role)
    lastUnauthVerifyAt = 0
  }

  const initAuth = async () => {
    // 客户端执行
    if (typeof window === 'undefined' || import.meta.server) {
      return null
    }

    // 如果已认证，直接返回缓存的用户信息
    if (isAuthenticated.value && user.value) {
      return user.value
    }

    const hasAuthTokenCookie = document.cookie.includes('auth-token=')

    // 明确未登录态下做冷却，避免在短时间内反复打 /api/auth/verify
    if (
      !isAuthenticated.value &&
      !hasAuthTokenCookie &&
      Date.now() - lastUnauthVerifyAt < AUTH_VERIFY_UNAUTH_COOLDOWN_MS
    ) {
      return null
    }

    // 单飞：并发只发一次 verify 请求
    if (initAuthInFlight) {
      return await initAuthInFlight
    }

    initAuthInFlight = (async () => {
      try {
        const data = await $fetch<{ user: User }>('/api/auth/verify', {
          headers: {
            'Cache-Control': 'no-cache'
          }
        })

        if (data && data.user) {
          user.value = {
            ...data.user,
            role: normalizeRole(data.user.role)
          }
          isAuthenticated.value = true
          isAdmin.value = ['ADMIN', 'SUPER_ADMIN', 'SONG_ADMIN'].includes(user.value.role)
          token.value = 'cookie-based'
          lastUnauthVerifyAt = 0
          return user.value
        } else {
          clearAuthState()
          lastUnauthVerifyAt = Date.now()
          return null
        }
      } catch (error: any) {
        const hadAuth = isAuthenticated.value

        // 只有当之前是已认证状态，且接口明确返回401（Token无效/过期），才进行清理和跳转
        if (hadAuth && error.statusCode === 401) {
          clearAuthState()
          // Token失效，重定向到登录页
          navigateToCpuWeb('login', '/voicehub/')
        } else if (!hadAuth && error.statusCode === 401) {
          // 未登录状态下的 401，仅确保状态清理，不跳转，并启用冷却
          clearAuthState()
          lastUnauthVerifyAt = Date.now()
        }
        return null
      } finally {
        initAuthInFlight = null
      }
    })()

    return await initAuthInFlight
  }

  const login = async (username: string, password: string) => {
    const response = await $fetch<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: { username, password }
    })

    if (response.success) {
      if (response.requires2FA) {
        return response
      }

      if (response.user) {
        setAuthState(response.user)
        return response
      }
    }

    throw new Error('登录响应格式错误')
  }

  const verify2FA = async (userId: number, code: string, type: 'totp' | 'email', tempToken?: string) => {
    const response = await $fetch<{ success: boolean; user: User }>('/api/auth/2fa/verify', {
      method: 'POST',
      body: { userId, code, type, token: tempToken }
    })

    if (response.success && response.user) {
      setAuthState(response.user)
      return response
    }
    throw new Error('验证失败')
  }

  const changePassword = async (currentPassword: string, newPassword: string) => {
    loading.value = true
    try {
      await $fetch('/api/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword }
      })
    } catch (error: any) {
      throw new Error(extractDisplayErrorMessage(error, '密码修改失败，请重试'))
    } finally {
      loading.value = false
    }
  }

  const setInitialPassword = async (newPassword: string) => {
    loading.value = true
    try {
      await $fetch('/api/auth/set-initial-password', {
        method: 'POST',
        body: { newPassword }
      })
      if (user.value) {
        user.value.needsPasswordChange = false
      }
    } finally {
      loading.value = false
    }
  }

  const refreshUser = async () => {
    const data = await $fetch<{ user: User }>('/api/auth/verify')
    if (data && data.user) {
      user.value = {
        ...data.user,
        role: normalizeRole(data.user.role)
      }
      isAuthenticated.value = true
      isAdmin.value = ['ADMIN', 'SUPER_ADMIN', 'SONG_ADMIN'].includes(user.value.role)
    }
  }

  const logout = async (redirect = true) => {
    invalidateSessionLocally()

    if (import.meta.client && redirect) {
      navigateToCpuWeb('home')
    }
  }

  const getAuthConfig = () => {
    // 返回认证配置
    return {
      credentials: 'include' as RequestCredentials
    }
  }

  return {
    user,
    token,
    isAuthenticated,
    isAdmin,
    loading,
    login,
    verify2FA,
    logout,
    changePassword,
    setInitialPassword,
    refreshUser,
    initAuth,
    getAuthConfig,
    invalidateSessionLocally
  }
}
