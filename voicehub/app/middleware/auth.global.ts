import { useAuth } from '~/composables/useAuth'
import { navigateToCpuWeb } from '~/utils/cpuWebNavigation'

export default defineNuxtRouteMiddleware(async (to, from) => {
  const { isAuthenticated, initAuth } = useAuth()
  const cpuManagedAccountRoutes = ['/login', '/register', '/forgot-password', '/change-password', '/account']
  const publicRoutes = ['/', '/auth/error']

  if (import.meta.client && cpuManagedAccountRoutes.includes(to.path)) {
    navigateToCpuWeb(
      to.path === '/account' || to.path === '/change-password' ? 'profile' : 'login',
      '/voicehub/'
    )
    return abortNavigation()
  }

  // 公共页面跳过认证
  if (publicRoutes.includes(to.path) || to.path.startsWith('/api/auth')) {
    return
  }

  // 客户端初始化认证状态（仅受保护页面需要）
  if (import.meta.client && !isAuthenticated.value) {
    await initAuth()
  }

  // 服务端跳过认证检查
  if (import.meta.server) {
    return
  }

  // 未认证用户重定向到登录页
  if (!isAuthenticated.value && to.path !== '/login') {
    // 保存目标路径用于登录后重定向
    const redirect = to.fullPath
    navigateToCpuWeb('login', `/voicehub${redirect}`)
    return abortNavigation()
  }
})
