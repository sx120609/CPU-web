export default defineNuxtPlugin(() => {
  if (!import.meta.client) {
    return
  }

  const { showToast, clearToasts } = useToast()

  // 兼容旧代码中基于 window 的调用
  window.$showNotification = (
    message: string,
    type: 'success' | 'error' | 'info' | 'warning' = 'info',
    autoCloseOrDuration: boolean | number = true,
    duration = 3000
  ) => {
    let finalDuration = duration
    if (typeof autoCloseOrDuration === 'number') {
      finalDuration = autoCloseOrDuration
    } else if (!autoCloseOrDuration) {
      finalDuration = 0
    }
    return showToast(message, type, finalDuration)
  }

  window.$clearNotifications = () => {
    clearToasts()
  }
})
