export default defineNuxtPlugin(() => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return
  }

  let lastTouchEnd = 0

  const preventGesture = (event: Event) => {
    event.preventDefault()
  }

  const preventDoubleTapZoom = (event: TouchEvent) => {
    const now = Date.now()
    if (now - lastTouchEnd <= 300) {
      event.preventDefault()
    }
    lastTouchEnd = now
  }

  document.addEventListener('gesturestart', preventGesture, { passive: false })
  document.addEventListener('gesturechange', preventGesture, { passive: false })
  document.addEventListener('gestureend', preventGesture, { passive: false })
  document.addEventListener('touchend', preventDoubleTapZoom, { passive: false })
})
