import { createError, getRequestHeader, type H3Event } from 'h3'
import { and, eq, sql } from 'drizzle-orm'
import { db, userIdentities, users } from '~/drizzle/db'
import { normalizeRoleOrDefault } from '~~/server/utils/role'

const CPU_WEB_PROVIDER = 'cpu-web'
const DEFAULT_CPU_WEB_ORIGIN = 'http://127.0.0.1:3000'

interface CpuWebUser {
  id: number
  username: string
  nickname?: string | null
  avatar?: string | null
  email?: string | null
  college?: string | null
  enrollYear?: number | null
  role?: string | null
  studentSso?: boolean
}

interface CpuWebEnvelope<T> {
  code: number
  data: T
  message?: string
}

function cpuWebOrigin() {
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

function voiceHubRole(role?: string | null) {
  if (role === 'admin') return 'SUPER_ADMIN'
  if (role === 'mod') return 'SONG_ADMIN'
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
      role: voiceHubRole(cpuUser.role),
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
        role: voiceHubRole(cpuUser.role),
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

export async function resolveCpuWebAuth(event: H3Event) {
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
    role: normalizeRoleOrDefault(voiceHubRole(cpuUser.role), 'USER'),
    forcePasswordChange: false,
    requirePasswordChange: false,
    passwordChangedAt: null,
    has2FA: false,
    cpuWebUserId: cpuUser.id
  }
}
