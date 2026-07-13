import {
  normalizeApiBase,
  normalizeAppBase,
  stripAppBaseFromPath,
  withApiBase
} from '~/utils/baseUrl'
import { extractDisplayErrorMessage } from '~/utils/errorMessage'

export default defineNuxtPlugin((nuxtApp) => {
  if (!import.meta.client) {
    return
  }

  // 立即设置请求拦截器，确保在任何API调用之前生效
  const runtimeConfig = useRuntimeConfig()
  const appBaseURL = normalizeAppBase(runtimeConfig.app.baseURL)
  const apiBase = normalizeApiBase(runtimeConfig.public.apiBase, appBaseURL)
  const originalFetch = window.fetch
  const errorHandler = useErrorHandler()
  const auth = useAuth()
  const isApiRequest = (request: string) =>
    request.startsWith('/api') || request === apiBase || request.startsWith(`${apiBase}/`)
  const normalizeApiRequest = (request: string) => withApiBase(request, apiBase)
  const getRequestUrlString = (request: RequestInfo | URL | any): string => {
    if (typeof request === 'string') return request
    if (request instanceof URL) return request.toString()
    if (typeof Request !== 'undefined' && request instanceof Request) return request.url
    return ''
  }
  const isAuthVerifyRequest = (requestUrl: string) => {
    if (!requestUrl) return false
    try {
      const url = requestUrl.startsWith('http') ? new URL(requestUrl) : new URL(requestUrl, window.location.origin)
      return url.pathname.endsWith('/api/auth/verify')
    } catch {
      return requestUrl.includes('/api/auth/verify')
    }
  }
  const isAuthPage = () => {
    const currentPath = stripAppBaseFromPath(window.location.pathname, appBaseURL)
    return currentPath === '/login' || currentPath === '/register'
  }

  // 拦截window.fetch
  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let nextInput = input

    // 处理所有API请求 - cookie会自动发送，无需手动添加Authorization头
    if (typeof input === 'string') {
      const normalizedInput = normalizeApiRequest(input)
      nextInput = normalizedInput

      if (isApiRequest(normalizedInput)) {
        init = init || {}
        init.headers = init.headers || {}

        // 确保cookie会被发送
        init.credentials = 'include'
      }
    } else if (input instanceof URL && input.origin === window.location.origin) {
      const currentPath = `${input.pathname}${input.search}${input.hash}`
      const normalizedPath = normalizeApiRequest(currentPath)
      if (normalizedPath !== currentPath || isApiRequest(currentPath)) {
        if (normalizedPath !== currentPath) {
          nextInput = new URL(normalizedPath, window.location.origin)
        }
        init = init || {}
        init.headers = init.headers || {}
        init.credentials = 'include'
      }
    }

    const requestUrl = getRequestUrlString(nextInput)
    const response = await originalFetch(nextInput, init)

    // 检查是否为401错误
    if (response.status === 401) {
      // 未登录状态下的 /api/auth/verify 属于正常探测，不触发全局401处理
      if (isAuthVerifyRequest(requestUrl) && !auth.isAuthenticated.value) {
        return response
      }

      // 如果在登录页面，解析错误响应体并抛出具体错误信息
      if (isAuthPage()) {
        try {
          const errorData = await response.clone().json()
          const errorMessage = errorData.message || '登录失败，请检查账号密码'
          return Promise.reject(new Error(errorMessage))
        } catch (parseError) {
          return Promise.reject(new Error('登录失败，请检查账号密码'))
        }
      }

      // 只有在非登录页面才触发认证失效处理
      await errorHandler.handle401Error('您的登录信息已失效，请重新登录')
      return Promise.reject(new Error('Authentication expired'))
    }

    return response
  }

  // 初始化认证状态
  nuxtApp.hook('app:created', async () => {
    await auth.initAuth()

    // 拦截$fetch请求，确保cookie会被发送
    const originalUseFetch = nuxtApp.$fetch
    if (originalUseFetch) {
      nuxtApp.$fetch = async function (request: any, options: any = {}) {
        const normalizedRequest =
          typeof request === 'string' ? normalizeApiRequest(request) : request
        const requestUrl = getRequestUrlString(normalizedRequest)

        // 为所有API请求确保cookie会被发送
        if (typeof normalizedRequest === 'string' && isApiRequest(normalizedRequest)) {
          options.headers = options.headers || {}
          // 确保cookie会被发送
          options.credentials = 'include'
        }

        try {
          return await originalUseFetch(normalizedRequest, options)
        } catch (error: any) {
          // 检查是否为401错误
          if (error?.status === 401 || error?.statusCode === 401) {
            // 未登录状态下的 /api/auth/verify 属于正常探测，不触发全局401处理
            if (isAuthVerifyRequest(requestUrl) && !auth.isAuthenticated.value) {
              throw error
            }

            // 如果在登录页面，解析错误信息并抛出具体错误
            if (isAuthPage()) {
              const newError = new Error(extractDisplayErrorMessage(error, '登录失败，请检查账号密码'))
              throw newError
            }

            // 只有在非登录页面才触发认证失效处理
            await errorHandler.handle401Error('您的登录信息已失效，请重新登录')
            throw error
          }
          throw error
        }
      }
    }
  })

  // 全局错误处理
  nuxtApp.hook('vue:error', async (error: any) => {
    if (error?.status === 401 || error?.statusCode === 401) {
      if (!isAuthPage()) {
        await errorHandler.handle401Error('您的登录信息已失效，请重新登录')
      }
    }
  })
})
