import { db } from '~/drizzle/db'
import {
  collaborationLogs,
  notifications,
  requestTimes,
  schedules,
  songCollaborators,
  songComments,
  songReplayRequests,
  songs,
  votes
} from '~/drizzle/schema'
import { eq, inArray, sql } from 'drizzle-orm'
import { cacheService } from '~~/server/services/cacheService'

const isMissingTableError = (error: any) => {
  const message = String(error?.message || '').toLowerCase()
  return (
    error?.code === '42P01' ||
    error?.code === '42703' ||
    error?.cause?.code === '42P01' ||
    error?.cause?.code === '42703' ||
    message.includes('does not exist')
  )
}

const normalizeSongId = (rawSongId: any): number | null => {
  const songId = Number(rawSongId)
  if (!Number.isInteger(songId) || songId <= 0) {
    return null
  }
  return songId
}

const quoteIdent = (value: string) => `"${value.replace(/"/g, '""')}"`

const getRows = <T = any>(result: any): T[] => {
  if (!result) return []
  if (Array.isArray(result)) return result as T[]
  if (Array.isArray(result.rows)) return result.rows as T[]
  return []
}

const normalizePgArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  }

  if (typeof value === 'string') {
    if (value.startsWith('{') && value.endsWith('}')) {
      return value
        .slice(1, -1)
        .split(',')
        .map((item) => item.trim().replace(/^"|"$/g, ''))
        .filter(Boolean)
    }
    return value ? [value] : []
  }

  return []
}

const extractForeignKeyTableFromError = (error: any): string | null => {
  const detail = String(error?.detail || '')
  const message = String(error?.message || '')
  const combined = `${message} ${detail}`
  const tableMatch = combined.match(/table "([^"]+)"/i)
  return tableMatch?.[1] || null
}

const skipDynamicCleanupTables = new Set([
  'Vote',
  'Schedule',
  'Notification',
  'song_collaborators',
  'song_replay_requests',
  'song_comments',
  'collaboration_logs'
])

export default defineEventHandler(async (event) => {
  // 检查用户认证和权限
  const user = event.context.user
  if (!user || !['SONG_ADMIN', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    throw createError({
      statusCode: 403,
      message: '没有权限访问'
    })
  }

  const body = await readBody(event)
  const songId = normalizeSongId(body?.songId)

  if (!songId) {
    throw createError({
      statusCode: 400,
      message: '歌曲ID不能为空'
    })
  }

  try {
    // 使用事务确保删除操作的原子性
    const result = await db.transaction(async (tx) => {
      const safeTransactionalDelete = async (
        label: string,
        task: () => Promise<unknown>,
        optional: boolean = true
      ) => {
        try {
          await task()
        } catch (error: any) {
          if (optional && isMissingTableError(error)) {
            console.warn(`[Delete Song] 跳过 ${label}，数据表不存在`)
            return
          }
          throw error
        }
      }

      // 在事务中重新检查歌曲是否存在
      const songResult = await tx.select().from(songs).where(eq(songs.id, songId)).limit(1)
      const song = songResult[0]

      if (!song) {
        throw createError({
          statusCode: 404,
          message: '歌曲不存在或已被删除'
        })
      }

      console.log(`开始删除歌曲: ${song.title} (ID: ${songId})`)

      // 清理联合投稿审计日志（如果表存在）
      await safeTransactionalDelete('collaboration_logs', async () => {
        const collaboratorRows = await tx
          .select({ id: songCollaborators.id })
          .from(songCollaborators)
          .where(eq(songCollaborators.songId, songId))

        const collaboratorIds = collaboratorRows.map((row) => row.id)
        if (collaboratorIds.length > 0) {
          await tx
            .delete(collaborationLogs)
            .where(inArray(collaborationLogs.collaboratorId, collaboratorIds))
        }
      })

      // 清理联合投稿记录（如果表存在）
      await safeTransactionalDelete('song_collaborators', async () => {
        await tx.delete(songCollaborators).where(eq(songCollaborators.songId, songId))
      })

      // 清理评论（如果表存在）
      await safeTransactionalDelete('song_comments', async () => {
        await tx.delete(songComments).where(eq(songComments.songId, songId))
      })

      // 清理重播申请（如果表存在）
      await safeTransactionalDelete('song_replay_requests', async () => {
        await tx.delete(songReplayRequests).where(eq(songReplayRequests.songId, songId))
      })

      // 清理与歌曲相关通知（如果表存在）
      await safeTransactionalDelete('Notification', async () => {
        await tx.delete(notifications).where(eq(notifications.songId, songId))
      })

      // 删除歌曲的所有投票
      await safeTransactionalDelete(
        'Vote',
        async () => {
          await tx.delete(votes).where(eq(votes.songId, songId))
        },
        false
      )
      console.log(`删除了投票记录`)

      // 删除歌曲的所有排期
      await safeTransactionalDelete(
        'Schedule',
        async () => {
          await tx.delete(schedules).where(eq(schedules.songId, songId))
        },
        false
      )
      console.log(`删除了排期记录`)

      // 兜底清理：自动扫描所有外键引用 Song 的表，避免历史/新增表导致删除失败
      await safeTransactionalDelete('dynamic_fk_cleanup', async () => {
        try {
          const fkResult = await tx.execute(sql`
            SELECT
              n.nspname AS schema_name,
              c.relname AS table_name,
              array_agg(a.attname ORDER BY k.ordinality) AS column_names
            FROM pg_constraint co
            JOIN pg_class c ON c.oid = co.conrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            JOIN LATERAL unnest(co.conkey) WITH ORDINALITY AS k(attnum, ordinality) ON TRUE
            JOIN pg_attribute a ON a.attrelid = co.conrelid AND a.attnum = k.attnum
            WHERE co.contype = 'f'
              AND co.confrelid = to_regclass('public."Song"')
            GROUP BY n.nspname, c.relname
          `)

          const fkRows = getRows<{
            schema_name?: string
            table_name?: string
            column_names?: string[] | string
          }>(fkResult)

          for (const row of fkRows) {
            const schemaName = row.schema_name || 'public'
            const tableName = row.table_name
            const columns = normalizePgArray(row.column_names)

            if (!tableName || skipDynamicCleanupTables.has(tableName)) {
              continue
            }

            // 仅处理单列外键，复合外键保留给显式逻辑处理
            if (columns.length !== 1) {
              continue
            }

            const columnName = columns[0]
            const deleteSql = `DELETE FROM ${quoteIdent(schemaName)}.${quoteIdent(tableName)} WHERE ${quoteIdent(columnName)} = ${songId}`

            await tx.execute(sql.raw(deleteSql))
            console.log(`[Delete Song] 已清理外键引用表 ${schemaName}.${tableName}.${columnName}`)
          }
        } catch (dynamicCleanupError) {
          console.warn('[Delete Song] 动态外键清理失败，继续执行主删除流程:', dynamicCleanupError)
        }
      })

      // 如果有 hitRequestId，减少对应时段的已接纳数量
      if (song.hitRequestId) {
        try {
          await tx
            .update(requestTimes)
            .set({
              accepted: sql`GREATEST(0, accepted - 1)`
            })
            .where(eq(requestTimes.id, song.hitRequestId))
          console.log(`已减少投稿时段 ${song.hitRequestId} 的接纳数量`)
        } catch (requestTimeError: any) {
          if (isMissingTableError(requestTimeError)) {
            console.warn('[Delete Song] 跳过 RequestTime 清理，数据表或字段不存在')
          } else {
            console.warn('[Delete Song] 更新 RequestTime 失败，继续执行主删除流程:', requestTimeError)
          }
        }
      }

      // 删除歌曲
      const deletedSong = await tx.delete(songs).where(eq(songs.id, songId)).returning({
        id: songs.id,
        title: songs.title
      })
      const deletedSongData = deletedSong[0]

      if (!deletedSongData) {
        throw createError({
          statusCode: 404,
          message: '歌曲不存在或已被删除'
        })
      }

      console.log(`成功删除歌曲: ${deletedSongData?.title}`)

      return {
        message: '歌曲已成功删除',
        songId,
        deletedSchedules: true
      }
    })

    // 清除相关缓存
    try {
      await cacheService.clearSongsCache()
      if (result.deletedSchedules) {
        await cacheService.clearSchedulesCache()
      }
      await cacheService.clearStatsCache()
      console.log('[Cache] 歌曲和排期缓存已清除（删除歌曲）')
    } catch (cacheError) {
      console.warn('[Cache] 清除缓存失败:', cacheError)
    }

    return result
  } catch (error: any) {
    console.error('删除歌曲时发生错误:', error)

    // 如果是已经格式化的错误，直接抛出
    if (error.statusCode) {
      throw error
    }

    if (error?.code === '23503') {
      const tableName = extractForeignKeyTableFromError(error)
      throw createError({
        statusCode: 409,
        message: tableName
          ? `歌曲仍被关联数据引用（表: ${tableName}），删除失败`
          : '歌曲存在关联数据，删除失败，请联系管理员检查关联约束'
      })
    }

    // 处理旧栈兼容错误码
    if (error?.code === 'P2025') {
      throw createError({
        statusCode: 404,
        message: '歌曲不存在或已被删除'
      })
    }

    // 其他未知错误
    throw createError({
      statusCode: 500,
      message: '删除歌曲时发生未知错误'
    })
  }
})
