import { createError, getQuery, getRequestHeader, getRequestURL, sendRedirect } from 'h3'

const TARGET_PATHS = {
  home: '/',
  login: '/login',
  profile: '/profile'
} as const

function validatedOrigin(value: string) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('invalid CPU-web public origin')
  }
  return url.origin
}

function cpuWebPublicOrigin(event: Parameters<typeof getRequestURL>[0]) {
  const configured = String(process.env.CPU_WEB_PUBLIC_ORIGIN || '').trim()
  if (configured) return validatedOrigin(configured)

  // The CPU-web reverse proxy supplies the browser-facing host. This keeps
  // redirects on the public domain while VoiceHub itself listens on localhost.
  const forwardedHost = String(getRequestHeader(event, 'x-forwarded-host') || '')
    .split(',')[0]
    .trim()
  if (forwardedHost) {
    const forwardedProto = String(getRequestHeader(event, 'x-forwarded-proto') || '')
      .split(',')[0]
      .trim()
    const protocol = forwardedProto === 'http' || forwardedProto === 'https'
      ? forwardedProto
      : getRequestURL(event).protocol.replace(':', '')
    return validatedOrigin(`${protocol}://${forwardedHost}`)
  }

  // Direct local VoiceHub access (port 3001) still needs to land on CPU-web
  // (port 3000), rather than resolving /login inside the Nuxt sub-application.
  return validatedOrigin(process.env.CPU_WEB_ORIGIN || 'http://127.0.0.1:3000')
}

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const target = String(query.target || 'home') as keyof typeof TARGET_PATHS
  const targetPath = TARGET_PATHS[target]
  if (!targetPath) {
    throw createError({ statusCode: 400, message: '不支持的主站跳转目标' })
  }

  const destination = new URL(targetPath, cpuWebPublicOrigin(event))
  if (target === 'login') {
    const redirect = String(query.redirect || '/voicehub/')
    destination.searchParams.set(
      'redirect',
      redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/voicehub/'
    )
  }

  return sendRedirect(event, destination.toString(), 302)
})
