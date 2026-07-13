type AvatarPriorityInput = {
  customAvatar?: string | null
  qqAvatar?: string | null
  githubUsername?: string | null
}

const AVATAR_FILENAME_REGEX = /^[A-Za-z0-9._-]+$/

const normalizeAvatar = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const normalizeCustomAvatar = (value?: string | null): string | null => {
  const normalized = normalizeAvatar(value)
  if (!normalized) return null

  if (normalized.includes('/api/user/avatar-file/')) {
    return normalized
  }

  const marker = '/uploads/avatars/'
  const markerIndex = normalized.indexOf(marker)
  if (markerIndex === -1) {
    return normalized
  }

  const prefix = normalized.slice(0, markerIndex).replace(/\/+$/, '')
  const rawName = normalized.slice(markerIndex + marker.length).split('?')[0].split('#')[0].trim()

  try {
    const fileName = decodeURIComponent(rawName)
    if (!AVATAR_FILENAME_REGEX.test(fileName)) {
      return normalized
    }

    return `${prefix}/api/user/avatar-file/${fileName}`
  } catch {
    return normalized
  }
}

const getGithubAvatar = (githubUsername?: string | null): string | null => {
  const normalized = normalizeAvatar(githubUsername)
  return normalized ? `https://github.com/${normalized}.png` : null
}

export const resolvePreferredAvatar = ({
  customAvatar,
  qqAvatar,
  githubUsername
}: AvatarPriorityInput): string | null => {
  return normalizeCustomAvatar(customAvatar) || normalizeAvatar(qqAvatar) || getGithubAvatar(githubUsername)
}
