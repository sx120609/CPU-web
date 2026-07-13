export default defineEventHandler((event) => {
  const user = event.context.user
  if (!user) {
    return { user: null, valid: false, source: 'cpu-web' }
  }
  return { user, valid: true, source: 'cpu-web' }
})
