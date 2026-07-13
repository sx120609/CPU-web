import { and, eq, inArray, lt } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { schedules, songReplayRequests, songs } from '~/drizzle/schema'
import { getBeijingStartOfDay, getBeijingTime } from '~/utils/timeUtils'
import { cacheService } from '~~/server/services/cacheService'
import { createSongPlayedNotification } from '~~/server/services/notificationService'

interface AutoArchiveResult {
  skipped: boolean
  reason?: string
  scheduleCount: number
  updatedSongCount: number
}

const RUN_INTERVAL_MS = 60 * 1000
let lastRunAt = 0
let runningTask: Promise<AutoArchiveResult> | null = null

const isMissingColumnError = (error: any, columnName: string) => {
  return (
    error?.code === '42703' ||
    (typeof error?.message === 'string' &&
      error.message.toLowerCase().includes(columnName.toLowerCase()))
  )
}

const isMissingReplayTableError = (error: any) => {
  const message = typeof error?.message === 'string' ? error.message.toLowerCase() : ''
  return (
    error?.code === '42P01' ||
    message.includes('song_replay_requests') ||
    message.includes('replay_request_status')
  )
}

const runAutoArchive = async (source: string): Promise<AutoArchiveResult> => {
  try {
    const todayStart = getBeijingStartOfDay()

    const overdueSchedules = await db
      .select({
        scheduleId: schedules.id,
        songId: schedules.songId
      })
      .from(schedules)
      .where(
        and(
          eq(schedules.isDraft, false),
          eq(schedules.played, false),
          lt(schedules.playDate, todayStart)
        )
      )

    if (overdueSchedules.length === 0) {
      return {
        skipped: false,
        scheduleCount: 0,
        updatedSongCount: 0
      }
    }

    const now = getBeijingTime()
    const scheduleIds = overdueSchedules.map((item) => item.scheduleId)
    const songIds = [...new Set(overdueSchedules.map((item) => item.songId))]

    await db
      .update(schedules)
      .set({
        played: true,
        updatedAt: now
      })
      .where(and(inArray(schedules.id, scheduleIds), eq(schedules.played, false)))

    let updatedSongs: Array<{ id: number }> = []
    try {
      updatedSongs = await db
        .update(songs)
        .set({
          played: true,
          playedAt: now,
          updatedAt: now
        })
        .where(and(inArray(songs.id, songIds), eq(songs.played, false)))
        .returning({ id: songs.id })
    } catch (error: any) {
      if (isMissingColumnError(error, 'playedAt')) {
        console.warn('[Schedule Auto Archive] playedAt 字段不存在，回退为仅更新 played 字段')
        updatedSongs = await db
          .update(songs)
          .set({
            played: true,
            updatedAt: now
          })
          .where(and(inArray(songs.id, songIds), eq(songs.played, false)))
          .returning({ id: songs.id })
      } else {
        throw error
      }
    }

    try {
      await db
        .update(songReplayRequests)
        .set({
          status: 'FULFILLED',
          updatedAt: now
        })
        .where(
          and(inArray(songReplayRequests.songId, songIds), eq(songReplayRequests.status, 'PENDING'))
        )
    } catch (error: any) {
      if (isMissingReplayTableError(error)) {
        console.warn('[Schedule Auto Archive] song_replay_requests 表不存在，跳过重播申请状态联动')
      } else {
        throw error
      }
    }

    await cacheService.clearSchedulesCache()
    await cacheService.clearSongsCache()

    if (updatedSongs.length > 0) {
      const updatedSongIds = updatedSongs.map((song) => song.id)
      const notifyTask = () => {
        Promise.allSettled(
          updatedSongIds.map((songId) =>
            createSongPlayedNotification(songId, `system:auto-archive:${source}`)
          )
        ).catch((error) => {
          console.error('[Schedule Auto Archive] 发送“已播放”通知失败:', error)
        })
      }

      if (typeof setImmediate === 'function') {
        setImmediate(notifyTask)
      } else {
        setTimeout(notifyTask, 0)
      }
    }

    console.log(
      `[Schedule Auto Archive] 已自动归档 ${scheduleIds.length} 条过期排期，更新 ${updatedSongs.length} 首歌曲为已播放（来源: ${source}）`
    )

    return {
      skipped: false,
      scheduleCount: scheduleIds.length,
      updatedSongCount: updatedSongs.length
    }
  } catch (error) {
    console.error('[Schedule Auto Archive] 执行失败:', error)
    return {
      skipped: true,
      reason: 'error',
      scheduleCount: 0,
      updatedSongCount: 0
    }
  }
}

export const autoArchivePastSchedules = async (
  options: { force?: boolean; source?: string } = {}
): Promise<AutoArchiveResult> => {
  const source = options.source || 'unknown'
  const now = Date.now()

  if (!options.force && now - lastRunAt < RUN_INTERVAL_MS) {
    return {
      skipped: true,
      reason: 'cooldown',
      scheduleCount: 0,
      updatedSongCount: 0
    }
  }

  if (runningTask) {
    return runningTask
  }

  runningTask = runAutoArchive(source).finally(() => {
    lastRunAt = Date.now()
    runningTask = null
  })

  return runningTask
}

