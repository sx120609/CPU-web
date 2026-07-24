import { and, eq, inArray } from 'drizzle-orm'
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

    const publishedSchedules = await db
      .select({
        scheduleId: schedules.id,
        songId: schedules.songId,
        playDate: schedules.playDate,
        played: schedules.played
      })
      .from(schedules)
      .where(eq(schedules.isDraft, false))

    const now = getBeijingTime()
    const overdueSchedules = publishedSchedules.filter(
      (item) => new Date(item.playDate).getTime() < todayStart.getTime()
    )
    const incorrectlyPlayedSchedules = publishedSchedules.filter(
      (item) => item.played && new Date(item.playDate).getTime() >= todayStart.getTime()
    )
    const scheduleIds = overdueSchedules.map((item) => item.scheduleId)
    const songIds = [...new Set(overdueSchedules.map((item) => item.songId))]

    if (scheduleIds.length > 0) {
      await db
        .update(schedules)
        .set({
          played: true,
          updatedAt: now
        })
        .where(and(inArray(schedules.id, scheduleIds), eq(schedules.played, false)))
    }

    if (incorrectlyPlayedSchedules.length > 0) {
      await db
        .update(schedules)
        .set({
          played: false,
          updatedAt: now
        })
        .where(inArray(schedules.id, incorrectlyPlayedSchedules.map((item) => item.scheduleId)))
    }

    const storedSongStates = await db
      .select({
        id: songs.id,
        played: songs.played
      })
      .from(songs)
    const overdueSongIds = new Set(songIds)
    const songIdsToMark = storedSongStates
      .filter((song) => overdueSongIds.has(song.id) && !song.played)
      .map((song) => song.id)
    const songIdsToReset = storedSongStates
      .filter((song) => !overdueSongIds.has(song.id) && song.played)
      .map((song) => song.id)

    let updatedSongs: Array<{ id: number }> = []
    if (songIdsToMark.length > 0) {
      try {
        updatedSongs = await db
          .update(songs)
          .set({
            played: true,
            playedAt: now,
            updatedAt: now
          })
          .where(inArray(songs.id, songIdsToMark))
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
            .where(inArray(songs.id, songIdsToMark))
            .returning({ id: songs.id })
        } else {
          throw error
        }
      }
    }

    if (songIdsToReset.length > 0) {
      try {
        await db
          .update(songs)
          .set({
            played: false,
            playedAt: null,
            updatedAt: now
          })
          .where(inArray(songs.id, songIdsToReset))
      } catch (error: any) {
        if (isMissingColumnError(error, 'playedAt')) {
          await db
            .update(songs)
            .set({
              played: false,
              updatedAt: now
            })
            .where(inArray(songs.id, songIdsToReset))
        } else {
          throw error
        }
      }
    }

    if (songIds.length > 0) {
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
    }

    const changed =
      updatedSongs.length > 0
      || songIdsToReset.length > 0
      || incorrectlyPlayedSchedules.length > 0
      || overdueSchedules.some((item) => !item.played)
    if (changed) {
      await cacheService.clearSchedulesCache()
      await cacheService.clearSongsCache()
    }

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
      `[Schedule Auto Archive] 状态已按排期日期同步：${scheduleIds.length} 条过期排期，${updatedSongs.length} 首歌曲设为已播放，${songIdsToReset.length} 首歌曲纠正为未播放（来源: ${source}）`
    )

    return {
      skipped: false,
      scheduleCount: scheduleIds.length,
      updatedSongCount: updatedSongs.length + songIdsToReset.length
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
