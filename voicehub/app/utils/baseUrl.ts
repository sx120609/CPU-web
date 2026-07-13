const ensureLeadingSlash = (value: string) => (value.startsWith('/') ? value : `/${value}`)

export const normalizeAppBase = (baseURL?: string | null): string => {
  const rawBase = (baseURL || '/').trim()
  const withLeadingSlash = ensureLeadingSlash(rawBase).replace(/\/{2,}/g, '/')
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`
}

export const appBasePrefix = (baseURL?: string | null): string => {
  const normalized = normalizeAppBase(baseURL)
  return normalized === '/' ? '' : normalized.slice(0, -1)
}

export const normalizeApiBase = (apiBase?: string | null, appBaseURL?: string | null): string => {
  const rawApiBase = (apiBase || '').trim()
  if (!rawApiBase) {
    return `${appBasePrefix(appBaseURL)}/api`
  }

  return ensureLeadingSlash(rawApiBase).replace(/\/+$/, '')
}

export const withApiBase = (path: string, apiBase: string): string => {
  if (!path.startsWith('/api')) {
    return path
  }

  if (path === '/api') {
    return apiBase
  }

  if (path.startsWith('/api/')) {
    return `${apiBase}${path.slice('/api'.length)}`
  }

  return path
}

export const stripAppBaseFromPath = (pathname: string, appBaseURL?: string | null): string => {
  const path = pathname || '/'
  const prefix = appBasePrefix(appBaseURL)

  if (!prefix) {
    return path
  }

  if (path === prefix) {
    return '/'
  }

  return path.startsWith(`${prefix}/`) ? path.slice(prefix.length) : path
}
