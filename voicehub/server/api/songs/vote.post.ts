import { db } from '~/drizzle/db'
import { schedules, semesters, songs, votes } from '~/drizzle/schema'
import { and, count, eq } from 'drizzle-orm'
import { createSongVotedNotification } from '../../services/notificationService'
import { cacheService } from '~~/server/services/cacheService'
import { getClientIP } from '~~/server/utils/ip-utils'
import { applyVoteOffset, fetchVoteOffsetMap } from '~~/server/utils/vote-offset'

type VoteAction = 'vote' | 'unvote'

const resolveVoteAction = (body: any): VoteAction => {
  if (
    body?.action === 'unvote' ||
    body?.action === 'cancel' ||
    body?.cancel === true ||
    body?.unvote === true
  ) {
    return 'unvote'
  }
  return 'vote'
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

const fetchVoteCount = async (songId: number) => {
  const voteCountResult = await db.select({ count: count() }).from(votes).where(eq(votes.songId, songId))
  const rawVoteCount = Number(voteCountResult[0]?.count || 0)
  const voteOffsetMap = await fetchVoteOffsetMap([songId])
  const voteOffset = Number(voteOffsetMap.get(songId) || 0)
  return applyVoteOffset(rawVoteCount, voteOffset)
}

const clearVoteRelatedCache = async (tag: string) => {
  try {
    await cacheService.clearStatsCache()
    await cacheService.clearSongsCache()
    console.log(`[Cache] 统计缓存和歌曲缓存已清除（${tag}）`)
  } catch (cacheError) {
    console.error(`[Cache] 缓存清除失败（${tag}）:`, cacheError)
  }
}

export default defineEventHandler(async (event) => {
  const user = event.context.user

  if (!user) {
    throw createError({
      statusCode: 401,
      message: '需要登录才能投票'
    })
  }

  const body = await readBody(event)
  const clientIP = getClientIP(event)
  const songId = normalizeSongId(body)
  const action = resolveVoteAction(body)
  const userId = normalizeUserId(user)

  if (!songId) {
    throw createError({
      statusCode: 400,
      message: '歌曲ID不能为空'
    })
  }
  if (!userId) {
    throw createError({
      statusCode: 401,
      message: '用户身份无效，请重新登录'
    })
  }

  try {
    const songResult = await db.select().from(songs).where(eq(songs.id, songId)).limit(1)
    const song = songResult[0]

    if (!song) {
      throw createError({
        statusCode: 404,
        message: '歌曲不存在'
      })
    }

    const existingVoteResult = await db
      .select()
      .from(votes)
      .where(and(eq(votes.songId, songId), eq(votes.userId, userId)))
      .limit(1)
    const existingVote = existingVoteResult[0]

    if (action === 'unvote') {
      const changed = !!existingVote
      if (existingVote) {
        await db.delete(votes).where(eq(votes.id, existingVote.id))
        await clearVoteRelatedCache('取消投票')
      }

      const voteCount = await fetchVoteCount(songId)
      return {
        success: true,
        message: changed ? '取消投票成功' : '当前已是未投票状态',
        data: {
          songId,
          voted: false,
          voteCount,
          changed
        }
      }
    }

    // 仅新增点赞时进行业务校验
    if (song.played) {
      throw createError({
        statusCode: 400,
        message: '该歌曲已播放，无法进行投票操作'
      })
    }

    const schedulesResult = await db
      .select()
      .from(schedules)
      .where(and(eq(schedules.songId, songId), eq(schedules.isDraft, false)))
      .limit(1)
    if (schedulesResult.length > 0) {
      throw createError({
        statusCode: 400,
        message: '该歌曲已排期，无法进行投票操作'
      })
    }

    if (song.requesterId === userId) {
      throw createError({
        statusCode: 400,
        message: '不允许自己给自己投票'
      })
    }

    const currentSemesterResult = await db
      .select()
      .from(semesters)
      .where(eq(semesters.isActive, true))
      .limit(1)
    const currentSemester = currentSemesterResult[0]
    if (currentSemester && song.semester !== currentSemester.name) {
      throw createError({
        statusCode: 400,
        message: '非活跃学期，无法进行投票操作'
      })
    }
    if (!currentSemester) {
      console.warn('[Vote API] 未找到活跃学期，跳过学期限制校验')
    }

    if (existingVote) {
      const voteCount = await fetchVoteCount(songId)
      return {
        success: true,
        message: '你已经为这首歌投过票了',
        data: {
          songId,
          voted: true,
          voteCount,
          changed: false
        }
      }
    }

    try {
      await db.insert(votes).values({
        songId,
        userId
      })
    } catch (insertError: any) {
      // 并发情况下唯一索引冲突，按已投票处理
      if (insertError?.code === '23505') {
        const voteCount = await fetchVoteCount(songId)
        return {
          success: true,
          message: '你已经为这首歌投过票了',
          data: {
            songId,
            voted: true,
            voteCount,
            changed: false
          }
        }
      }
      throw insertError
    }

    const voteCount = await fetchVoteCount(songId)

    if (song.requesterId !== userId) {
      createSongVotedNotification(songId, userId, clientIP).catch(() => {
        // 发送通知失败不影响主流程
      })
    }
    await clearVoteRelatedCache('投票')

    return {
      success: true,
      message: '投票成功',
      data: {
        songId,
        voted: true,
        voteCount,
        changed: true
      }
    }
  } catch (error: any) {
    if (error?.statusCode) {
      throw error
    }
    throw createError({
      statusCode: 500,
      message: '操作失败，请稍后重试'
    })
  }
})
