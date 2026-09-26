import { randomUUID } from 'node:crypto'
import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import * as s from '~/drizzle/schema'
import { cpuWebOrigin, invalidateCpuWebAuthCache } from '~~/server/utils/cpu-web-auth'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  if (!/^[A-Za-z0-9_-]{43}$/.test(String(body?.receipt || '')) || typeof body?.jobId !== 'string') {
    throw createError({ statusCode: 400, message: '无效删除回执' })
  }
  const response = await fetch(`${cpuWebOrigin()}/api/privacy/account-deletion/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId: body.jobId, receipt: body.receipt }),
    redirect: 'error', signal: AbortSignal.timeout(10_000)
  })
  const proof = await response.json() as { code: number; data?: { userId: number; username: string; jobId: string } }
  if (!response.ok || proof.code !== 0 || proof.data?.jobId !== body.jobId || !proof.data.userId) {
    throw createError({ statusCode: 403, message: '删除请求未通过本站验证' })
  }
  const subject = proof.data
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cpu-web:${subject.userId}`}))`)
    const identities = await tx.select().from(s.userIdentities).where(and(eq(s.userIdentities.provider, 'cpu-web'), eq(s.userIdentities.providerUserId, String(subject.userId))))
    if (!identities.length) return
    const id = identities[0].userId
    const keys = await tx.select({ id: s.apiKeys.id }).from(s.apiKeys).where(eq(s.apiKeys.createdByUserId, id))
    if (keys.length) {
      const ids = keys.map((key) => key.id)
      await tx.delete(s.apiLogs).where(inArray(s.apiLogs.apiKeyId, ids))
      await tx.delete(s.apiKeyPermissions).where(inArray(s.apiKeyPermissions.apiKeyId, ids))
      await tx.delete(s.apiKeys).where(inArray(s.apiKeys.id, ids))
    }
    const collaborations = await tx.select({ id: s.songCollaborators.id }).from(s.songCollaborators).where(eq(s.songCollaborators.userId, id))
    await tx.delete(s.collaborationLogs).where(or(eq(s.collaborationLogs.operatorId, id), ...(collaborations.length ? [inArray(s.collaborationLogs.collaboratorId, collaborations.map((row) => row.id))] : [])))
    await tx.delete(s.songCollaborators).where(eq(s.songCollaborators.userId, id))
    await tx.delete(s.songReplayRequests).where(eq(s.songReplayRequests.userId, id))
    await tx.delete(s.votes).where(eq(s.votes.userId, id))
    await tx.delete(s.notifications).where(eq(s.notifications.userId, id))
    await tx.delete(s.notificationSettings).where(eq(s.notificationSettings.userId, id))
    await tx.delete(s.userStatusLogs).where(or(eq(s.userStatusLogs.userId, id), eq(s.userStatusLogs.operatorId, id)))
    await tx.update(s.songComments).set({ content: '评论已删除', updatedAt: new Date() }).where(eq(s.songComments.userId, id))
    await tx.update(s.users).set({
      username: `deleted-${randomUUID()}`, name: '已删除用户', grade: null, class: null, avatar: null,
      role: 'USER', password: `$deleted:${randomUUID()}`, email: null, emailVerified: false,
      lastLogin: null, lastLoginIp: null, passwordChangedAt: null, forcePasswordChange: false,
      meowNickname: null, meowBoundAt: null, status: 'withdrawn', statusChangedAt: new Date(), statusChangedBy: null
    }).where(eq(s.users.id, id))
    // Keep only the internal numeric mapping as a revocation tombstone against an in-flight session sync.
    await tx.delete(s.userIdentities).where(and(eq(s.userIdentities.userId, id), sql`${s.userIdentities.provider} <> 'cpu-web'`))
    await tx.update(s.userIdentities).set({ providerUsername: null }).where(eq(s.userIdentities.userId, id))
  })
  // 已缓存的会话身份立即失效，不必等缓存过期
  invalidateCpuWebAuthCache(subject.userId)
  setHeader(event, 'Cache-Control', 'no-store')
  return { deleted: true }
})
