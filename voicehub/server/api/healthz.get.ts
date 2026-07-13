import { databaseManager } from '~~/server/utils/database-manager'

export default defineEventHandler(async (event) => {
  const health = await databaseManager.healthCheck()
  const connected = health.status === true

  if (!connected) {
    setResponseStatus(event, 503)
  }

  return {
    status: connected ? 'ok' : 'error',
    database: {
      connected
    }
  }
})
