import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { count, eq, sql } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { songs, votes } from '~/drizzle/schema'
import { cacheService } from '~~/server/services/cacheService'
import { applyVoteOffset } from '~~/server/utils/vote-offset'

const normalizeSongId = (rawSongId: unknown): number | null => {
  const songId = Number(rawSongId)
  if (!Number.isInteger(songId) || songId <= 0) {
    return null
  }
  return songId
}

const normalizeTargetCount = (rawTargetCount: unknown): number | null => {
  const targetCount = Number(rawTargetCount)
  if (!Number.isInteger(targetCount) || targetCount < 0) {
    return null
  }
  return targetCount
}

const isMissingVoteOffsetTableError = (error: unknown) => {
  const normalized = error as { code?: string; cause?: { code?: string }; message?: string }
  const message = String(normalized?.message || '').toLowerCase()
  return (
    normalized?.code === '42P01' ||
    normalized?.cause?.code === '42P01' ||
    message.includes('song_vote_offsets') ||
    message.includes('does not exist')
  )
}

const ensureVoteOffsetTable = async () => {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS song_vote_offsets (
      id SERIAL PRIMARY KEY,
      song_id INTEGER NOT NULL,
      vote_offset INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by INTEGER
    )
  `)

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS song_vote_offsets_song_id_unique
    ON song_vote_offsets (song_id)
  `)
}

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user || !['SONG_ADMIN', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    throw createError({
      statusCode: 403,
      message: '没有权限访问'
    })
  }

  const songId = normalizeSongId(getRouterParam(event, 'id'))
  if (!songId) {
    throw createError({
      statusCode: 400,
      message: '无效的歌曲ID'
    })
  }

  const body = await readBody(event)
  const targetCount = normalizeTargetCount(body?.targetCount)
  if (targetCount === null) {
    throw createError({
      statusCode: 400,
      message: '目标票数必须是非负整数'
    })
  }

  try {
    try {
      await ensureVoteOffsetTable()
    } catch (error) {
      if (!isMissingVoteOffsetTableError(error)) {
        throw error
      }
    }

    const result = await db.transaction(async (tx) => {
      const songRows = await tx
        .select({
          id: songs.id,
          title: songs.title
        })
        .from(songs)
        .where(eq(songs.id, songId))
        .limit(1)

      const song = songRows[0]
      if (!song) {
        throw createError({
          statusCode: 404,
          message: '歌曲不存在'
        })
      }

      const rawVoteCountRows = await tx
        .select({
          count: count(votes.id)
        })
        .from(votes)
        .where(eq(votes.songId, songId))

      const rawVoteCount = Number(rawVoteCountRows[0]?.count || 0)
      const targetOffset = targetCount - rawVoteCount

      if (targetOffset === 0) {
        await tx.execute(sql`DELETE FROM song_vote_offsets WHERE song_id = ${songId}`)
      } else {
        await tx.execute(sql`
          INSERT INTO song_vote_offsets (song_id, vote_offset, updated_at, updated_by)
          VALUES (${songId}, ${targetOffset}, NOW(), ${Number(user.id) || null})
          ON CONFLICT (song_id)
          DO UPDATE SET
            vote_offset = EXCLUDED.vote_offset,
            updated_at = NOW(),
            updated_by = EXCLUDED.updated_by
        `)
      }

      const totalVotes = applyVoteOffset(rawVoteCount, targetOffset)

      return {
        songId,
        songTitle: song.title,
        rawVoteCount,
        voteOffset: targetOffset,
        totalVotes
      }
    })

    try {
      await cacheService.clearSongsCache()
      await cacheService.clearSchedulesCache()
      await cacheService.clearStatsCache()
    } catch (cacheError) {
      console.error('[Admin Vote Count] 清理缓存失败:', cacheError)
    }

    return {
      success: true,
      message: '投票人数已更新',
      data: result
    }
  } catch (error: unknown) {
    const normalized = error as { statusCode?: number; code?: string; message?: string }

    if (normalized?.statusCode) {
      throw error
    }

    if (normalized?.code === '42P01') {
      throw createError({
        statusCode: 500,
        message: '投票偏移量表初始化失败，请稍后重试'
      })
    }

    console.error('[Admin Vote Count] 更新投票人数失败:', error)
    throw createError({
      statusCode: 500,
      message: '更新投票人数失败，请稍后重试'
    })
  }
})
