import { createError, defineEventHandler, getRouterParam } from 'h3'
import { db } from '~/drizzle/db'
import {
  apiKeyPermissions,
  apiKeys,
  apiLogs,
  collaborationLogs,
  notificationSettings,
  notifications,
  schedules,
  songCollaborators,
  songReplayRequests,
  songs,
  userIdentities,
  users,
  userStatusLogs,
  votes
} from '~/drizzle/schema'
import { eq, inArray } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  try {
    // 检查认证和权限
    const user = event.context.user
    if (!user || !['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      throw createError({
        statusCode: 403,
        statusMessage: '没有权限访问'
      })
    }

    const userId = getRouterParam(event, 'id')
    const parsedUserId = Number.parseInt(userId || '', 10)
    if (Number.isNaN(parsedUserId)) {
      throw createError({
        statusCode: 400,
        message: '无效的用户ID'
      })
    }

    // 检查用户是否存在
    const existingUserResult = await db
      .select()
      .from(users)
      .where(eq(users.id, parsedUserId))
      .limit(1)
    const existingUser = existingUserResult[0]

    if (!existingUser) {
      throw createError({
        statusCode: 404,
        message: '用户不存在'
      })
    }

    // 1. 绝对禁止删除 ID 为 1 的用户 (系统初始超级管理员)
    if (existingUser.id === 1) {
      throw createError({
        statusCode: 403,
        message: '无法删除系统初始超级管理员'
      })
    }

    // 2. 禁止删除自己 (增强类型安全)
    // 使用 String 转换确保 ID 比较的准确性
    if (String(existingUser.id) === String(user.id)) {
      throw createError({
        statusCode: 400,
        message: '不能删除自己的账户'
      })
    }

    // 3. 越级删除保护
    // 如果目标用户是 SUPER_ADMIN，操作者必须是 SUPER_ADMIN
    if (existingUser.role === 'SUPER_ADMIN' && user.role !== 'SUPER_ADMIN') {
      throw createError({
        statusCode: 403,
        message: '权限不足：普通管理员无法删除超级管理员'
      })
    }

    // 清理关联数据并删除用户，避免外键约束导致删除失败
    await db.transaction(async (tx) => {
      const userSongRows = await tx
        .select({ id: songs.id })
        .from(songs)
        .where(eq(songs.requesterId, parsedUserId))
      const userSongIds = userSongRows.map((row) => row.id)

      const userApiKeyRows = await tx
        .select({ id: apiKeys.id })
        .from(apiKeys)
        .where(eq(apiKeys.createdByUserId, parsedUserId))
      const userApiKeyIds = userApiKeyRows.map((row) => row.id)

      if (userSongIds.length > 0) {
        const songCollaboratorRows = await tx
          .select({ id: songCollaborators.id })
          .from(songCollaborators)
          .where(inArray(songCollaborators.songId, userSongIds))
        const songCollaboratorIds = songCollaboratorRows.map((row) => row.id)

        if (songCollaboratorIds.length > 0) {
          await tx.delete(collaborationLogs).where(inArray(collaborationLogs.collaboratorId, songCollaboratorIds))
        }

        await tx.delete(songReplayRequests).where(inArray(songReplayRequests.songId, userSongIds))
        await tx.delete(votes).where(inArray(votes.songId, userSongIds))
        await tx.delete(notifications).where(inArray(notifications.songId, userSongIds))
        await tx.delete(schedules).where(inArray(schedules.songId, userSongIds))
        await tx.delete(songCollaborators).where(inArray(songCollaborators.songId, userSongIds))
        await tx.delete(songs).where(inArray(songs.id, userSongIds))
      }

      const userCollaboratorRows = await tx
        .select({ id: songCollaborators.id })
        .from(songCollaborators)
        .where(eq(songCollaborators.userId, parsedUserId))
      const userCollaboratorIds = userCollaboratorRows.map((row) => row.id)

      if (userCollaboratorIds.length > 0) {
        await tx.delete(collaborationLogs).where(inArray(collaborationLogs.collaboratorId, userCollaboratorIds))
      }

      if (userApiKeyIds.length > 0) {
        await tx.delete(apiLogs).where(inArray(apiLogs.apiKeyId, userApiKeyIds))
        await tx.delete(apiKeyPermissions).where(inArray(apiKeyPermissions.apiKeyId, userApiKeyIds))
        await tx.delete(apiKeys).where(inArray(apiKeys.id, userApiKeyIds))
      }

      await tx.delete(songCollaborators).where(eq(songCollaborators.userId, parsedUserId))
      await tx.delete(songReplayRequests).where(eq(songReplayRequests.userId, parsedUserId))
      await tx.delete(votes).where(eq(votes.userId, parsedUserId))
      await tx.delete(notifications).where(eq(notifications.userId, parsedUserId))
      await tx.delete(notificationSettings).where(eq(notificationSettings.userId, parsedUserId))
      await tx.delete(userStatusLogs).where(eq(userStatusLogs.userId, parsedUserId))
      await tx.delete(userStatusLogs).where(eq(userStatusLogs.operatorId, parsedUserId))
      await tx.delete(userIdentities).where(eq(userIdentities.userId, parsedUserId))
      await tx.update(users).set({ statusChangedBy: null }).where(eq(users.statusChangedBy, parsedUserId))

      await tx.delete(users).where(eq(users.id, parsedUserId))
    })

    // 清除相关缓存
    try {
      const { cache } = await import('~~/server/utils/cache-helpers')
      await cache.deletePattern('songs:*')
      await cache.deletePattern('schedules:*')
      await cache.deletePattern('stats:*')
      // 清除该用户的认证缓存
      await cache.delete(`auth:user:${existingUser.id}`)
      console.log('[Cache] 歌曲、排期、统计和用户认证缓存已清除（用户删除）')
    } catch (cacheError) {
      console.warn('[Cache] 清除缓存失败:', cacheError)
    }

    return {
      success: true,
      message: '用户删除成功'
    }
  } catch (error) {
    console.error('删除用户失败:', error)

    if (error.statusCode) {
      throw error
    }

    if ((error as any)?.code === '23503') {
      throw createError({
        statusCode: 409,
        message: '用户存在未清理的关联数据，删除失败，请稍后重试或联系管理员'
      })
    }

    throw createError({
      statusCode: 500,
      message: '删除用户失败: ' + error.message
    })
  }
})
