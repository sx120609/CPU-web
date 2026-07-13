import { createError, defineEventHandler, readBody } from 'h3'
import { count, eq, or } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { songComments } from '~/drizzle/schema'

const isCommentsTableMissing = (error: any) => {
  return (
    error?.code === '42P01' ||
    error?.cause?.code === '42P01' ||
    String(error?.message || '').includes('song_comments')
  )
}

const isCommentsReplyColumnMissing = (error: any) => {
  return (
    error?.code === '42703' ||
    error?.cause?.code === '42703' ||
    String(error?.message || '').includes('parent_comment_id')
  )
}

const isAdminRole = (role: string | undefined) => {
  return ['SUPER_ADMIN', 'ADMIN', 'SONG_ADMIN'].includes(role || '')
}

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) {
    throw createError({
      statusCode: 401,
      message: '请先登录后再操作'
    })
  }

  const body = await readBody(event)
  const commentId = Number(body?.commentId)
  if (!Number.isInteger(commentId) || commentId <= 0) {
    throw createError({
      statusCode: 400,
      message: '无效的评论ID'
    })
  }

  try {
    let comment:
      | {
          id: number
          userId: number
          songId: number
          parentCommentId: number | null
        }
      | undefined
    let replyColumnAvailable = true

    try {
      const rows = await db
        .select({
          id: songComments.id,
          userId: songComments.userId,
          songId: songComments.songId,
          parentCommentId: songComments.parentCommentId
        })
        .from(songComments)
        .where(eq(songComments.id, commentId))
        .limit(1)
      comment = rows[0]
    } catch (error: any) {
      if (!isCommentsReplyColumnMissing(error)) {
        throw error
      }

      replyColumnAvailable = false
      const rows = await db
        .select({
          id: songComments.id,
          userId: songComments.userId,
          songId: songComments.songId
        })
        .from(songComments)
        .where(eq(songComments.id, commentId))
        .limit(1)

      const fallbackComment = rows[0]
      comment = fallbackComment
        ? {
            ...fallbackComment,
            parentCommentId: null
          }
        : undefined
    }

    if (!comment) {
      throw createError({
        statusCode: 404,
        message: '评论不存在或已被删除'
      })
    }

    const canDelete = isAdminRole(user.role) || Number(comment.userId) === Number(user.id)
    if (!canDelete) {
      throw createError({
        statusCode: 403,
        message: '无权限删除该评论'
      })
    }

    if (replyColumnAvailable && !comment.parentCommentId) {
      await db
        .delete(songComments)
        .where(or(eq(songComments.id, commentId), eq(songComments.parentCommentId, commentId)))
    } else {
      await db.delete(songComments).where(eq(songComments.id, commentId))
    }

    const countResult = await db
      .select({ count: count(songComments.id) })
      .from(songComments)
      .where(eq(songComments.songId, comment.songId))

    return {
      success: true,
      message: '评论删除成功',
      data: {
        commentCount: countResult[0]?.count || 0
      }
    }
  } catch (error: any) {
    if (error?.statusCode) {
      throw error
    }

    if (isCommentsTableMissing(error)) {
      throw createError({
        statusCode: 503,
        message: '评论功能尚未初始化，请先执行数据库迁移'
      })
    }

    console.error('[Songs Comments] 删除评论失败:', error)
    throw createError({
      statusCode: 500,
      message: '删除评论失败，请稍后重试'
    })
  }
})
