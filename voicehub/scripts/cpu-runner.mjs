#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { config as loadEnv } from 'dotenv'

const voiceHubDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const workspaceDir = path.resolve(voiceHubDir, '..')
const serverEnv = path.join(workspaceDir, 'server', '.env')
if (existsSync(serverEnv)) loadEnv({ path: serverEnv, override: false })

const action = process.argv[2] || 'dev'
const voiceHubDatabaseUrl = String(process.env.VOICEHUB_DATABASE_URL || '').trim()
if (action !== 'build' && !voiceHubDatabaseUrl) {
  console.error('缺少 VOICEHUB_DATABASE_URL。请为药苑之声配置独立 PostgreSQL 数据库。')
  process.exit(1)
}

const sameDatabase = (left, right) => {
  if (!left || !right) return false
  try {
    const a = new URL(left)
    const b = new URL(right)
    return a.hostname === b.hostname
      && (a.port || '5432') === (b.port || '5432')
      && a.pathname.replace(/\/+$/, '') === b.pathname.replace(/\/+$/, '')
  } catch {
    return false
  }
}

if (voiceHubDatabaseUrl && sameDatabase(voiceHubDatabaseUrl, process.env.DATABASE_URL)) {
  console.error('VOICEHUB_DATABASE_URL 不能和 CPU-web 的 DATABASE_URL 指向同一个数据库。')
  process.exit(1)
}

const port = String(process.env.VOICEHUB_PORT || '3001')
const cpuPort = String(process.env.PORT || '3000')
const env = {
  ...process.env,
  DATABASE_URL: voiceHubDatabaseUrl || process.env.DATABASE_URL || 'postgresql://build:build@127.0.0.1:5432/build',
  CPU_WEB_ORIGIN: process.env.CPU_WEB_ORIGIN || `http://127.0.0.1:${cpuPort}`,
  VOICEHUB_INTEGRATION_SECRET: process.env.VOICEHUB_INTEGRATION_SECRET || '',
  NUXT_APP_BASE_URL: '/voicehub/',
  NUXT_PUBLIC_API_BASE: '/voicehub/api',
  NUXT_PUBLIC_SITE_TITLE: process.env.NUXT_PUBLIC_SITE_TITLE || '药苑之声',
  NUXT_PUBLIC_SITE_DESCRIPTION: process.env.NUXT_PUBLIC_SITE_DESCRIPTION || '中国药科大学广播站点歌与播出平台',
  NITRO_HOST: process.env.NITRO_HOST || '127.0.0.1',
  NITRO_PORT: port
}

const drizzleCli = path.join(voiceHubDir, 'node_modules', 'drizzle-kit', 'bin.cjs')
const schemaValidator = path.join(voiceHubDir, 'scripts', 'validate-cpu-auth-schema.mjs')

function validateCpuAuthSchema() {
  const validation = spawnSync(process.execPath, [schemaValidator], {
    cwd: voiceHubDir,
    env,
    stdio: 'inherit'
  })
  if (validation.error) throw validation.error
  if (validation.status !== 0) {
    console.error('[voicehub] 认证表结构不完整，已中止启动。')
    process.exit(validation.status || 1)
  }
}

function migrateBeforeStart(force = false) {
  if (!force && process.env.VOICEHUB_AUTO_MIGRATE === 'false') return
  console.log('[voicehub] 正在检查独立数据库迁移...')
  const migration = spawnSync(process.execPath, [drizzleCli, 'migrate'], {
    cwd: voiceHubDir,
    env,
    stdio: 'inherit'
  })
  if (migration.error) throw migration.error
  if (migration.status !== 0) {
    console.error('[voicehub] 数据库迁移失败，已中止启动，避免以损坏状态提供服务。')
    process.exit(migration.status || 1)
  }
  validateCpuAuthSchema()
}

if (action === 'dev' || action === 'start') migrateBeforeStart()

if (action === 'migrate') {
  migrateBeforeStart(true)
  process.exit(0)
}

let executable = process.execPath
let args = []
if (action === 'start') {
  args = [path.join(voiceHubDir, '.output', 'server', 'index.mjs')]
} else {
  const nuxtCli = path.join(voiceHubDir, 'node_modules', 'nuxt', 'bin', 'nuxt.mjs')
  args = [nuxtCli, action]
  if (action === 'dev') args.push('--host', '127.0.0.1', '--port', port)
}

const child = spawn(executable, args, { cwd: voiceHubDir, env, stdio: 'inherit' })
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 1)
})
