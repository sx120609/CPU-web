import { ne } from 'drizzle-orm'
import { users } from '~/drizzle/schema'

export const GHOST_USER_ROLE = 'GHOST'

export function isGhostUserRole(role?: string | null) {
  return role?.trim().toUpperCase() === GHOST_USER_ROLE
}

export function visibleUserCondition() {
  return ne(users.role, GHOST_USER_ROLE)
}
