#!/usr/bin/env node
// Prebuilt server dependencies (server/node_modules with the generated Prisma client).
//
// The production host must never install npm packages: `npm ci` and `prisma generate` beside a live
// release pushed the 8 GiB host into a memory/IO stall that took every service down
// (2026-10-21, 2026-10-27, 2026-11-09). CI builds node_modules once per dependency key and ships it as
// a content-addressed release asset; the deploy extracts it once into a host store and hard-links it
// into every release that has the same key.
//
//   node server-modules.mjs key <server dir>                       print the dependency key
//   node server-modules.mjs pack <server dir> <output dir>         CI: build and pack node_modules
//   node server-modules.mjs manifest <manifest.json>               print "key file sha256 bytes" (empty without one)
//   node server-modules.mjs verify <manifest.json> <archive>       check an archive against the manifest
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, realpathSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sha256File } from './artifact-manifest.mjs'

export const SERVER_MODULES_PLATFORM = 'linux-x64'
export const SERVER_MODULES_MARKER = '.cpu-server-modules-key'
export const SERVER_MODULES_REQUIRED = ['.prisma/client/index.js', '@prisma/client/package.json', 'prisma/package.json', 'tsx/package.json']
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'overrides']

const text = async file => (existsSync(file) ? (await readFile(file, 'utf8')).replace(/\r\n/g, '\n') : null)

/** Everything that decides the contents of node_modules: dependency fields, lockfile, npm config and the Prisma schema. */
export async function serverModulesKey(serverDir) {
  const pkg = JSON.parse(await readFile(path.join(serverDir, 'package.json'), 'utf8'))
  const lock = await text(path.join(serverDir, 'package-lock.json'))
  if (!lock) throw new Error('server/package-lock.json is required for prebuilt dependencies')
  const input = {
    platform: SERVER_MODULES_PLATFORM,
    package: Object.fromEntries(DEPENDENCY_FIELDS.map(field => [field, pkg[field] ?? null])),
    lock,
    npmrc: await text(path.join(serverDir, '.npmrc')),
    schema: await text(path.join(serverDir, 'prisma', 'schema.prisma')),
  }
  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}

export const serverModulesFileName = sha256 => `cpu-web-server-modules-${sha256}.tar.gz`

/** The manifest's prebuilt dependency entry, or null for artifacts built before they existed. */
export function readServerModulesEntry(manifest) {
  const entry = manifest?.serverModules
  if (!entry) return null
  if (!/^[a-f0-9]{64}$/.test(String(entry.key)) || !/^[a-f0-9]{64}$/.test(String(entry.sha256))) throw new Error('invalid server modules entry')
  if (entry.file !== serverModulesFileName(entry.sha256)) throw new Error('server modules file name must be content-addressed')
  if (!Number.isSafeInteger(entry.bytes) || entry.bytes <= 0) throw new Error('invalid server modules size')
  if (entry.platform !== SERVER_MODULES_PLATFORM) throw new Error(`unsupported server modules platform: ${entry.platform}`)
  return entry
}

export async function verifyServerModulesArchive(entry, archive) {
  const { size } = await stat(archive)
  if (size !== entry.bytes) throw new Error(`server modules size mismatch: expected ${entry.bytes}, received ${size}`)
  if (await sha256File(archive) !== entry.sha256) throw new Error('server modules SHA-256 mismatch')
}

// npm and Prisma progress goes to stderr: stdout carries only the JSON entry that CI captures.
const runQuiet = (command, args, options = {}) => execFileSync(command, args, { stdio: ['ignore', 2, 2], ...options })

/** Packs with fixed order, owners and times so the same dependencies give the same archive and asset name. */
async function packDeterministic(sourceDir, archive) {
  const tar = spawn('tar', ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '--format=gnu', '-C', sourceDir, '-cf', '-', 'node_modules'], { stdio: ['ignore', 'pipe', 'inherit'] })
  const gzip = spawn('gzip', ['-n', '-6'], { stdio: ['pipe', 'pipe', 'inherit'] })
  tar.stdout.pipe(gzip.stdin)
  const out = createWriteStream(archive)
  gzip.stdout.pipe(out)
  const exited = child => new Promise((resolve, reject) => child.on('close', code => (code === 0 ? resolve() : reject(new Error(`${child.spawnfile} exited ${code}`)))))
  await Promise.all([exited(tar), exited(gzip), new Promise((resolve, reject) => out.on('finish', resolve).on('error', reject))])
}

/** CI only: a clean install from the lockfile, the generated Prisma client, then a deterministic archive. */
export async function packServerModules(serverDir, outputDir) {
  const key = await serverModulesKey(serverDir)
  // A fixed path: the generated Prisma client embeds it, and a random one would change the archive
  // (and so its content-addressed name) on every build of the same dependencies.
  const stage = path.join(os.tmpdir(), 'cpu-server-modules-stage')
  await rm(stage, { recursive: true, force: true })
  await mkdir(stage)
  try {
    for (const file of ['package.json', 'package-lock.json', '.npmrc']) {
      if (existsSync(path.join(serverDir, file))) await cp(path.join(serverDir, file), path.join(stage, file))
    }
    await mkdir(path.join(stage, 'prisma'))
    await cp(path.join(serverDir, 'prisma', 'schema.prisma'), path.join(stage, 'prisma', 'schema.prisma'))
    runQuiet('npm', ['ci', '--include=dev', '--no-audit', '--no-fund'], { cwd: stage })
    runQuiet('npx', ['--no-install', 'prisma', 'generate', '--schema', 'prisma/schema.prisma'], { cwd: stage })
    const modules = path.join(stage, 'node_modules')
    await pruneForeignBinaries(modules)
    for (const required of SERVER_MODULES_REQUIRED) {
      if (!existsSync(path.join(modules, required))) throw new Error(`prebuilt server dependencies lack ${required}`)
    }
    await writeFile(path.join(modules, SERVER_MODULES_MARKER), `${key}\n`)
    await mkdir(outputDir, { recursive: true })
    const temporary = path.join(outputDir, `.server-modules-${process.pid}.tar.gz`)
    await packDeterministic(stage, temporary)
    const sha256 = await sha256File(temporary)
    const file = serverModulesFileName(sha256)
    await rename(temporary, path.join(outputDir, file))
    const { size } = await stat(path.join(outputDir, file))
    return { key, file, sha256, bytes: size, platform: SERVER_MODULES_PLATFORM }
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}

/** onnxruntime-node ships every platform's library (~300 MB); production only loads linux/x64. */
async function pruneForeignBinaries(modules) {
  const bin = path.join(modules, 'onnxruntime-node', 'bin')
  if (!existsSync(bin)) return
  for (const napi of await readdir(bin)) {
    const napiDir = path.join(bin, napi)
    if (!(await stat(napiDir)).isDirectory()) continue
    for (const platform of await readdir(napiDir)) {
      const platformDir = path.join(napiDir, platform)
      if (platform !== 'linux') { await rm(platformDir, { recursive: true, force: true }); continue }
      for (const arch of await readdir(platformDir)) {
        if (arch !== 'x64') await rm(path.join(platformDir, arch), { recursive: true, force: true })
      }
    }
  }
}

const storeRoot = stateDir => path.join(stateDir, 'server-modules')

/** Low CPU and IO priority, so unpacking never competes with the live release for the disk. */
async function gentle(run, command, args, options) {
  const wrapped = []
  if (existsSync('/usr/bin/ionice') || existsSync('/bin/ionice')) wrapped.push('ionice', '-c', '2', '-n', '7')
  if (existsSync('/usr/bin/nice') || existsSync('/bin/nice')) wrapped.push('nice', '-n', '19')
  return wrapped.length ? run(wrapped[0], [...wrapped.slice(1), command, ...args], options) : run(command, args, options)
}

/**
 * Production: put the CI-built node_modules for `entry` into `serverDir` without installing anything.
 * The archive is extracted at most once per key into `<state>/server-modules/<key>`; releases receive
 * hard-linked copies (directory entries only, no file data is copied or rewritten).
 */
export async function installServerModules({ stateDir, entry, expectedKey, archive, serverDir, run, log }) {
  if (entry.key !== expectedKey) {
    throw new Error(`prebuilt server dependencies are for ${entry.key.slice(0, 12)}, but this release needs ${expectedKey.slice(0, 12)}`)
  }
  const store = path.join(storeRoot(stateDir), entry.key)
  const complete = path.join(store, '.complete')
  if (existsSync(complete)) {
    log(`Reusing prebuilt server dependencies ${entry.key.slice(0, 12)} already on this host`)
  } else {
    if (!archive) throw new Error('prebuilt server dependencies are neither on this host nor downloaded (DEPLOY_SERVER_MODULES_ARCHIVE)')
    await verifyServerModulesArchive(entry, archive)
    const incoming = `${store}.incoming-${process.pid}`
    await rm(incoming, { recursive: true, force: true })
    await mkdir(incoming, { recursive: true, mode: 0o755 })
    log(`Unpacking prebuilt server dependencies ${entry.key.slice(0, 12)} from CI (no npm install on this host)`)
    await gentle(run, 'tar', ['-xzf', archive, '-C', incoming])
    const modules = path.join(incoming, 'node_modules')
    const marker = (await text(path.join(modules, SERVER_MODULES_MARKER)))?.trim()
    if (marker !== entry.key) throw new Error('prebuilt server dependencies carry a different key marker')
    for (const required of SERVER_MODULES_REQUIRED) {
      if (!existsSync(path.join(modules, required))) throw new Error(`prebuilt server dependencies lack ${required}`)
    }
    await writeFile(path.join(incoming, '.complete'), `${entry.sha256}\n`)
    await rm(store, { recursive: true, force: true })
    await rename(incoming, store)
    await rm(archive, { force: true })
  }
  const target = path.join(serverDir, 'node_modules')
  if (existsSync(target)) throw new Error('the release already has node_modules')
  await gentle(run, 'cp', ['-al', path.join(store, 'node_modules'), target])
}

/** Keep the store entries that a release still uses, plus `keep` (the one just deployed). */
export async function pruneServerModules(stateDir, keep) {
  const root = storeRoot(stateDir)
  if (!existsSync(root)) return []
  const inUse = new Set([keep])
  const releases = path.join(stateDir, 'releases')
  if (existsSync(releases)) {
    for (const release of await readdir(releases)) {
      const marker = await text(path.join(releases, release, 'server', 'node_modules', SERVER_MODULES_MARKER)).catch(() => null)
      if (marker) inUse.add(marker.trim())
    }
  }
  const removed = []
  for (const name of await readdir(root)) {
    if (inUse.has(name)) continue
    await rm(path.join(root, name), { recursive: true, force: true })
    removed.push(name)
  }
  return removed
}

async function main(argv) {
  const [command, ...rest] = argv
  if (command === 'key') {
    console.log(await serverModulesKey(path.resolve(rest[0] || 'server')))
  } else if (command === 'pack') {
    const entry = await packServerModules(path.resolve(rest[0] || 'server'), path.resolve(rest[1] || '.'))
    console.log(JSON.stringify(entry))
  } else if (command === 'manifest') {
    const entry = readServerModulesEntry(JSON.parse(await readFile(rest[0], 'utf8')))
    if (entry) console.log(`${entry.key} ${entry.file} ${entry.sha256} ${entry.bytes}`)
  } else if (command === 'verify') {
    const entry = readServerModulesEntry(JSON.parse(await readFile(rest[0], 'utf8')))
    if (!entry) throw new Error('the manifest has no prebuilt server dependencies')
    await verifyServerModulesArchive(entry, rest[1])
  } else {
    throw new Error('usage: server-modules.mjs key|pack|manifest|verify ...')
  }
}

// Compare real paths: invoked through a symlinked directory, argv[1] differs from import.meta.url.
const invokedDirectly = () => {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch { return false }
}
if (invokedDirectly()) {
  main(process.argv.slice(2)).catch(error => {
    console.error(`[server-modules] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
