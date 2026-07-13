import { createError, defineEventHandler, readBody } from 'h3'
import { eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { users } from '~/drizzle/schema'
import { cacheService } from '~~/server/services/cacheService'
import { cache } from '~~/server/utils/cache-helpers'

export default defineEventHandler(async (event) => {
  const authUser = event.context.user

  if (!authUser) {
    throw createError({
      statusCode: 401,
      message: '需要登录后才能修改资料'
    })
  }

  const body = await readBody(event)
  const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : ''

  if (!displayName) {
    throw createError({
      statusCode: 400,
      message: '显示昵称不能为空'
    })
  }

  if (displayName.length > 30) {
    throw createError({
      statusCode: 400,
      message: '显示昵称不能超过30个字符'
    })
  }

  const updatedUserResult = await db
    .update(users)
    .set({
      name: displayName,
      updatedAt: new Date()
    })
    .where(eq(users.id, authUser.id))
    .returning({
      id: users.id,
      username: users.username,
      name: users.name
    })

  const updatedUser = updatedUserResult[0]
  if (!updatedUser) {
    throw createError({
      statusCode: 404,
      message: '用户不存在'
    })
  }

  try {
    await cache.delete(`auth:user:${authUser.id}`)
    await cache.deletePattern('songs:*')
    await cache.deletePattern('public_schedules:*')
    await cacheService.clearSongsCache()
    await cacheService.clearSchedulesCache()
    console.log(`[Cache] 用户昵称更新后缓存已清理: ${authUser.id}`)
  } catch (cacheError) {
    console.warn('[Cache] 用户昵称更新后清理缓存失败:', cacheError)
  }

  return {
    success: true,
    data: {
      id: updatedUser.id,
      username: updatedUser.username,
      displayName: updatedUser.name || updatedUser.username
    },
    message: '显示昵称更新成功'
  }
})
