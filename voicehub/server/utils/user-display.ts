interface DisplayableUser {
  name?: string | null
  username?: string | null
}

/**
 * Public pages show only the user's chosen display name. Grade and class stay
 * available as separate fields for authorized admin views, but are never
 * composed into a public-facing name.
 */
export const getPublicUserDisplayName = (user?: DisplayableUser | null) => {
  return user?.name?.trim() || user?.username?.trim() || '未知用户'
}
