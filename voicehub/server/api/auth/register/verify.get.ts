import { getQuery, sendRedirect } from 'h3'
import { buildPublicAppUrl } from '~~/server/utils/public-url'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const token = typeof query.token === 'string' ? query.token.trim() : ''

  if (!token) {
    return sendRedirect(event, buildPublicAppUrl(event, '/login?activation=invalid'), 302)
  }

  return sendRedirect(
    event,
    buildPublicAppUrl(event, `/api/auth/register/activate?token=${encodeURIComponent(token)}`),
    302
  )
})
