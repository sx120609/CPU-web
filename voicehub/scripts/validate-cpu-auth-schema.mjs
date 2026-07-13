#!/usr/bin/env node

import postgres from 'postgres'

const databaseUrl = String(process.env.DATABASE_URL || '').trim()
if (!databaseUrl) {
  console.error('[voicehub] 无法校验认证表结构：缺少 DATABASE_URL')
  process.exit(1)
}

const requiredColumns = {
  User: [
    'id',
    'createdAt',
    'updatedAt',
    'username',
    'name',
    'grade',
    'class',
    'avatar',
    'role',
    'password',
    'email',
    'emailVerified',
    'lastLogin',
    'lastLoginIp',
    'passwordChangedAt',
    'forcePasswordChange',
    'meowNickname',
    'meowBoundAt',
    'status',
    'statusChangedAt',
    'statusChangedBy'
  ],
  UserIdentity: [
    'id',
    'userId',
    'provider',
    'providerUserId',
    'providerUsername',
    'createdAt'
  ]
}

let parsedUrl
try {
  parsedUrl = new URL(databaseUrl)
} catch {
  console.error('[voicehub] 无法校验认证表结构：DATABASE_URL 不是有效 URL')
  process.exit(1)
}

const needsSsl = parsedUrl.hostname.includes('neon.tech')
  || parsedUrl.hostname.includes('neon.database.com')
  || parsedUrl.searchParams.get('sslmode') === 'require'
  || parsedUrl.searchParams.get('ssl') === 'true'

const sql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  connect_timeout: 15,
  ssl: needsSsl ? 'require' : false
})

try {
  const rows = await sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name IN ('User', 'UserIdentity')
  `

  const actual = new Map()
  for (const row of rows) {
    const columns = actual.get(row.table_name) || new Set()
    columns.add(row.column_name)
    actual.set(row.table_name, columns)
  }

  const missing = []
  for (const [table, columns] of Object.entries(requiredColumns)) {
    const existing = actual.get(table) || new Set()
    for (const column of columns) {
      if (!existing.has(column)) missing.push(`${table}.${column}`)
    }
  }

  const enumRows = await sql`
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = current_schema() AND t.typname = 'user_status'
    LIMIT 1
  `
  if (!enumRows.length) missing.push('type public.user_status')

  if (missing.length) {
    throw new Error(`缺少认证所需数据库结构：${missing.join(', ')}`)
  }

  console.log('[voicehub] 认证表结构校验通过')
} catch (error) {
  console.error(`[voicehub] 认证表结构校验失败：${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  await sql.end({ timeout: 5 })
}
