import { and, db, eq, songReplayRequests } from '~/drizzle/db'
import { cacheService } from '~~/server/services/cacheService'

export default defineEventHandler(async (event) => {
  // 1. 检查用户认证
  const user = event.context.user
  if (!user) {
    throw createError({ statusCode: 401, message: '需要登录才能取消重播申请' })
  }

  // 2. 读取请求参数（兼容 DELETE body 被代理剥离的场景）
  let body: any = {}
  try {
    body = await readBody(event)
  } catch {
    body = {}
  }
  const query = getQuery(event)
  const songId = Number(body?.songId ?? query?.songId)

  if (!songId || Number.isNaN(songId)) {
    throw createError({ statusCode: 400, message: '歌曲ID不能为空' })
  }

  // 3. 检查申请是否存在且属于该用户
  const existing = await db
    .select()
    .from(songReplayRequests)
    .where(
      and(
        eq(songReplayRequests.songId, songId),
        eq(songReplayRequests.userId, user.id),
        eq(songReplayRequests.status, 'PENDING')
      )
    )
    .limit(1)

  if (existing.length === 0) {
    throw createError({ statusCode: 404, message: '重播申请不存在或无权取消' })
  }

  // 4. 删除申请记录
  try {
    await db
      .delete(songReplayRequests)
      .where(
        and(
          eq(songReplayRequests.songId, songId),
          eq(songReplayRequests.userId, user.id),
          eq(songReplayRequests.status, 'PENDING')
        )
      )

    try {
      await cacheService.clearSongsCache()
      await cacheService.clearSchedulesCache()
    } catch (cacheError) {
      console.error('[Replay API] 清理缓存失败:', cacheError)
    }

    return { success: true, message: '已取消重播申请' }
  } catch (error: any) {
    console.error('取消重播申请失败:', error)
    throw createError({ statusCode: 500, message: '取消重播申请失败，请稍后再试' })
  }
})
