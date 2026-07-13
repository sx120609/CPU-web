import { db } from '~/drizzle/db'
import {
  notifications,
  notificationSettings,
  playTimes,
  schedules,
  songs,
  systemSettings,
  users,
  votes
} from '~/drizzle/schema'
import { and, desc, eq, gte, inArray } from 'drizzle-orm'
import { sendBatchMeowNotifications, sendMeowNotificationToUser } from './meowNotificationService'
import { sendBatchEmailNotifications, sendEmailNotificationToUser } from './smtpService'
import { formatDateTime, getBeijingTime } from '~/utils/timeUtils'
import { executeRedisCommand, getRedisClient, isRedisReady } from '~~/server/utils/redis'

const VOTE_EXTERNAL_NOTIFICATION_COOLDOWN_SECONDS = 24 * 60 * 60
const voteNotificationCooldownMap = new Map<string, number>()

const buildVoteExternalNotificationCooldownKey = (requesterId: number, songId: number, voterId: number) =>
  `vote:notify:requester:${requesterId}:song:${songId}:voter:${voterId}`

const shouldSkipVoteExternalNotification = async (
  requesterId: number,
  songId: number,
  voterId: number
) => {
  const cooldownKey = buildVoteExternalNotificationCooldownKey(requesterId, songId, voterId)

  if (isRedisReady()) {
    const skipped = await executeRedisCommand(async () => {
      const client = getRedisClient()
      if (!client) return false

      const exists = await client.exists(cooldownKey)
      if (exists) {
        return true
      }

      await client.setEx(
        cooldownKey,
        VOTE_EXTERNAL_NOTIFICATION_COOLDOWN_SECONDS,
        String(Date.now())
      )
      return false
    })

    if (typeof skipped === 'boolean') {
      return skipped
    }
  }

  const now = Date.now()
  const expireAt = voteNotificationCooldownMap.get(cooldownKey) || 0
  if (expireAt > now) {
    return true
  }

  voteNotificationCooldownMap.set(
    cooldownKey,
    now + VOTE_EXTERNAL_NOTIFICATION_COOLDOWN_SECONDS * 1000
  )
  return false
}

/**
 * 创建歌曲被选中的通知
 */
export async function createSongSelectedNotification(
  userId: number,
  songId: number,
  songInfo: {
    title: string
    artist: string
    playDate: Date
  },
  ipAddress?: string
) {
  try {
    // 获取系统设置，检查是否启用播出时段功能
    const systemSettingsResult = await db.select().from(systemSettings).limit(1)
    const systemConfig = systemSettingsResult[0]
    const isPlayTimeEnabled = systemConfig?.enablePlayTimeSelection || false

    // 获取排期对应的播出时段
    const scheduleResult = await db
      .select({
        id: schedules.id,
        songId: schedules.songId,
        playDate: schedules.playDate,
        playTimeId: schedules.playTimeId,
        playTime: {
          id: playTimes.id,
          name: playTimes.name,
          startTime: playTimes.startTime,
          endTime: playTimes.endTime
        }
      })
      .from(schedules)
      .leftJoin(playTimes, eq(schedules.playTimeId, playTimes.id))
      .where(and(eq(schedules.songId, songId), eq(schedules.playDate, songInfo.playDate)))
      .limit(1)
    const schedule = scheduleResult[0]

    // 获取用户通知设置
    const settingsResult = await db
      .select()
      .from(notificationSettings)
      .where(eq(notificationSettings.userId, userId))
      .limit(1)
    const settings = settingsResult[0]

    // 如果用户关闭了此类通知，则不发送
    if (settings && !settings.enabled) {
      return null
    }

    // 创建通知，根据播出时段功能启用状态决定显示内容
    let message = `您投稿的歌曲《${songInfo.title}》已被安排播放，播放日期：${formatDate(songInfo.playDate)}。`

    // 只有在启用播出时段功能且有播出时段信息时，才添加播出时段详情
    if (isPlayTimeEnabled && schedule?.playTime) {
      let timeInfo = ''

      // 根据开始和结束时间的情况，格式化显示
      if (schedule.playTime.startTime && schedule.playTime.endTime) {
        timeInfo = `(${schedule.playTime.startTime}-${schedule.playTime.endTime})`
      } else if (schedule.playTime.startTime) {
        timeInfo = `(开始时间：${schedule.playTime.startTime})`
      } else if (schedule.playTime.endTime) {
        timeInfo = `(结束时间：${schedule.playTime.endTime})`
      }

      message += `播出时段：${schedule.playTime.name}${timeInfo ? ' ' + timeInfo : ''}。`
    }

    const notificationResult = await db
      .insert(notifications)
      .values({
        userId,
        type: 'SONG_SELECTED',
        message,
        songId
      })
      .returning()
    const notification = notificationResult[0]

    // 同步发送 MeoW 通知
    try {
      await sendMeowNotificationToUser(userId, '收到新选中', message)
    } catch (error) {
      console.error('发送 MeoW 通知失败:', error)
    }

    // 同步发送 邮件通知
    try {
      await sendEmailNotificationToUser(
        userId,
        '歌曲被选中',
        message,
        ipAddress,
        'notification.songSelected',
        {
          songTitle: songInfo.title,
          playDate: formatDate(songInfo.playDate),
          playTimeName: isPlayTimeEnabled && schedule?.playTime ? schedule.playTime.name : '',
          playTimeRange:
            isPlayTimeEnabled &&
            schedule?.playTime &&
            (schedule.playTime.startTime || schedule.playTime.endTime)
              ? `${schedule.playTime.startTime || ''}${schedule.playTime.startTime && schedule.playTime.endTime ? '-' : ''}${schedule.playTime.endTime || ''}`
              : ''
        }
      )
    } catch (error) {
      console.error('发送邮件通知失败:', error)
    }

    return notification
  } catch (err) {
    return null
  }
}

// 格式化日期为 yyyy-MM-dd 格式（北京时间）
function formatDate(date: Date): string {
  return formatDateTime(date, 'YYYY-MM-DD')
}

const buildCommentExcerpt = (content: string, maxLength = 48) => {
  const normalized = String(content || '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized) {
    return '（无内容）'
  }

  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized
}

/**
 * 创建评论与回复通知
 */
export async function createSongCommentNotification(
  params: {
    songId: number
    songTitle: string
    songOwnerId: number
    commenterId: number
    commenterName: string
    commentContent: string
    parentCommentId?: number | null
    parentCommentOwnerId?: number | null
  },
  ipAddress?: string
) {
  const {
    songId,
    songTitle,
    songOwnerId,
    commenterId,
    commenterName,
    commentContent,
    parentCommentId,
    parentCommentOwnerId
  } = params

  const createdNotifications = []
  const commentExcerpt = buildCommentExcerpt(commentContent)
  const isReply = Boolean(parentCommentId)

  try {
    if (songOwnerId !== commenterId) {
      const ownerSettingsResult = await db
        .select()
        .from(notificationSettings)
        .where(eq(notificationSettings.userId, songOwnerId))
        .limit(1)
      const ownerSettings = ownerSettingsResult[0]
      const ownerAllowsNotification =
        !ownerSettings ||
        (ownerSettings.enabled && (ownerSettings.songCommentEnabled ?? true))

      if (ownerAllowsNotification) {
        const ownerMessage = isReply
          ? `您的歌曲《${songTitle}》收到了来自 ${commenterName} 的新回复：${commentExcerpt}`
          : `您的歌曲《${songTitle}》收到了来自 ${commenterName} 的新评论：${commentExcerpt}`

        const ownerNotificationResult = await db
          .insert(notifications)
          .values({
            userId: songOwnerId,
            type: 'SONG_COMMENTED',
            message: ownerMessage,
            songId
          })
          .returning()

        createdNotifications.push(ownerNotificationResult[0])

        try {
          await sendMeowNotificationToUser(songOwnerId, isReply ? '收到歌曲回复' : '收到歌曲评论', ownerMessage)
        } catch (error) {
          console.error('发送歌曲评论 MeoW 通知失败:', error)
        }

        try {
          await sendEmailNotificationToUser(
            songOwnerId,
            isReply ? '收到歌曲回复' : '收到歌曲评论',
            ownerMessage,
            undefined,
            'notification.generic',
            {
              title: isReply ? '收到歌曲回复' : '收到歌曲评论',
              message: ownerMessage
            },
            ipAddress
          )
        } catch (error) {
          console.error('发送歌曲评论邮件通知失败:', error)
        }
      }
    }

    if (
      isReply &&
      parentCommentOwnerId &&
      parentCommentOwnerId !== commenterId &&
      parentCommentOwnerId !== songOwnerId
    ) {
      const replyTargetSettingsResult = await db
        .select()
        .from(notificationSettings)
        .where(eq(notificationSettings.userId, parentCommentOwnerId))
        .limit(1)
      const replyTargetSettings = replyTargetSettingsResult[0]
      const replyTargetAllowsNotification =
        !replyTargetSettings ||
        (replyTargetSettings.enabled && (replyTargetSettings.songCommentEnabled ?? true))

      if (replyTargetAllowsNotification) {
        const replyMessage = `${commenterName} 回复了您在《${songTitle}》下的评论：${commentExcerpt}`

        const replyNotificationResult = await db
          .insert(notifications)
          .values({
            userId: parentCommentOwnerId,
            type: 'SONG_COMMENT_REPLIED',
            message: replyMessage,
            songId
          })
          .returning()

        createdNotifications.push(replyNotificationResult[0])

        try {
          await sendMeowNotificationToUser(parentCommentOwnerId, '评论收到回复', replyMessage)
        } catch (error) {
          console.error('发送评论回复 MeoW 通知失败:', error)
        }

        try {
          await sendEmailNotificationToUser(
            parentCommentOwnerId,
            '评论收到回复',
            replyMessage,
            undefined,
            'notification.generic',
            {
              title: '评论收到回复',
              message: replyMessage
            },
            ipAddress
          )
        } catch (error) {
          console.error('发送评论回复邮件通知失败:', error)
        }
      }
    }
  } catch (error) {
    console.error('创建评论通知失败:', error)
  }

  return createdNotifications
}

/**
 * 创建歌曲已播放的通知
 */
export async function createSongPlayedNotification(songId: number, ipAddress?: string) {
  try {
    // 获取歌曲信息
    const songResult = await db.select().from(songs).where(eq(songs.id, songId)).limit(1)
    const song = songResult[0]

    if (!song) {
      return null
    }

    // 获取用户通知设置
    const settingsResult = await db
      .select()
      .from(notificationSettings)
      .where(eq(notificationSettings.userId, song.requesterId))
      .limit(1)
    const settings = settingsResult[0]

    // 如果用户关闭了此类通知，则不发送
    if (settings && !settings.songPlayedEnabled) {
      return null
    }

    // 创建通知
    const message = `您投稿的歌曲《${song.title}》已播放。`
    const notificationResult = await db
      .insert(notifications)
      .values({
        userId: song.requesterId,
        type: 'SONG_PLAYED',
        message,
        songId: songId
      })
      .returning()

    // 同步发送 MeoW 通知
    try {
      await sendMeowNotificationToUser(song.requesterId, '歌曲已播放', message)
    } catch (error) {
      console.error(`发送 MeoW 通知失败 (User: ${song.requesterId}):`, error)
    }

    // 同步发送 邮件通知
    try {
      await sendEmailNotificationToUser(
        song.requesterId,
        '歌曲已播放',
        message,
        ipAddress,
        'notification.songPlayed',
        { songTitle: song.title }
      )
    } catch (error) {
      console.error(`发送邮件通知失败 (User: ${song.requesterId}):`, error)
    }

    return notificationResult[0]
  } catch (err) {
    return null
  }
}

/**
 * 创建歌曲获得投票的通知
 */
export async function createSongVotedNotification(
  songId: number,
  voterId: number,
  ipAddress?: string
) {
  try {
    // 获取歌曲信息
    const songResult = await db.select().from(songs).where(eq(songs.id, songId)).limit(1)
    const song = songResult[0]

    if (!song) {
      return null
    }

    // 获取歌曲的投票信息
    const songVotes = await db.select().from(votes).where(eq(votes.songId, songId))

    // 获取投票用户信息
    const voterResult = await db.select().from(users).where(eq(users.id, voterId)).limit(1)
    const voter = voterResult[0]

    if (!voter) {
      return null
    }

    // 获取用户通知设置
    const settingsResult = await db
      .select()
      .from(notificationSettings)
      .where(eq(notificationSettings.userId, song.requesterId))
      .limit(1)
    const settings = settingsResult[0]

    // 如果用户关闭了此类通知，则不发送
    if (settings && !settings.songVotedEnabled) {
      return null
    }

    // 不要给自己投票发通知
    if (song.requesterId === voterId) {
      return null
    }

    // 检查投票阈值
    const threshold = settings?.songVotedThreshold || 1
    if (songVotes.length % threshold !== 0) {
      return null
    }

    const message = `您投稿的歌曲《${song.title}》获得了一个新的投票，当前共有 ${songVotes.length} 个投票。`

    const extractVotesCountFromMessage = (text: string) => {
      const match = text.match(/当前共有\s*(\d+)\s*个投票/)
      if (!match) return null
      const parsed = Number.parseInt(match[1], 10)
      return Number.isFinite(parsed) ? parsed : null
    }

    // 全局去重：如果最新一条通知的票数与当前一致，说明只是重复点赞/取消回摆，直接跳过
    const latestNotificationResult = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, song.requesterId),
          eq(notifications.type, 'SONG_VOTED'),
          eq(notifications.songId, songId)
        )
      )
      .orderBy(desc(notifications.createdAt))
      .limit(1)
    const latestNotification = latestNotificationResult[0]
    const latestVotesCount = latestNotification
      ? extractVotesCountFromMessage(latestNotification.message)
      : null
    if (latestVotesCount === songVotes.length) {
      return latestNotification
    }

    // 防重复通知：检查最近5分钟内是否有相同歌曲的投票通知
    const fiveMinutesAgo = new Date(getBeijingTime().getTime() - 5 * 60 * 1000)

    const existingNotificationResult = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, song.requesterId),
          eq(notifications.type, 'SONG_VOTED'),
          eq(notifications.songId, songId),
          eq(notifications.read, false),
          gte(notifications.createdAt, fiveMinutesAgo)
        )
      )
      .orderBy(desc(notifications.createdAt))
      .limit(1)
    const existingNotification = existingNotificationResult[0]

    let notification
    if (existingNotification) {
      // 更新现有通知
      const updateResult = await db
        .update(notifications)
        .set({
          message
        })
        .where(eq(notifications.id, existingNotification.id))
        .returning()
      notification = updateResult[0]
    } else {
      // 创建新通知
      const createResult = await db
        .insert(notifications)
        .values({
          userId: song.requesterId,
          type: 'SONG_VOTED',
          message,
          songId: songId
        })
        .returning()
      notification = createResult[0]
      // 仅在新建通知时尝试发送外部通知；且同一投票人对同一歌曲设置冷却，避免反复投票/取消导致邮件轰炸
      const shouldSkipExternal = await shouldSkipVoteExternalNotification(
        song.requesterId,
        songId,
        voterId
      )

      if (!shouldSkipExternal) {
        try {
          await sendMeowNotificationToUser(song.requesterId, '收到新投票', message)
        } catch (error) {
          console.error('发送 MeoW 通知失败:', error)
        }

        try {
          await sendEmailNotificationToUser(
            song.requesterId,
            '收到新投票',
            message,
            ipAddress,
            'notification.songVoted',
            { songTitle: song.title, votesCount: songVotes.length }
          )
        } catch (error) {
          console.error('发送邮件通知失败:', error)
        }
      }
    }

    return notification
  } catch (err) {
    return null
  }
}

/**
 * 创建歌曲驳回通知
 */
export async function createSongRejectedNotification(
  userId: number,
  songInfo: { title: string; artist: string },
  reason: string,
  ipAddress?: string
) {
  try {
    // 获取用户通知设置
    const settingsResult = await db
      .select()
      .from(notificationSettings)
      .where(eq(notificationSettings.userId, userId))
      .limit(1)
    const settings = settingsResult[0]

    // 如果用户关闭了通知，则不发送
    if (settings && !settings.enabled) {
      return null
    }

    // 创建通知消息
    const message = `您投稿的歌曲《${songInfo.title} - ${songInfo.artist}》已被管理员驳回。驳回原因：${reason}`

    // 创建站内通知
    const notificationResult = await db
      .insert(notifications)
      .values({
        userId,
        type: 'SONG_REJECTED',
        message
      })
      .returning()
    const notification = notificationResult[0]

    // 同步发送 MeoW 通知
    try {
      await sendMeowNotificationToUser(userId, '歌曲被驳回', message)
    } catch (error) {
      console.error('发送 MeoW 通知失败:', error)
    }

    // 同步发送邮件通知
    try {
      await sendEmailNotificationToUser(
        userId,
        '歌曲被驳回',
        message,
        ipAddress,
        'notification.songRejected',
        {
          songTitle: songInfo.title,
          songArtist: songInfo.artist,
          reason: reason
        }
      )
    } catch (error) {
      console.error('发送邮件通知失败:', error)
    }

    return notification
  } catch (err) {
    console.error('创建歌曲驳回通知失败:', err)
    return null
  }
}

/**
 * 创建系统通知
 */
export async function createSystemNotification(
  userId: number,
  title: string,
  content: string,
  ipAddress?: string
) {
  try {
    // 获取用户通知设置
    const settingsResult = await db
      .select()
      .from(notificationSettings)
      .where(eq(notificationSettings.userId, userId))
      .limit(1)
    const settings = settingsResult[0]

    // 如果用户关闭了通知，则不发送
    if (settings && !settings.enabled) {
      return null
    }

    // 创建通知
    const notificationResult = await db
      .insert(notifications)
      .values({
        userId: userId,
        type: 'SYSTEM_NOTICE',
        message: content
      })
      .returning()
    const notification = notificationResult[0]

    // 同步发送 MeoW 通知
    try {
      await sendMeowNotificationToUser(userId, title, content)
    } catch (error) {
      console.error('发送 MeoW 通知失败:', error)
    }

    // 同步发送邮件通知
    try {
      await sendEmailNotificationToUser(
        userId,
        title,
        content,
        undefined,
        undefined,
        undefined,
        ipAddress
      )
    } catch (error) {
      console.error('发送邮件通知失败:', error)
    }

    return notification
  } catch (err) {
    return null
  }
}

/**
 * 批量创建系统通知
 */
export async function createBatchSystemNotifications(
  userIds: number[],
  title: string,
  content: string,
  ipAddress?: string
) {
  try {
    if (!userIds.length) {
      return []
    }

    // 获取用户通知设置
    const userSettings = await db
      .select()
      .from(notificationSettings)
      .where(inArray(notificationSettings.userId, userIds))

    // 构建用户ID到通知设置的映射
    const settingsMap = new Map()
    userSettings.forEach((setting) => {
      settingsMap.set(setting.userId, setting)
    })

    // 准备要创建的通知数据
    const notificationsToCreate = []

    for (const userId of userIds) {
      const settings = settingsMap.get(userId)

      // 如果用户关闭了通知，则不发送
      if (settings && !settings.enabled) {
        continue
      }

      notificationsToCreate.push({
        userId,
        type: 'SYSTEM_NOTICE',
        message: content
      })
    }

    // 如果没有可发送的通知，直接返回
    if (notificationsToCreate.length === 0) {
      return []
    }

    // 批量创建通知
    const createdNotifications = await db
      .insert(notifications)
      .values(notificationsToCreate)
      .returning()
    const notificationCount = { count: createdNotifications.length }

    // 同步发送 MeoW 通知
    let meowResults = { success: 0, failed: 0 }
    try {
      meowResults = await sendBatchMeowNotifications(userIds, title, content)
    } catch (error) {
      console.error('批量发送 MeoW 通知失败:', error)
    }

    // 同步发送邮件通知
    let emailResults = { success: 0, failed: 0 }
    try {
      emailResults = await sendBatchEmailNotifications(
        userIds,
        title,
        content,
        undefined,
        undefined,
        ipAddress
      )
    } catch (error) {
      console.error('批量发送邮件通知失败:', error)
    }

    return {
      count: notificationCount.count,
      total: userIds.length,
      meowNotifications: meowResults,
      emailNotifications: emailResults
    }
  } catch (err) {
    return null
  }
}

/**
 * 创建重播申请拒绝通知
 */
export async function createReplayRequestRejectedNotification(
  userId: number,
  songInfo: { title: string; artist: string },
  ipAddress?: string
) {
  try {
    // 获取用户通知设置
    const settingsResult = await db
      .select()
      .from(notificationSettings)
      .where(eq(notificationSettings.userId, userId))
      .limit(1)
    const settings = settingsResult[0]

    // 如果用户关闭了通知，则不发送
    if (settings && !settings.enabled) {
      return null
    }

    // 创建通知消息
    const message = `您的重播申请《${songInfo.title}》已被管理员拒绝。`

    // 创建站内通知
    const notificationResult = await db
      .insert(notifications)
      .values({
        userId,
        type: 'REPLAY_REJECTED',
        message
      })
      .returning()
    const notification = notificationResult[0]

    // 同步发送 MeoW 通知
    try {
      await sendMeowNotificationToUser(userId, '重播申请已拒绝', message)
    } catch (error) {
      console.error('发送 MeoW 通知失败:', error)
    }

    // 同步发送邮件通知
    try {
      await sendEmailNotificationToUser(userId, '重播申请已拒绝', message, ipAddress)
    } catch (error) {
      console.error('发送邮件通知失败:', error)
    }

    return notification
  } catch (err) {
    console.error('创建重播申请拒绝通知失败:', err)
    return null
  }
}
