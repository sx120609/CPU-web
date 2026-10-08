import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertCommit, readArtifactManifest, verifyArtifactManifest } from './artifact-manifest.mjs'
import { validateArchiveEntries } from './install-agent-artifact.mjs'

const exec = promisify(execFile)
const repository = 'sx120609/CPU-web'
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

export function validateManagedConfig(config) {
  for (const key of ['root', 'node', 'requestFile']) {
    if (!path.isAbsolute(config[key] || '')) throw new Error(`Invalid managed Agent ${key}`)
  }
  if (!/^jwxt-agent-[A-Za-z0-9_-]+\.service$/.test(config.service || '')) throw new Error('Invalid Agent service')
  if (path.basename(config.requestFile) !== 'agent-remote-update.request') throw new Error('Invalid update request file')
  if (config.root === path.parse(config.root).root) throw new Error('Invalid Agent installation root')
  return config
}

export function assertManagedRelease(root, release) {
  if (!path.resolve(release).startsWith(path.join(path.resolve(root), 'releases') + path.sep)) {
    throw new Error('Release is outside the managed Agent installation')
  }
}

async function execute(command, args, options = {}) {
  const result = await exec(command, args, { maxBuffer: 4 * 1024 * 1024, timeout: 600_000, ...options })
  return result.stdout.trim()
}

async function download(url, target) {
  await execute('curl', ['--fail', '--location', '--silent', '--show-error', '--retry', '2',
    '--connect-timeout', '15', '--max-time', '300', '--output', target, url])
}

async function resolveCommit() {
  const text = await execute('curl', ['--fail', '--silent', '--show-error', '--connect-timeout', '15',
    '--max-time', '30', `https://api.github.com/repos/${repository}/commits/main`])
  return assertCommit(JSON.parse(text).sha)
}

async function confirmReady(config, command) {
  const pid = await command('systemctl', ['show', config.service, '--property=MainPID', '--value'])
  if (!/^[1-9]\d*$/.test(pid)) throw new Error('Agent did not start')
  const deadline = Date.now() + 90_000
  do {
    const active = await command('systemctl', ['is-active', config.service])
    if (active !== 'active') throw new Error('Agent service is not active')
    const currentPid = await command('systemctl', ['show', config.service, '--property=MainPID', '--value'])
    if (currentPid !== pid) throw new Error('Agent restarted before registering')
    const logs = await command('journalctl', ['--unit', config.service, `_PID=${pid}`,
      '--grep=\\[jwxt-agent\\] 已注册上线:', '--lines=1', '--output=cat', '--no-pager'])
    if (logs.includes('[jwxt-agent] 已注册上线:')) return
    await pause(1_000)
  } while (Date.now() < deadline)
  throw new Error('Agent did not register with the gateway within 90 seconds')
}

async function switchCurrent(root, release) {
  assertManagedRelease(root, release)
  const temporary = path.join(root, `.current-${randomUUID()}`)
  await symlink(release, temporary, 'dir')
  await rename(temporary, path.join(root, 'current'))
}

// Dependency injection is only for tests; the systemd entry point accepts a
// root-owned config file and never reads commands, versions or URLs from requests.
export async function updateManagedAgent(input, dependencies = {}) {
  const config = validateManagedConfig(input)
  const command = dependencies.execute || execute
  const fetchFile = dependencies.download || download
  const getCommit = dependencies.resolveCommit || resolveCommit
  const ready = dependencies.confirmReady || confirmReady
  const current = path.join(config.root, 'current')
  const previous = await realpath(current)
  assertManagedRelease(config.root, previous)
  const statusFile = path.join(path.dirname(config.requestFile), 'agent-remote-update.status.json')
  const requestedAt = new Date().toISOString()
  let commit = '', switched = false, incoming
  const status = async (phase, extra = {}) => {
    const temporary = `${statusFile}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify({ phase, commit, requestedAt, ...extra }) + '\n', { mode: 0o644 })
    await rename(temporary, statusFile)
  }
  try {
    commit = assertCommit(await getCommit())
    await status('preparing')
    const oldCommit = (await readFile(path.join(previous, 'server/dist/deployment-commit.txt'), 'utf8')).trim()
    if (oldCommit === commit) {
      await ready(config, command)
      await status('success', { alreadyCurrent: true, finishedAt: new Date().toISOString() })
      return { commit, alreadyCurrent: true }
    }
    await mkdir(path.join(config.root, '.updates'), { recursive: true, mode: 0o700 })
    incoming = await mkdtemp(path.join(config.root, '.updates/incoming-'))
    const archive = path.join(incoming, 'bundle.tar.gz')
    const asset = `https://github.com/${repository}/releases/download/deploy-artifacts/cpu-web-linux-${commit}.tar.gz`
    let downloaded = false
    for (const url of [asset, `https://gh.noki.eu.org/${asset}`, `https://ghfast.top/${asset}`]) {
      try { await fetchFile(url, archive); downloaded = true; break } catch { /* bounded transport fallback */ }
    }
    if (!downloaded) throw new Error(`Verified GitHub artifact is unavailable for ${commit}`)
    validateArchiveEntries(await command('tar', ['-tzf', archive]), await command('tar', ['-tvzf', archive]))
    await command('tar', ['-xzf', archive, '-C', incoming])
    const manifest = readArtifactManifest(path.join(incoming, 'manifest.json'))
    if (manifest.nodeMajor !== 24) throw new Error('Managed Agent requires a Node.js 24 artifact')
    await verifyArtifactManifest({ manifest, expectedCommit: commit, directory: incoming })
    const serverArchive = path.join(incoming, 'server-dist.tar.gz')
    validateArchiveEntries(await command('tar', ['-tzf', serverArchive]), await command('tar', ['-tvzf', serverArchive]), true)
    const release = path.join(config.root, 'releases', `${commit}-${randomUUID()}`)
    const server = path.join(release, 'server')
    await mkdir(path.join(server, 'prisma'), { recursive: true, mode: 0o755 })
    for (const file of ['package.json', 'package-lock.json', 'prisma/schema.prisma']) {
      await fetchFile(`https://raw.githubusercontent.com/${repository}/${commit}/server/${file}`, path.join(server, file))
    }
    await command('tar', ['-xzf', serverArchive, '-C', server])
    if ((await readFile(path.join(server, 'dist/deployment-commit.txt'), 'utf8')).trim() !== commit) {
      throw new Error('Agent build marker does not match the verified commit')
    }
    const env = { ...process.env, PATH: `${path.dirname(config.node)}${path.delimiter}${process.env.PATH || ''}`,
      DATABASE_URL: 'postgresql://unused:unused@127.0.0.1/unused' }
    const npm = path.resolve(path.dirname(config.node), '../lib/node_modules/npm/bin/npm-cli.js')
    await command(config.node, [npm, 'ci', '--include=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: server, env })
    await command(config.node, ['node_modules/prisma/build/index.js', 'generate', '--schema', 'prisma/schema.prisma'], { cwd: server, env })
    await command(config.node, ['--check', path.join(server, 'dist/jwxtAgent.js')])
    await status('switching')
    await switchCurrent(config.root, release)
    switched = true
    await command('systemctl', ['restart', config.service])
    await ready(config, command)
    await status('success', { release, finishedAt: new Date().toISOString() })
    console.log(`[managed-agent] Registered verified GitHub Agent artifact: ${commit}`)
    return { commit, release }
  } catch (error) {
    let recoveryError
    if (switched) {
      try {
        await switchCurrent(config.root, previous)
        await command('systemctl', ['restart', config.service])
        await ready(config, command)
      } catch (recovery) { recoveryError = recovery.message }
    }
    await status('failed', { message: error.message, rolledBack: switched && !recoveryError,
      ...(recoveryError ? { recoveryError } : {}), finishedAt: new Date().toISOString() })
    if (recoveryError) throw new Error(`${error.message}; rollback failed: ${recoveryError}`)
    throw error
  } finally {
    await rm(config.requestFile, { force: true })
    if (incoming) await rm(incoming, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.platform !== 'linux' || process.getuid() !== 0) throw new Error('Run the managed updater through its root-owned systemd unit')
    const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
    await updateManagedAgent(config)
  } catch (error) { console.error(`[managed-agent] ${error.message}`); process.exitCode = 1 }
}
