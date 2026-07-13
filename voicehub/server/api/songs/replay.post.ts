import { and, db, eq, songs, systemSettings, songReplayRequests, semesters } from '~/drizzle/db'
import { cacheService } from '~~/server/services/cacheService'

type ReplayAction = 'request' | 'cancel'

const resolveReplayAction = (body: any): ReplayAction => {
  if (
    body?.action === 'cancel' ||
    body?.action === 'withdraw' ||
    body?.action === 'unrequest' ||
    body?.cancel === true
  ) {
    return 'cancel'
  }
  return 'request'
}

const normalizeSongId = (body: any): number | null => {
  const songId = Number(body?.songId ?? body?.id)
  if (!Number.isInteger(songId) || songId <= 0) {
    return null
  }
  return songId
}

const normalizeUserId = (user: any): number | null => {
  const userId = Number(user?.id)
  if (!Number.isInteger(userId) || userId <= 0) {
    return null
  }
  return userId
}

async function clearReplayRelatedCache() {
  try {
    await cacheService.clearSongsCache()
    await cacheService.clearSchedulesCache()
  } catch (error) {
    console.error('[Replay API] 清理缓存失败:', error)
  }
}

const fetchReplayRequestCount = async (songId: number) => {
  const rows = await db
    .select({
      status: songReplayRequests.status
    })
    .from(songReplayRequests)
    .where(eq(songReplayRequests.songId, songId))

  return rows.filter((item) => item.status === 'PENDING' || item.status === 'FULFILLED').length
}

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) {
    throw createError({ statusCode: 401, message: '需要登录才能申请重播' })
  }

  const body = await readBody(event)
  const songId = normalizeSongId(body)
  const action = resolveReplayAction(body)
  const userId = normalizeUserId(user)

  if (!songId) {
    throw createError({ statusCode: 400, message: '歌曲ID不能为空' })
  }
  if (!userId) {
    throw createError({ statusCode: 401, message: '用户身份无效，请重新登录' })
  }

  if (action === 'cancel') {
    const existingPending = await db
      .select()
      .from(songReplayRequests)
      .where(
        and(
          eq(songReplayRequests.songId, songId),
          eq(songReplayRequests.userId, userId),
          eq(songReplayRequests.status, 'PENDING')
        )
      )
      .limit(1)

    const changed = existingPending.length > 0
    if (changed) {
      await db
        .delete(songReplayRequests)
        .where(
          and(
            eq(songReplayRequests.songId, songId),
            eq(songReplayRequests.userId, userId),
            eq(songReplayRequests.status, 'PENDING')
          )
        )
      await clearReplayRelatedCache()
    }
    const replayRequestCount = await fetchReplayRequestCount(songId)

    return {
      success: true,
      message: changed ? '已取消重播申请' : '重播申请已是取消状态',
      data: {
        songId,
        replayRequested: false,
        replayRequestStatus: null,
        replayRequestCount,
        changed
      }
    }
  }

  const settingsResult = await db.select().from(systemSettings).limit(1)
  const settings = settingsResult[0]
  if (!settings?.enableReplayRequests) {
    throw createError({ statusCode: 403, message: '重播申请功能未开启' })
  }

  const songResult = await db.select().from(songs).where(eq(songs.id, songId)).limit(1)
  const song = songResult[0]
  if (!song) {
    throw createError({ statusCode: 404, message: '歌曲不存在' })
  }
  if (!song.played) {
    throw createError({ statusCode: 400, message: '该歌曲尚未播放，无法申请重播' })
  }

  const currentSemesterResult = await db
    .select()
    .from(semesters)
    .where(eq(semesters.isActive, true))
    .limit(1)
  const currentSemester = currentSemesterResult[0]
  if (currentSemester && song.semester !== currentSemester.name) {
    throw createError({ statusCode: 400, message: '只能申请重播当前学期的歌曲' })
  }
  if (!currentSemester) {
    console.warn('[Replay API] 未找到活跃学期，跳过学期限制校验')
  }

  const existingResult = await db
    .select()
    .from(songReplayRequests)
    .where(and(eq(songReplayRequests.songId, songId), eq(songReplayRequests.userId, userId)))
    .limit(1)
  const existing = existingResult[0]

  try {
    let changed = false
    if (existing) {
      if (existing.status === 'PENDING') {
        const replayRequestCount = await fetchReplayRequestCount(songId)
        return {
          success: true,
          message: '您已经申请过重播该歌曲',
          data: {
            songId,
            replayRequested: true,
            replayRequestStatus: 'PENDING',
            replayRequestCount,
            changed: false
          }
        }
      }

      if (existing.status === 'REJECTED') {
        const COOLDOWN_HOURS = 24
        const cooldownTime = COOLDOWN_HOURS * 60 * 60 * 1000
        const timeSinceUpdate = Date.now() - new Date(existing.updatedAt).getTime()

        if (timeSinceUpdate < cooldownTime) {
          const remainingHours = Math.ceil((cooldownTime - timeSinceUpdate) / (60 * 60 * 1000))
          throw createError({
            statusCode: 429,
            message: `您的重播申请被拒绝后需要等待 ${remainingHours} 小时才能重新申请`
          })
        }
      }

      await db
        .update(songReplayRequests)
        .set({
          status: 'PENDING',
          updatedAt: new Date(),
          createdAt: new Date()
        })
        .where(eq(songReplayRequests.id, existing.id))
      changed = true
    } else {
      try {
        await db.insert(songReplayRequests).values({
          songId,
          userId
        })
        changed = true
      } catch (insertError: any) {
        if (insertError?.code === '23505') {
          const replayRequestCount = await fetchReplayRequestCount(songId)
          return {
            success: true,
            message: '您已经申请过重播该歌曲',
            data: {
              songId,
              replayRequested: true,
              replayRequestStatus: 'PENDING',
              replayRequestCount,
              changed: false
            }
          }
        }
        throw insertError
      }
    }

    if (changed) {
      await clearReplayRelatedCache()
    }
    const replayRequestCount = await fetchReplayRequestCount(songId)

    return {
      success: true,
      message: existing ? '重新申请重播成功' : '申请重播成功',
      data: {
        songId,
        replayRequested: true,
        replayRequestStatus: 'PENDING',
        replayRequestCount,
        changed
      }
    }
  } catch (error: any) {
    if (error?.statusCode) {
      throw error
    }
    throw createError({
      statusCode: 500,
      message: '重播申请处理失败，请稍后重试'
    })
  }
})
