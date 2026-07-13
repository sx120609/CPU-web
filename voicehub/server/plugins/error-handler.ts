const ERROR_HANDLER_STATE_KEY = Symbol.for('voicehub.error-handler.state')

type ErrorHandlerState = {
  initialized: boolean
}

const getErrorHandlerState = (): ErrorHandlerState => {
  const globalState = globalThis as typeof globalThis & {
    [ERROR_HANDLER_STATE_KEY]?: ErrorHandlerState
  }
  if (!globalState[ERROR_HANDLER_STATE_KEY]) {
    globalState[ERROR_HANDLER_STATE_KEY] = {
      initialized: false
    }
  }
  return globalState[ERROR_HANDLER_STATE_KEY]!
}

const getErrorMessage = (error: unknown): string => {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

const isDatabaseConnectionError = (message: string): boolean => {
  return (
    message.includes('ECONNRESET') ||
    message.includes('ENOTFOUND') ||
    message.includes('ETIMEDOUT') ||
    message.includes('Connection terminated') ||
    message.includes('Connection lost') ||
    message.includes('CONNECTION_ENDED')
  )
}

export default defineNitroPlugin(() => {
  const state = getErrorHandlerState()
  if (state.initialized) {
    return
  }

  process.on('unhandledRejection', (reason, promise) => {
    const errorMessage = getErrorMessage(reason)
    console.error('[UnhandledRejection]', promise, errorMessage)

    if (isDatabaseConnectionError(errorMessage)) {
      // Do not crash process for transient DB/network glitches.
      console.warn('[UnhandledRejection] detected transient database/network error, ignored')
      return
    }
  })

  process.on('uncaughtException', (error) => {
    const errorMessage = getErrorMessage(error)
    console.error('[UncaughtException]', error)

    if (isDatabaseConnectionError(errorMessage)) {
      // Keep process alive on short-lived connection resets.
      console.warn('[UncaughtException] transient database/network error, ignored')
      return
    }
  })

  state.initialized = true
  console.log('[Error Handler] process-level handlers initialized')
})
