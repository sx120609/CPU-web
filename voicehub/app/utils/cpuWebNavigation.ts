import { normalizeApiBase } from '~/utils/baseUrl'

type CpuWebTarget = 'home' | 'login' | 'profile'

export function cpuWebRedirectUrl(target: CpuWebTarget, redirect?: string) {
  const runtimeConfig = useRuntimeConfig()
  const apiBase = normalizeApiBase(runtimeConfig.public.apiBase, runtimeConfig.app.baseURL)
  const query = new URLSearchParams({ target })
  if (target === 'login') query.set('redirect', redirect || '/voicehub/')
  return `${apiBase}/cpu-web/redirect?${query.toString()}`
}

export function navigateToCpuWeb(target: CpuWebTarget, redirect?: string) {
  if (!import.meta.client) return
  window.location.assign(cpuWebRedirectUrl(target, redirect))
}
