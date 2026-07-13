type CanonicalRole = 'USER' | 'SONG_ADMIN' | 'ADMIN' | 'SUPER_ADMIN'

const ROLE_ALIASES: Record<string, CanonicalRole> = {
  USER: 'USER',
  SONG_ADMIN: 'SONG_ADMIN',
  SONGADMIN: 'SONG_ADMIN',
  ADMIN: 'ADMIN',
  SUPER_ADMIN: 'SUPER_ADMIN',
  SUPERADMIN: 'SUPER_ADMIN'
}

export const normalizeRole = (role?: string | null): CanonicalRole | null => {
  if (!role) return null
  const normalized = role.trim().toUpperCase().replace(/[-\s]/g, '_')
  return ROLE_ALIASES[normalized] || null
}

export const normalizeRoleOrDefault = (role: string | null | undefined, fallback: CanonicalRole = 'USER'): CanonicalRole => {
  return normalizeRole(role) || fallback
}
