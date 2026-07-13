let lockCount = 0

const applyLock = () => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return

  const body = document.body
  if (!body) return

  const scrollY = window.scrollY || window.pageYOffset || 0
  body.dataset.scrollLockY = String(scrollY)
  body.style.position = 'fixed'
  body.style.top = `-${scrollY}px`
  body.style.left = '0'
  body.style.right = '0'
  body.style.width = '100%'
  body.style.overflow = 'hidden'
  body.style.touchAction = 'none'
}

const releaseLock = () => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return

  const body = document.body
  if (!body) return

  const scrollY = Number(body.dataset.scrollLockY || '0')
  delete body.dataset.scrollLockY
  body.style.position = ''
  body.style.top = ''
  body.style.left = ''
  body.style.right = ''
  body.style.width = ''
  body.style.overflow = ''
  body.style.touchAction = ''

  if (Number.isFinite(scrollY)) {
    window.scrollTo(0, scrollY)
  }
}

export const useBodyScrollLock = () => {
  const lock = () => {
    lockCount += 1
    if (lockCount === 1) {
      applyLock()
    }
  }

  const unlock = () => {
    if (lockCount <= 0) return
    lockCount -= 1
    if (lockCount === 0) {
      releaseLock()
    }
  }

  return {
    lock,
    unlock
  }
}
