import { createError, defineEventHandler, getQuery } from 'h3'
import { count, inArray } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { songComments } from '~/drizzle/schema'

const isCommentsTableMissing = (error: any) => {
  return (
    error?.code === '42P01' ||
    error?.cause?.code === '42P01' ||
    String(error?.message || '').includes('song_comments')
  )
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const rawSongIds = String(query.songIds || '')

  if (!rawSongIds.trim()) {
    return {
      success: true,
      data: { counts: {} }
    }
  }

  const songIds = Array.from(
    new Set(
      rawSongIds
        .split(',')
        .map((id) => Number(id.trim()))
        .filter((id) => Number.isInteger(id) && id > 0)
    )
  ).slice(0, 200)

  if (songIds.length === 0) {
    throw createError({
      statusCode: 400,
      message: '无效的歌曲ID列表'
    })
  }

  try {
    const grouped = await db
      .select({
        songId: songComments.songId,
        count: count(songComments.id)
      })
      .from(songComments)
      .where(inArray(songComments.songId, songIds))
      .groupBy(songComments.songId)

    const counts: Record<number, number> = {}
    songIds.forEach((id) => {
      counts[id] = 0
    })

    grouped.forEach((item) => {
      counts[item.songId] = item.count
    })

    return {
      success: true,
      data: { counts }
    }
  } catch (error: any) {
    if (isCommentsTableMissing(error)) {
      const fallbackCounts: Record<number, number> = {}
      songIds.forEach((id) => {
        fallbackCounts[id] = 0
      })
      return {
        success: true,
        data: {
          counts: fallbackCounts,
          migrationRequired: true
        }
      }
    }

    console.error('[Songs Comments] 获取评论数失败:', error)
    throw createError({
      statusCode: 500,
      message: '获取评论数失败，请稍后重试'
    })
  }
})
