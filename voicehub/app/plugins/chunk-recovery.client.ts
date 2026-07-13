const CHUNK_RELOAD_GUARD_KEY = 'voicehub:chunk-reload-guard'
const CHUNK_RELOAD_GUARD_TTL_MS = 5 * 60 * 1000

const CHUNK_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Loading chunk/i,
  /ChunkLoadError/i,
  /dynamically imported module/i
]

const extractErrorMessage = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message
  if (typeof value === 'object' && value) {
    if ('message' in value) {
      return String((value as { message?: unknown }).message || '')
    }

    if ('reason' in value) {
      return extractErrorMessage((value as { reason?: unknown }).reason)
    }
  }

  return ''
}

const isNuxtChunkUrl = (value: string): boolean => {
  if (!value) return false
  return value.includes('/_nuxt/') && /\.js(\?|$)/.test(value)
}

const isChunkLoadError = (value: unknown): boolean => {
  const message = extractErrorMessage(value)
  if (!message) return false

  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message))
}

const isChunkScriptLoadError = (event: ErrorEvent): boolean => {
  const target = event.target as HTMLScriptElement | null
  const targetSrc = target?.src || ''
  if (isNuxtChunkUrl(targetSrc)) return true

  if (isNuxtChunkUrl(event.filename || '')) return true

  return false
}

const shouldSkipReload = (): boolean => {
  try {
    const raw = sessionStorage.getItem(CHUNK_RELOAD_GUARD_KEY)
    if (!raw) return false

    const record = JSON.parse(raw) as { path?: string; time?: number }
    if (!record?.path || typeof record.time !== 'number') return false
    if (Date.now() - record.time > CHUNK_RELOAD_GUARD_TTL_MS) return false

    return record.path === window.location.pathname
  } catch {
    return false
  }
}

const markReloadAttempt = () => {
  try {
    sessionStorage.setItem(
      CHUNK_RELOAD_GUARD_KEY,
      JSON.stringify({ path: window.location.pathname, time: Date.now() })
    )
  } catch {
    // Ignore storage failures in private mode or strict browsers.
  }
}

const reloadForChunkRecovery = () => {
  if (shouldSkipReload()) return

  markReloadAttempt()

  const url = new URL(window.location.href)
  url.searchParams.set('_chunk_reload', String(Date.now()))
  window.location.replace(url.toString())
}

export default defineNuxtPlugin(() => {
  const onError = (event: ErrorEvent) => {
    if (isChunkLoadError(event.error || event.message) || isChunkScriptLoadError(event)) {
      reloadForChunkRecovery()
    }
  }

  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    if (isChunkLoadError(event.reason)) {
      event.preventDefault()
      reloadForChunkRecovery()
    }
  }

  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onUnhandledRejection)
})
