type CpuWebTarget = 'home' | 'login' | 'profile' | 'messages'

const TARGET_PATHS: Record<CpuWebTarget, string> = {
  home: '/',
  login: '/login',
  profile: '/profile',
  messages: '/messages'
}

export function cpuWebRedirectUrl(target: CpuWebTarget, redirect?: string) {
  const path = TARGET_PATHS[target]
  if (target !== 'login') return path
  const query = new URLSearchParams({ redirect: redirect || '/voicehub/' })
  return `${path}?${query.toString()}`
}

export function navigateToCpuWeb(target: CpuWebTarget, redirect?: string) {
  if (!import.meta.client) return
  // 根路径由浏览器基于当前公开域名解析，绝不把服务间的 127.0.0.1
  // 内部地址暴露给访问者。
  window.location.assign(cpuWebRedirectUrl(target, redirect))
}
