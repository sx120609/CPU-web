import { useAuth } from './useAuth'
import { normalizeAppBase, stripAppBaseFromPath } from '~/utils/baseUrl'
import { extractDisplayErrorMessage } from '~/utils/errorMessage'

// 防抖机制
let isHandling401 = false
let lastHandle401Time = 0
const HANDLE_401_DEBOUNCE_TIME = 2000

export const useErrorHandler = () => {
  // 处理401认证失效错误
  const handle401Error = async (error: any) => {
    // 防抖机制
    const now = Date.now()
    if (isHandling401 || now - lastHandle401Time < HANDLE_401_DEBOUNCE_TIME) {
      return
    }

    lastHandle401Time = now
    isHandling401 = true

    try {
      const runtimeConfig = useRuntimeConfig()
      const appBaseURL = normalizeAppBase(runtimeConfig.app.baseURL)
      const currentPath = import.meta.client
        ? stripAppBaseFromPath(window.location.pathname, appBaseURL)
        : ''

      // 检查是否在登录页面
      const isLoginPage = currentPath === '/login'

      if (isLoginPage) {
        // 在登录页面，解析错误信息
        const errorMessage = extractDisplayErrorMessage(error, '登录失败')

        console.log('登录失败:', errorMessage)

        throw error
      } else {
        // 不在登录页面，清除认证状态并跳转到登录页
        
        // 检查是否已认证
        const auth = useAuth()
        const wasAuthenticated = auth.isAuthenticated.value
        
        // 如果之前未认证（如首次访问），则不显示错误提示
        if (!wasAuthenticated) {
           console.log('未认证状态下收到401，忽略提示')
           return
        }

        console.log('检测到401错误，清除认证状态并跳转到登录页')

        const errorMessage = extractDisplayErrorMessage(error, '认证失败，请重新登录')

        console.log('认证错误:', errorMessage)

        // 清除认证状态
        auth.user.value = null
        auth.token.value = null
        auth.isAuthenticated.value = false
        auth.isAdmin.value = false

        // 清除 cookie
        if (import.meta.client) {
          // 删除 auth-token cookie
          document.cookie = 'auth-token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax'
          
          // 如果是 HTTPS，也尝试删除 secure cookie
          if (window.location.protocol === 'https:') {
            document.cookie = 'auth-token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax; Secure'
          }
        }

        // 显示错误提示
        if (import.meta.client) {
          const toast = useToast()
          toast.error(errorMessage)
        }

        // 跳转到登录页
        if (import.meta.client) {
          await navigateTo('/login')
        }
      }
    } finally {
      // 延迟重置防抖标志
      setTimeout(() => {
        isHandling401 = false
      }, 1000)
    }
  }

  // 检查响应是否为401错误并处理
  const checkAndHandle401 = async (response: Response, error?: any) => {
    if (response.status === 401) {
      await handle401Error(error)
      return true
    }
    return false
  }

  // 检查useFetch错误是否为401并处理
  const checkAndHandleFetchError = async (error: any) => {
    if (error?.status === 401 || error?.statusCode === 401) {
      await handle401Error(error)
      return true
    }
    return false
  }

  return {
    handle401Error,
    checkAndHandle401,
    checkAndHandleFetchError
  }
}
