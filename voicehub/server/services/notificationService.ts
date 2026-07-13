import { and, eq, inArray } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { playTimes, schedules, songs, userIdentities, users, votes } from '~/drizzle/schema'
import { executeRedisCommand, getRedisClient, isRedisReady } from '~~/server/utils/redis'
import { formatDateTime } from '~/utils/timeUtils'

const CPU_WEB_PROVIDER = 'cpu-web'
const DEFAULT_CPU_WEB_ORIGIN = 'http://127.0.0.1:3000'
const VOTE_NOTIFICATION_COOLDOWN_SECONDS = 24 * 60 * 60
const voteNotificationCooldownMap = new Map<string, number>()

type MainSiteNotification = {
  voiceHubUserId: number
  title: string
  content: string
  type: string
  songId?: number
  level?: 'strong' | 'normal' | 'weak'
}

function cpuWebOrigin() {
  const raw = String(process.env.CPU_WEB_ORIGIN || DEFAULT_CPU_WEB_ORIGIN).trim()
  const parsed = new URL(raw)
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('CPU_WEB_ORIGIN 只支持 http 或 https')
  }
  return parsed.toString().replace(/\/$/, '')
}

async function resolveMainSiteUserIds(voiceHubUserIds: number[]) {
  if (!voiceHubUserIds.length) return new Map<number, number>()
  const rows = await db
    .select({
      voiceHubUserId: userIdentities.userId,
      providerUserId: userIdentities.providerUserId
    })
    .from(userIdentities)
    .where(and(
      eq(userIdentities.provider, CPU_WEB_PROVIDER),
      inArray(userIdentities.userId, [...new Set(voiceHubUserIds)])
    ))

  const result = new Map<number, number>()
  for (const row of rows) {
    const mainSiteUserId = Number(row.providerUserId)
    if (Number.isInteger(mainSiteUserId) && mainSiteUserId > 0) {
      result.set(row.voiceHubUserId, mainSiteUserId)
    }
  }
  return result
}

async function sendMainSiteNotifications(items: MainSiteNotification[]) {
  if (!items.length) return { count: 0, total: 0 }

  const secret = String(process.env.VOICEHUB_INTEGRATION_SECRET || '').trim()
  if (secret.length < 32) {
    console.error('[voicehub] 未配置有效的 VOICEHUB_INTEGRATION_SECRET，通知未发送')
    return null
  }

  const userIdMap = await resolveMainSiteUserIds(items.map((item) => item.voiceHubUserId))
  const notifications = items.flatMap((item) => {
    const userId = userIdMap.get(item.voiceHubUserId)
    if (!userId) return []
    return [{
      userId,
      title: item.title,
      content: item.content,
      type: item.type,
      ...(item.songId ? { songId: item.songId } : {}),
      ...(item.level ? { level: item.level } : {})
    }]
  })

  if (!notifications.length) {
    console.warn('[voicehub] 通知接收者尚未建立主站用户映射，已跳过')
    return { count: 0, total: items.length }
  }

  try {
    const response = await fetch(`${cpuWebOrigin()}/api/integrations/voicehub/notifications`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-voicehub-integration-secret': secret
      },
      body: JSON.stringify({ notifications }),
      signal: AbortSignal.timeout(8000)
    })
    const payload = await response.json().catch(() => null) as {
      code?: number
      data?: { count?: number; skipped?: number }
      message?: string
    } | null
    if (!response.ok || payload?.code !== 0) {
      throw new Error(payload?.message || `主站通知接口返回 ${response.status}`)
    }
    return {
      count: Number(payload.data?.count || 0),
      total: items.length,
      skipped: Number(payload.data?.skipped || 0)
    }
  } catch (error) {
    console.error('[voicehub] 发送主站通知失败:', error)
    return null
  }
}

function formatDate(date: Date) {
  return formatDateTime(date, 'YYYY-MM-DD')
}

function commentExcerpt(content: string, maxLength = 48) {
  const normalized = String(content || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return '（无内容）'
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized
}

async function shouldSkipVoteNotification(requesterId: number, songId: number, voterId: number) {
  const key = `vote:notify:requester:${requesterId}:song:${songId}:voter:${voterId}`
  if (isRedisReady()) {
    const skipped = await executeRedisCommand(async () => {
      const client = getRedisClient()
      if (!client) return false
      if (await client.exists(key)) return true
      await client.setEx(key, VOTE_NOTIFICATION_COOLDOWN_SECONDS, String(Date.now()))
      return false
    })
    if (typeof skipped === 'boolean') return skipped
  }

  const now = Date.now()
  if ((voteNotificationCooldownMap.get(key) || 0) > now) return true
  voteNotificationCooldownMap.set(key, now + VOTE_NOTIFICATION_COOLDOWN_SECONDS * 1000)
  return false
}

export async function createSongSelectedNotification(
  userId: number,
  songId: number,
  songInfo: { title: string; artist: string; playDate: Date },
  _ipAddress?: string
) {
  let content = `您投稿的歌曲《${songInfo.title}》已安排播放，日期：${formatDate(songInfo.playDate)}。`
  const schedule = await db
    .select({
      playTimeName: playTimes.name,
      startTime: playTimes.startTime,
      endTime: playTimes.endTime
    })
    .from(schedules)
    .leftJoin(playTimes, eq(schedules.playTimeId, playTimes.id))
    .where(and(eq(schedules.songId, songId), eq(schedules.playDate, songInfo.playDate)))
    .limit(1)
  if (schedule[0]?.playTimeName) {
    const range = [schedule[0].startTime, schedule[0].endTime].filter(Boolean).join('-')
    content += ` 播出时段：${schedule[0].playTimeName}${range ? `（${range}）` : ''}。`
  }
  return sendMainSiteNotifications([{ voiceHubUserId: userId, title: '歌曲已入选', content, type: 'SONG_SELECTED', songId, level: 'strong' }])
}

export async function createSongCommentNotification(params: {
  songId: number
  songTitle: string
  songOwnerId: number
  commenterId: number
  commenterName: string
  commentContent: string
  parentCommentId?: number | null
  parentCommentOwnerId?: number | null
}, _ipAddress?: string) {
  const items: MainSiteNotification[] = []
  const excerpt = commentExcerpt(params.commentContent)
  const isReply = Boolean(params.parentCommentId)
  if (params.songOwnerId !== params.commenterId) {
    items.push({
      voiceHubUserId: params.songOwnerId,
      title: isReply ? '歌曲收到新回复' : '歌曲收到新评论',
      content: `您的歌曲《${params.songTitle}》收到来自 ${params.commenterName} 的${isReply ? '回复' : '评论'}：${excerpt}`,
      type: 'SONG_COMMENTED',
      songId: params.songId
    })
  }
  if (isReply && params.parentCommentOwnerId && params.parentCommentOwnerId !== params.commenterId && params.parentCommentOwnerId !== params.songOwnerId) {
    items.push({
      voiceHubUserId: params.parentCommentOwnerId,
      title: '评论收到回复',
      content: `${params.commenterName} 回复了您在《${params.songTitle}》下的评论：${excerpt}`,
      type: 'SONG_COMMENT_REPLIED',
      songId: params.songId
    })
  }
  return sendMainSiteNotifications(items)
}

export async function createSongPlayedNotification(songId: number, _ipAddress?: string) {
  const song = (await db.select().from(songs).where(eq(songs.id, songId)).limit(1))[0]
  if (!song) return null
  return sendMainSiteNotifications([{
    voiceHubUserId: song.requesterId,
    title: '歌曲已播放',
    content: `您投稿的歌曲《${song.title}》已播放。`,
    type: 'SONG_PLAYED',
    songId
  }])
}

export async function createSongVotedNotification(songId: number, voterId: number, _ipAddress?: string) {
  const song = (await db.select().from(songs).where(eq(songs.id, songId)).limit(1))[0]
  if (!song || song.requesterId === voterId) return null
  if (await shouldSkipVoteNotification(song.requesterId, songId, voterId)) return null
  const [songVotes, voter] = await Promise.all([
    db.select({ id: votes.id }).from(votes).where(eq(votes.songId, songId)),
    db.select({ name: users.name }).from(users).where(eq(users.id, voterId)).limit(1)
  ])
  if (!voter[0]) return null
  return sendMainSiteNotifications([{
    voiceHubUserId: song.requesterId,
    title: '歌曲收到新投票',
    content: `您的歌曲《${song.title}》获得了新投票，当前共 ${songVotes.length} 票。`,
    type: 'SONG_VOTED',
    songId
  }])
}

export async function createSongRejectedNotification(
  userId: number,
  songInfo: { title: string; artist: string },
  reason: string,
  _ipAddress?: string
) {
  return sendMainSiteNotifications([{
    voiceHubUserId: userId,
    title: '歌曲未通过审核',
    content: `您投稿的歌曲《${songInfo.title} - ${songInfo.artist}》未通过审核。原因：${reason}`,
    type: 'SONG_REJECTED',
    level: 'strong'
  }])
}

export async function createSystemNotification(
  userId: number,
  title: string,
  content: string,
  _ipAddress?: string
) {
  return sendMainSiteNotifications([{
    voiceHubUserId: userId,
    title,
    content,
    type: 'SYSTEM_NOTICE'
  }])
}

export async function createBatchSystemNotifications(
  userIds: number[],
  title: string,
  content: string,
  _ipAddress?: string
) {
  return sendMainSiteNotifications(userIds.map((voiceHubUserId) => ({
    voiceHubUserId,
    title,
    content,
    type: 'SYSTEM_NOTICE'
  })))
}

export async function createReplayRequestRejectedNotification(
  userId: number,
  songInfo: { title: string; artist: string },
  _ipAddress?: string
) {
  return sendMainSiteNotifications([{
    voiceHubUserId: userId,
    title: '重播申请未通过',
    content: `您对《${songInfo.title}》的重播申请未通过。`,
    type: 'REPLAY_REJECTED'
  }])
}
