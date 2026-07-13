import { createError, defineEventHandler } from 'h3'
import { promises as fs } from 'fs'
import path from 'path'
import { eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { users } from '~/drizzle/schema'
import { cacheService } from '~~/server/services/cacheService'
import { cache } from '~~/server/utils/cache-helpers'

const AVATAR_FILENAME_REGEX = /^[A-Za-z0-9._-]+$/

const getAvatarStorageDirs = (): string[] => {
  const root = process.cwd()

  const envDir = process.env.AVATAR_UPLOAD_DIR?.trim()
  const resolvedEnvDir = envDir
    ? path.isAbsolute(envDir)
      ? envDir
      : path.join(root, envDir)
    : null

  const ordered = [
    resolvedEnvDir,
    path.join(root, 'storage', 'uploads', 'avatars'),
    path.join(root, '.output', 'public', 'uploads', 'avatars'),
    path.join(root, 'public', 'uploads', 'avatars')
  ].filter((item): item is string => Boolean(item))

  return [...new Set(ordered)]
}

const extractAvatarFileName = (avatar?: string | null): string | null => {
  if (typeof avatar !== 'string') {
    return null
  }

  const normalized = avatar.trim()
  if (!normalized) {
    return null
  }

  const markers = ['/api/user/avatar-file/', '/uploads/avatars/']
  for (const marker of markers) {
    const markerIndex = normalized.indexOf(marker)
    if (markerIndex === -1) {
      continue
    }

    const maybeName = normalized.slice(markerIndex + marker.length).split('?')[0].split('#')[0].trim()
    try {
      const decodedName = decodeURIComponent(maybeName)
      if (AVATAR_FILENAME_REGEX.test(decodedName)) {
        return decodedName
      }
    } catch {
      continue
    }
  }

  return null
}

const resolveStoredAvatarPaths = (avatar?: string | null): string[] => {
  const fileName = extractAvatarFileName(avatar)
  if (!fileName) {
    return []
  }

  return getAvatarStorageDirs().map((dir) => path.join(dir, fileName))
}

export default defineEventHandler(async (event) => {
  const authUser = event.context.user

  if (!authUser) {
    throw createError({
      statusCode: 401,
      message: '需要登录后才能移除头像'
    })
  }

  const currentUserResult = await db
    .select({
      id: users.id,
      avatar: users.avatar
    })
    .from(users)
    .where(eq(users.id, authUser.id))
    .limit(1)

  const currentUser = currentUserResult[0]
  if (!currentUser) {
    throw createError({
      statusCode: 404,
      message: '用户不存在'
    })
  }

  const oldAvatarPaths = resolveStoredAvatarPaths(currentUser.avatar)

  await db
    .update(users)
    .set({
      avatar: null,
      updatedAt: new Date()
    })
    .where(eq(users.id, authUser.id))

  for (const oldAvatarPath of oldAvatarPaths) {
    await fs.unlink(oldAvatarPath).catch(() => {})
  }

  try {
    await cache.delete(`auth:user:${authUser.id}`)
    await cache.deletePattern('songs:*')
    await cache.deletePattern('public_schedules:*')
    await cacheService.clearSongsCache()
    await cacheService.clearSchedulesCache()
    console.log(`[Cache] 用户头像移除后缓存已清理: ${authUser.id}`)
  } catch (cacheError) {
    console.warn('[Cache] 用户头像移除后清理缓存失败:', cacheError)
  }

  return {
    success: true,
    data: {
      avatar: null
    },
    message: currentUser.avatar ? '头像已移除' : '当前未设置自定义头像'
  }
})
