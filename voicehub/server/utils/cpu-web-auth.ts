import { createHash } from 'node:crypto'
import { createError, getRequestHeader, type H3Event } from 'h3'
import { and, eq, sql } from 'drizzle-orm'
import { db, userIdentities, users } from '~/drizzle/db'
import { normalizeRoleOrDefault } from '~~/server/utils/role'

const CPU_WEB_PROVIDER = 'cpu-web'
const DEFAULT_CPU_WEB_ORIGIN = 'http://127.0.0.1:3000'

// 每个 /api 请求都会解析本站身份：按 Cookie 摘要做短时缓存并合并并发解析，
// 避免重复请求主站 /api/user/me 以及加锁同步影子用户的事务占满连接池。
const AUTH_CACHE_USER_TTL_MS = 30_000
const AUTH_CACHE_GUEST_TTL_MS = 10_000
const AUTH_CACHE_MAX_ENTRIES = 5000
const AUTH_CACHE_SWEEP_INTERVAL_MS = 60_000

interface CpuWebUser {
  id: number
  username: string
  nickname?: string | null
  avatar?: string | null
  email?: string | null
  college?: string | null
  enrollYear?: number | null
  role?: string | null
  voiceHubRole?: 'admin' | 'super_admin' | null
  lostFoundRole?: 'admin' | 'super_admin' | null
  studentSso?: boolean
}

interface CpuWebEnvelope<T> {
  code: number
  data: T
  message?: string
}

export function cpuWebOrigin() {
  const raw = String(process.env.CPU_WEB_ORIGIN || DEFAULT_CPU_WEB_ORIGIN).trim()
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('CPU_WEB_ORIGIN 必须是绝对 URL')
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('CPU_WEB_ORIGIN 只支持 http 或 https')
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('CPU_WEB_ORIGIN 不能包含账号、查询参数或锚点')
  }
  return parsed.toString().replace(/\/$/, '')
}

function voiceHubRole(user: Pick<CpuWebUser, 'role' | 'voiceHubRole'>) {
  if (user.role === 'admin' || user.voiceHubRole === 'super_admin') return 'SUPER_ADMIN'
  if (user.role === 'voicehub_admin' || user.voiceHubRole === 'admin') return 'ADMIN'
  if (user.role === 'mod') return 'SONG_ADMIN'
  return 'USER'
}

async function fetchCpuWebUser(event: H3Event): Promise<CpuWebUser | null> {
  const cookie = getRequestHeader(event, 'cookie') || ''
  if (!cookie) return null

  const response = await fetch(`${cpuWebOrigin()}/api/user/me`, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      cookie,
      'user-agent': getRequestHeader(event, 'user-agent') || 'VoiceHub CPU bridge'
    },
    redirect: 'manual',
    signal: AbortSignal.timeout(5000)
  })

  if (response.status === 401 || response.status === 403) return null
  if (!response.ok) {
    throw createError({
      statusCode: 502,
      message: `本站用户服务暂时不可用（${response.status}）`
    })
  }

  const payload = (await response.json()) as CpuWebEnvelope<CpuWebUser>
  if (payload?.code !== 0 || !payload.data?.id || !payload.data.username) {
    throw createError({ statusCode: 502, message: '本站用户服务返回了无效数据' })
  }
  return payload.data
}

async function findShadowUser(cpuUser: CpuWebUser, database: any = db) {
  const identity = await database
    .select({ userId: userIdentities.userId })
    .from(userIdentities)
    .where(and(
      eq(userIdentities.provider, CPU_WEB_PROVIDER),
      eq(userIdentities.providerUserId, String(cpuUser.id))
    ))
    .limit(1)

  if (identity[0]) {
    const linked = await database.select().from(users).where(eq(users.id, identity[0].userId)).limit(1)
    if (linked[0]) return linked[0]
  }

  const matchingUsername = await database
    .select()
    .from(users)
    .where(eq(users.username, cpuUser.username))
    .limit(1)
  if (matchingUsername[0]) return matchingUsername[0]

  const inserted = await database
    .insert(users)
    .values({
      username: cpuUser.username,
      name: cpuUser.nickname || cpuUser.username,
      grade: cpuUser.enrollYear ? `${cpuUser.enrollYear}级` : null,
      class: cpuUser.college || null,
      avatar: cpuUser.avatar || null,
      role: voiceHubRole(cpuUser),
      password: `$cpu-web-session:${cpuUser.id}`,
      email: cpuUser.email || null,
      emailVerified: Boolean(cpuUser.studentSso || cpuUser.email),
      forcePasswordChange: false,
      status: 'active'
    })
    .returning()
  return inserted[0]
}

async function syncShadowUser(cpuUser: CpuWebUser) {
  return db.transaction(async (tx) => {
    // 同一 CPU 用户首次并发打开多个 API 时只创建一个 VoiceHub 映射。
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${CPU_WEB_PROVIDER}:${cpuUser.id}`}))`)

    let shadow = await findShadowUser(cpuUser, tx)
    if (!shadow) {
      throw createError({ statusCode: 500, message: '无法建立药苑之声用户映射' })
    }
    if (shadow.status === 'withdrawn' && shadow.password.startsWith('$deleted:')) {
      throw createError({ statusCode: 401, message: '该账户已删除' })
    }

    await tx
      .insert(userIdentities)
      .values({
        userId: shadow.id,
        provider: CPU_WEB_PROVIDER,
        providerUserId: String(cpuUser.id),
        providerUsername: cpuUser.username
      })
      .onConflictDoNothing()

    const linkedIdentity = await tx
      .select({ userId: userIdentities.userId })
      .from(userIdentities)
      .where(and(
        eq(userIdentities.provider, CPU_WEB_PROVIDER),
        eq(userIdentities.providerUserId, String(cpuUser.id))
      ))
      .limit(1)

    if (linkedIdentity[0] && linkedIdentity[0].userId !== shadow.id) {
      const linked = await tx.select().from(users).where(eq(users.id, linkedIdentity[0].userId)).limit(1)
      if (linked[0]) shadow = linked[0]
    }

    const updated = await tx
      .update(users)
      .set({
        name: cpuUser.nickname || cpuUser.username,
        grade: cpuUser.enrollYear ? `${cpuUser.enrollYear}级` : null,
        class: cpuUser.college || null,
        avatar: cpuUser.avatar || null,
        role: voiceHubRole(cpuUser),
        email: cpuUser.email || null,
        emailVerified: Boolean(cpuUser.studentSso || cpuUser.email),
        forcePasswordChange: false,
        status: 'active',
        lastLogin: new Date(),
        updatedAt: new Date()
      })
      .where(eq(users.id, shadow.id))
      .returning()

    return updated[0] || shadow
  })
}

async function resolveCpuWebAuthUncached(event: H3Event) {
  const cpuUser = await fetchCpuWebUser(event)
  if (!cpuUser) return null
  const shadow = await syncShadowUser(cpuUser)
  return {
    id: shadow.id,
    username: shadow.username,
    name: shadow.name || cpuUser.nickname || cpuUser.username,
    grade: shadow.grade,
    class: shadow.class,
    avatar: shadow.avatar,
    email: shadow.email,
    role: normalizeRoleOrDefault(voiceHubRole(cpuUser), 'USER'),
    forcePasswordChange: false,
    requirePasswordChange: false,
    passwordChangedAt: null,
    has2FA: false,
    cpuWebUserId: cpuUser.id
  }
}

type CpuWebAuthResult = Awaited<ReturnType<typeof resolveCpuWebAuthUncached>>

const authCache = new Map<string, { value: CpuWebAuthResult; expiresAt: number }>()
const pendingAuth = new Map<string, Promise<CpuWebAuthResult>>()
let authCacheGeneration = 0
let lastAuthCacheSweepAt = 0

// 调用方可能修改 event.context.user，缓存中的对象只以副本形式返回（字段均为原始值）
const copyAuthResult = (value: CpuWebAuthResult): CpuWebAuthResult => (value ? { ...value } : null)

function storeAuthResult(key: string, value: CpuWebAuthResult) {
  const now = Date.now()
  if (now - lastAuthCacheSweepAt >= AUTH_CACHE_SWEEP_INTERVAL_MS) {
    lastAuthCacheSweepAt = now
    for (const [cachedKey, entry] of authCache) {
      if (entry.expiresAt <= now) authCache.delete(cachedKey)
    }
  }

  authCache.delete(key)
  authCache.set(key, {
    value,
    expiresAt: now + (value ? AUTH_CACHE_USER_TTL_MS : AUTH_CACHE_GUEST_TTL_MS)
  })

  // Map 按插入顺序迭代，超出上限时淘汰最早写入的条目
  while (authCache.size > AUTH_CACHE_MAX_ENTRIES) {
    const oldestKey = authCache.keys().next().value
    if (oldestKey === undefined) break
    authCache.delete(oldestKey)
  }
}

/** 使已缓存的身份失效；传入本站用户 ID 时只清除该用户，否则全部清除。 */
export function invalidateCpuWebAuthCache(cpuWebUserId?: number) {
  // 进行中的解析结果不再写入缓存也不再被复用，避免失效前发起的请求把旧身份写回
  authCacheGeneration++
  pendingAuth.clear()
  if (cpuWebUserId === undefined) {
    authCache.clear()
    return
  }
  for (const [key, entry] of authCache) {
    if (entry.value?.cpuWebUserId === cpuWebUserId) authCache.delete(key)
  }
}

export async function resolveCpuWebAuth(event: H3Event) {
  const cookie = getRequestHeader(event, 'cookie') || ''
  if (!cookie) return null

  const key = createHash('sha256').update(cookie).digest('hex')
  const cached = authCache.get(key)
  if (cached) {
    if (cached.expiresAt > Date.now()) return copyAuthResult(cached.value)
    authCache.delete(key)
  }

  let pending = pendingAuth.get(key)
  if (!pending) {
    const generation = authCacheGeneration
    // 只缓存成功结果（含未登录）；异常不缓存，下一次请求会重新解析
    const resolution: Promise<CpuWebAuthResult> = resolveCpuWebAuthUncached(event)
      .then((value) => {
        if (generation === authCacheGeneration) storeAuthResult(key, value)
        return value
      })
      .finally(() => {
        if (pendingAuth.get(key) === resolution) pendingAuth.delete(key)
      })
    pending = resolution
    pendingAuth.set(key, resolution)
  }

  return copyAuthResult(await pending)
}
