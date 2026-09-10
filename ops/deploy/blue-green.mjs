import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { access, glob, mkdir, readFile, readdir, realpath, rename, rm, symlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertCommit, readArtifactManifest, verifyArtifactManifest } from './artifact-manifest.mjs'
import { atomicWrite, cutover, probe, replaceConfig, replaceUpstream, runtimeEnvironment } from './blue-green-core.mjs'
import { readGateway, assertSameGateway, waitForUpstreamIdle } from './agent-gateway.mjs'

const exec = promisify(execFile)
const log = message => console.log(`[blue-green] ${message}`)
const exists = file => access(file).then(() => true, () => false)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function run(command, args, options = {}) {
  const result = await exec(command, args, { maxBuffer: 16 * 1024 * 1024, ...options })
  return result.stdout.trim()
}

function integer(value, fallback, minimum, maximum) {
  const parsed = Number(value ?? fallback)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`Invalid deployment integer: ${value}`)
  return parsed
}

async function portAvailable(port) {
  await new Promise((resolve, reject) => {
    const socket = createServer()
    socket.once('error', reject)
    socket.listen(port, '127.0.0.1', () => socket.close(resolve))
  })
}

async function nginxWorkers(nginx) {
  const dump = await run(nginx, ['-T'])
  const { stderr: version } = await exec(nginx, ['-V'])
  const configureValue = option => version.match(new RegExp(`--${option}=(?:'([^']+)'|"([^"]+)"|(\\S+))`))?.slice(1).find(Boolean)
  const prefix = configureValue('prefix') || '/usr/local/nginx'
  const configuredPid = dump.split('\n').map(line => line.match(/^\s*pid\s+([^;]+);/)?.[1]?.trim()).find(Boolean)
  const pidFile = process.env.NGINX_PID_FILE || configuredPid || configureValue('pid-path') || 'logs/nginx.pid'
  const master = (await readFile(path.resolve(prefix, pidFile.replace(/^["']|["']$/g, '')), 'utf8')).trim()
  if (!/^\d+$/.test(master)) throw new Error('Invalid nginx master PID')
  const processes = await run('ps', ['-eo', 'pid=,ppid=,args='])
  const identities = []
  for (const line of processes.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+nginx: worker process(?:\s|$)/)
    if (!match || match[2] !== master) continue
    const file = `/proc/${match[1]}/stat`
    try { identities.push({ file, identity: (await readFile(file, 'utf8')).split(') ')[1].split(' ')[19] }) } catch { /* worker exited */ }
  }
  if (!identities.length) throw new Error('No running nginx workers found; refusing an unverified cutover')
  return identities
}

async function waitForWorkers(identities, timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1000
  do {
    const live = await Promise.all(identities.map(async ({ file, identity }) => {
      try { return (await readFile(file, 'utf8')).split(') ')[1].split(' ')[19] === identity } catch { return false }
    }))
    if (!live.some(Boolean)) return true
    await sleep(1000)
  } while (Date.now() < deadline)
  return false
}

async function pm2Present(name) {
  const processes = JSON.parse(await run('pm2', ['jlist']))
  return processes.some(item => item.name === name && item.pm2_env?.status === 'online')
}

async function startProcess(script, name, cwd, env, memory, args = [], killTimeout = 125000) {
  await run('pm2', ['start', script, '--name', name, '--cwd', cwd,
    '--interpreter', process.execPath, '--time', '--kill-timeout', String(killTimeout),
    '--max-memory-restart', memory, '--merge-logs', ...args], { cwd, env: { ...runtimeEnvironment(process.env), ...env } })
}

async function removeProcess(name) {
  // PM2 handles SIGINT and waits for the application's graceful shutdown.
  const processes = JSON.parse(await run('pm2', ['jlist']))
  if (processes.some(item => item.name === name)) await run('pm2', ['delete', name], { timeout: 135000 })
}

export async function findProxyConfig(site, port, explicit) {
  if (explicit) {
    const target = await realpath(explicit)
    replaceUpstream(await readFile(target, 'utf8'), port, port)
    return target
  }
  const pending = [site], visited = new Set(), matches = []
  const allowedRoot = path.dirname(path.resolve(site))
  while (pending.length) {
    const file = await realpath(pending.pop())
    if (visited.has(file)) continue
    visited.add(file)
    const text = await readFile(file, 'utf8')
    try { replaceUpstream(text, port, port); matches.push(file) } catch { /* unrelated include */ }
    for (const line of text.split('\n')) {
      const include = line.match(/^\s*include\s+["']?([^;"']+?)["']?\s*;/)?.[1]?.trim()
      if (!include || !path.isAbsolute(include)) continue
      const relative = path.relative(allowedRoot, include)
      if (relative.startsWith('..') || path.isAbsolute(relative)) continue
      for await (const child of glob(include)) pending.push(child)
    }
  }
  if (matches.length !== 1) throw new Error(`Expected one main-site proxy config, found ${matches.length}. Set DEPLOY_NGINX_CONFIG explicitly.`)
  return matches[0]
}

export async function configSnapshots(candidate, from, to) {
  const files = candidate.configs || [{ nginxConfig: candidate.nginxConfig, configBackup: candidate.configBackup }]
  return Promise.all(files.map(async item => {
    const before = await readFile(item.configBackup, 'utf8')
    return { file: item.nginxConfig, before, after: replaceUpstream(before, from, to) }
  }))
}

export async function restoreConfigs(configs) {
  // Validate the entire set before touching it. A partially applied cutover is
  // recoverable, but an external edit must never be overwritten.
  for (const item of configs) {
    const current = await readFile(item.file, 'utf8')
    if (current !== item.before && current !== item.after) throw new Error('Nginx configuration changed during deployment; refusing to overwrite it')
  }
  for (const item of configs) {
    if (await readFile(item.file, 'utf8') !== item.before) await replaceConfig(item.file, item.after, item.before)
  }
}

export async function linkSharedDirectory(source, target) {
  await mkdir(source, { recursive: true })
  // Source archives can contain historical sample uploads. Keep those within
  // this isolated release; the existing live directory remains authoritative.
  if (await exists(target)) await rename(target, `${target}.packaged`)
  await symlink(source, target, 'dir')
}

export async function verifyWeb(base, html, { entry = false } = {}) {
  const paths = [...html.matchAll(/(?:src|href)=["']([^"']*\/assets\/[^"']+\.(?:js|css))["']/g)].map(match => match[1])
  if (!paths.length) throw new Error('The web artifact has no entry JS/CSS')
  if (entry) {
    const response = await fetch(`${base}/home`, { signal: AbortSignal.timeout(5000) })
    const body = await response.text()
    if (!response.ok || !paths.every(asset => body.includes(path.posix.basename(asset)))) throw new Error('Published web entry does not match the staged artifact')
  }
  await Promise.all(paths.map(async asset => {
    const localPath = `/assets/${asset.split('/assets/')[1]}`
    const response = await fetch(`${base}${localPath}`, { method: 'HEAD', signal: AbortSignal.timeout(10000) })
    const expected = asset.endsWith('.css') ? /text\/css/i : /(?:text|application)\/(?:java|ecma)script/i
    if (!response.ok || !expected.test(response.headers.get('content-type') || '')) throw new Error(`Web entry asset is unavailable or has the wrong content type: ${localPath}`)
  }))
}

async function filesBelow(directory, prefix = '') {
  const result = []
  for (const entry of await readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name)
    if (entry.isDirectory()) result.push(...await filesBelow(directory, relative))
    else if (entry.isFile()) result.push(relative)
    else throw new Error(`Unexpected link in web artifact: ${relative}`)
  }
  return result
}

export async function publishWebAssets(stage, live) {
  await mkdir(live, { recursive: true })
  for (const relative of await filesBelow(stage)) {
    if (relative === 'index.html') continue
    const source = path.join(stage, relative)
    const target = path.join(live, relative)
    await mkdir(path.dirname(target), { recursive: true })
    const contents = await readFile(source)
    if (relative.startsWith(`assets${path.sep}`) && await exists(target)) {
      if (!(await readFile(target)).equals(contents)) throw new Error(`Conflicting immutable web asset: ${relative}`)
      continue
    }
    await atomicWrite(target, contents, 0o644)
  }
}

export async function deploy() {
  if (process.platform !== 'linux' || Number(process.versions.node.split('.')[0]) !== 24) {
    throw new Error('Online deployment requires Linux and Node.js 24; provision the runtime separately')
  }
  const root = path.resolve(process.env.CPU_WEB_DEPLOY_ROOT || fileURLToPath(new URL('../..', import.meta.url)))
  const stateDir = path.join(root, '.deploy', 'blue-green')
  const stateFile = path.join(stateDir, 'state.json')
  const marker = path.join(stateDir, 'background-owner')
  await mkdir(stateDir, { recursive: true, mode: 0o700 })
  const save = value => atomicWrite(stateFile, `${JSON.stringify(value, null, 2)}\n`)
  const commit = assertCommit(process.env.DEPLOY_TARGET_COMMIT)
  const artifact = path.resolve(process.env.DEPLOY_ARTIFACT_DIR || '')
  const manifest = readArtifactManifest(path.join(artifact, 'manifest.json'))
  if (manifest.nodeMajor !== 24) throw new Error('The artifact must be built with Node.js 24')
  await verifyArtifactManifest({ manifest, expectedCommit: commit, directory: artifact })
  const basePort = integer(process.env.PORT, 23333, 1024, 65000)
  const drainSeconds = integer(process.env.DEPLOY_DRAIN_SECONDS, 120, 0, 86400)
  const nginx = process.env.NGINX_BIN || '/www/server/nginx/sbin/nginx'
  const siteConfig = path.resolve(process.env.NGINX_SITE_CONFIG || '/www/server/panel/vhost/nginx/cpu.lizmt.cn.conf')
  const changed = new Set((process.env.DEPLOY_CHANGED_FILES || '').split('\n').filter(Boolean))
  const force = process.env.DEPLOY_FORCE_ALL === '1'
  const touches = pattern => force || [...changed].some(file => pattern.test(file))
  let state = await exists(stateFile) ? JSON.parse(await readFile(stateFile, 'utf8')) : null
  let finishedDraining = false
  const activate = async candidate => {
    await atomicWrite(marker, candidate.id)
    await run('pm2', ['save'])
  }
  const waitForUpstream = port => waitForUpstreamIdle(port, drainSeconds, {
    connections: async target => Boolean(await run('ss', ['-Hnt', 'state', 'established', `( sport = :${target} or dport = :${target} )`])),
  })
  const retire = async (previous, candidate, workers) => {
    if (candidate.gateway) assertSameGateway(candidate.gateway, await readGateway(stateDir))
    const drainedUpstream = candidate.gateway
      ? await waitForUpstream(previous.port)
      : await waitForWorkers(workers, drainSeconds)
    if (!drainedUpstream) {
      log('Old upstream connections have not drained. Both releases are retained; run update again after they drain.')
      return false
    }
    for (const item of await configSnapshots(candidate, previous.port, candidate.port)) {
      if (await readFile(item.file, 'utf8') !== item.after) {
        throw new Error('Nginx configuration changed while draining; retaining the previous instance')
      }
    }
    await probe(`${candidate.verifyUrl}/api/ready?drain=${Date.now()}`, { commit: candidate.commit })
    await atomicWrite(candidate.trafficMarker, candidate.id)
    const deadline = Date.now() + drainSeconds * 1000
    let drained = false
    do {
      const response = await fetch(`http://127.0.0.1:${candidate.port}/api/ready`, { signal: AbortSignal.timeout(3000) })
      const data = (await response.json()).data
      if (!response.ok || data?.commit !== candidate.commit) throw new Error('Candidate lost readiness during API handoff; retaining old process')
      if (data.relayInFlight === 0) { drained = true; break }
      await sleep(1000)
    } while (Date.now() < deadline)
    if (!drained) { log('Relayed requests are still active; retaining the previous release'); return false }
    if (candidate.gateway) assertSameGateway(candidate.gateway, await readGateway(stateDir))
    if (previous?.name) await removeProcess(previous.name)
    if (previous?.voiceName && previous.voiceName !== candidate.voiceName) await removeProcess(previous.voiceName)
    return true
  }
  // Never guess which version won an interrupted reload. Recover its persisted
  // nginx snapshot first, preserving both processes until the old workers exit.
  if (state && state.phase !== 'active') {
    if (state.phase === 'draining') {
      await probe(`http://127.0.0.1:${state.candidate.port}/api/ready`, { commit: state.candidate.commit })
      if (!await retire(state.previous, state.candidate, state.candidate.oldWorkers)) throw new Error('Previous deployment is still draining; no new deployment started')
      await activate(state.candidate)
      state = { phase: 'active', active: state.candidate }
      await save(state)
      finishedDraining = true
    } else {
      const { previous, candidate } = state
      await probe(`http://127.0.0.1:${previous.port}/api/health`)
      const workers = await nginxWorkers(nginx)
      await restoreConfigs(await configSnapshots(candidate, previous.port, candidate.port))
      await run(nginx, ['-t'])
      await atomicWrite(path.join(root, 'web/dist/index.html'), await readFile(path.join(candidate.release, 'previous-index.html')), 0o644)
      await run(nginx, ['-s', 'reload'])
      const rollbackDrained = candidate.gateway ? await waitForUpstream(candidate.port) : await waitForWorkers(workers, drainSeconds)
      if (!rollbackDrained) throw new Error('Rollback traffic restored; candidate still draining. Rerun update to finish recovery.')
      await removeProcess(candidate.name)
      if (candidate.voiceName !== previous.voiceName) await removeProcess(candidate.voiceName)
      if (previous.id) await activate(previous)
      else await run('pm2', ['save'])
      state = { phase: 'active', active: previous }
      await save(state)
    }
  }
  if (finishedDraining && state.active.commit === commit) {
    log(`Pending deployment completed: ${commit}`)
    return
  }
  let previous = state?.active
  if (!previous) {
    if (!await pm2Present('cpu-web')) throw new Error('The legacy cpu-web service must be healthy for the first online cutover')
    await probe(`http://127.0.0.1:${basePort}/api/health`)
    previous = { name: 'cpu-web', port: basePort, voiceName: 'cpu-voicehub', voicePort: integer(process.env.VOICEHUB_PORT, 23335, 1024, 65535) }
  } else await probe(`http://127.0.0.1:${previous.port}/api/${previous.commit ? 'ready' : 'health'}`, { commit: previous.commit })
  const serverChanged = !previous.id || touches(/^(server\/|desktop\/assets\/userscripts\/|ops\/deploy\/|deploy\.sh$)/)
  const voiceChanged = !previous.id || touches(/^voicehub\//)
  // Legacy in-process Agent sockets cannot be transferred to another process.
  // Require a completed gateway migration before creating a new API owner.
  const gateway = serverChanged || voiceChanged ? await readGateway(stateDir).catch(error => {
    throw new Error(`Agent gateway migration/readiness is required before backend deployment: ${error.message}. No running process was changed.`)
  }) : null
  let nginxConfigs = []
  if (serverChanged || voiceChanged) {
    if (process.env.DEPLOY_NGINX_CONFIGS) {
      const selected = JSON.parse(process.env.DEPLOY_NGINX_CONFIGS)
      if (!Array.isArray(selected) || !selected.length || selected.some(file => typeof file !== 'string' || !path.isAbsolute(file))) throw new Error('DEPLOY_NGINX_CONFIGS must be a nonempty JSON array of absolute paths')
      nginxConfigs = await Promise.all(selected.map(file => findProxyConfig(siteConfig, previous.port, file)))
      if (new Set(nginxConfigs).size !== nginxConfigs.length) throw new Error('Duplicate nginx configuration paths')
    } else nginxConfigs = [await findProxyConfig(siteConfig, previous.port, process.env.DEPLOY_NGINX_CONFIG)]
  }
  const schemaChanged = [...changed].some(file => /^(server\/prisma\/|voicehub\/(drizzle\/|drizzle\.config|server\/database\/))/.test(file))
  if ((schemaChanged || force) && process.env.DEPLOY_ALLOW_SCHEMA_EXPAND !== '1') {
    throw new Error('Schema/full update requires reviewed backward-compatible migrations: set DEPLOY_ALLOW_SCHEMA_EXPAND=1. No running process was changed')
  }
  const id = `${commit.slice(0, 12)}-${Date.now()}-${randomUUID().slice(0, 8)}`
  const release = path.join(stateDir, 'releases', id)
  const trafficMarker = path.join(release, 'traffic-owner')
  await mkdir(release, { recursive: true, mode: 0o700 })
  const sourceArchive = path.join(release, 'source.tar')
  if (serverChanged || voiceChanged) {
    await run('git', ['archive', '--format=tar', `--output=${sourceArchive}`, commit, 'server', 'voicehub', 'desktop'], { cwd: root })
    await run('tar', ['-xf', sourceArchive, '-C', release])
    await rm(sourceArchive)
  }
  const serverDir = path.join(release, 'server')
  const voiceDir = path.join(release, 'voicehub')
  const webDir = path.join(release, 'web')
  await mkdir(webDir, { recursive: true })
  await run('tar', ['-xzf', path.join(artifact, 'web-dist.tar.gz'), '-C', webDir])
  if (serverChanged || voiceChanged) {
    await run('tar', ['-xzf', path.join(artifact, 'server-dist.tar.gz'), '-C', serverDir])
    if (voiceChanged) await run('tar', ['-xzf', path.join(artifact, 'voicehub-output.tar.gz'), '-C', voiceDir])
    await symlink(path.join(root, 'server', '.env'), path.join(serverDir, '.env'))
    for (const directory of ['uploads', 'runtime']) {
      await linkSharedDirectory(path.join(root, 'server', directory), path.join(serverDir, directory))
    }
    if (voiceChanged) {
      for (const directory of ['backups', 'storage', 'logs']) {
        await linkSharedDirectory(path.join(root, 'voicehub', directory), path.join(voiceDir, directory))
      }
      // Keep legacy avatar fallback directories readable in the isolated release.
      for (const relative of ['public/uploads', '.output/public/uploads']) {
        const source = path.join(root, 'voicehub', relative)
        if (!await exists(source)) continue
        const target = path.join(voiceDir, relative)
        if (await exists(target)) throw new Error(`VoiceHub artifact unexpectedly contains mutable uploads: ${relative}`)
        await mkdir(path.dirname(target), { recursive: true })
        await symlink(source, target)
      }
    }
    log('Preparing isolated dependencies and verified GitHub artifacts; the active release is untouched')
    await run('npm', ['ci', '--include=dev', '--no-audit', '--no-fund'], { cwd: serverDir })
    await run('npm', ['run', 'prisma:generate'], { cwd: serverDir })
    if (schemaChanged || force) {
      await run('npm', ['run', 'db:migrate'], { cwd: serverDir })
      await run('npm', ['run', 'db:cleanup-retired-boards'], { cwd: serverDir })
    }
  }
  const liveWeb = path.join(root, 'web', 'dist')
  const stagedWeb = path.join(webDir, 'dist')
  const runtimeServerDir = serverChanged || voiceChanged ? serverDir : path.join(previous.release, 'server')
  await run(process.execPath, [path.join(runtimeServerDir, 'dist/scripts/syncWebStaticAssets.js'), stagedWeb], { cwd: runtimeServerDir, env: { ...process.env, NODE_ENV: 'production' } })
  const oldIndex = await readFile(path.join(liveWeb, 'index.html'))
  await atomicWrite(path.join(release, 'previous-index.html'), oldIndex)
  await publishWebAssets(stagedWeb, liveWeb)
  const newIndex = await readFile(path.join(stagedWeb, 'index.html'), 'utf8')
  const publishIndex = async () => atomicWrite(path.join(liveWeb, 'index.html'), await readFile(path.join(stagedWeb, 'index.html')), 0o644)

  if (!serverChanged && !voiceChanged) {
    await verifyWeb(`http://127.0.0.1:${previous.port}`, newIndex)
    await publishIndex()
    try {
      await verifyWeb(`http://127.0.0.1:${previous.port}`, newIndex, { entry: true })
    } catch (error) {
      await atomicWrite(path.join(liveWeb, 'index.html'), oldIndex, 0o644)
      throw error
    }
    await save({ ...state, webCommit: commit })
    log('Web entry switched atomically. No backend process was restarted.')
    return
  }

  const ports = [integer(process.env.DEPLOY_BLUE_PORT, basePort + 100, 1024, 65535), integer(process.env.DEPLOY_GREEN_PORT, basePort + 101, 1024, 65535)]
  if (ports[0] === ports[1]) throw new Error('Blue and green ports must differ')
  const port = ports.find(value => value !== previous.port)
  await portAvailable(port)
  const voicePorts = [integer(process.env.DEPLOY_VOICE_BLUE_PORT, basePort + 200, 1024, 65535), integer(process.env.DEPLOY_VOICE_GREEN_PORT, basePort + 201, 1024, 65535)]
  if (new Set([...ports, ...voicePorts]).size !== 4) throw new Error('Main and VoiceHub blue/green ports must all differ')
  const voicePort = voiceChanged ? voicePorts.find(value => value !== previous.voicePort) : previous.voicePort
  if (voiceChanged) await portAvailable(voicePort)
  const name = `cpu-web-${id}`
  const voiceName = voiceChanged ? `cpu-voicehub-${id}` : previous.voiceName
  const configs = []
  for (const [index, nginxConfig] of nginxConfigs.entries()) {
    const configBackup = path.join(release, `nginx-before-${index}.conf`)
    await atomicWrite(configBackup, await readFile(nginxConfig, 'utf8'))
    configs.push({ nginxConfig, configBackup })
  }
  await run(nginx, ['-t'])
  const nginxDump = await run(nginx, ['-T'])
  for (const line of nginxDump.split('\n')) {
    const timeout = line.match(/^\s*worker_shutdown_timeout\s+([^;]+);/)?.[1]?.trim()
    if (timeout && !/^0(?:ms|s|m|h|d)?$/.test(timeout)) throw new Error('Nginx worker_shutdown_timeout would force-close old connections; remove it or set it to 0 before online deployment')
  }
  const verifyUrl = (process.env.DEPLOY_VERIFY_URL || 'https://cputime.cn').replace(/\/$/, '')
  const candidate = { id, commit, name, port, voiceName, voicePort, release, trafficMarker, configs, verifyUrl, gateway }
  const snapshots = await configSnapshots(candidate, previous.port, port)
  let switching = false
  let mainStarted = false
  let voiceStarted = false
  await save({ phase: 'preparing', previous, candidate })
  try {
    if (voiceChanged) {
      await run('npm', ['ci', '--include=dev', '--no-audit', '--no-fund'], { cwd: voiceDir })
      if (schemaChanged || force) await run('npm', ['run', 'db:migrate:cpu'], { cwd: voiceDir })
      await startProcess(path.join(voiceDir, 'scripts/cpu-runner.mjs'), voiceName, voiceDir, {
        NODE_ENV: 'production', VOICEHUB_PORT: String(voicePort), NITRO_PORT: String(voicePort),
        NITRO_HOST: '127.0.0.1', CPU_WEB_ORIGIN: process.env.DEPLOY_INTERNAL_ORIGIN || 'https://cputime.cn', VOICEHUB_AUTO_MIGRATE: 'false',
      }, '900M', ['--', 'serve'])
      voiceStarted = true
      await probe(`http://127.0.0.1:${voicePort}/voicehub/`)
    }
    await startProcess(path.join(serverDir, 'dist/index.js'), name, serverDir, {
      NODE_ENV: 'production', PORT: String(port), CPU_WEB_LISTEN_HOST: '127.0.0.1',
      CPU_WEB_DEPLOY_ROOT: root, CPU_WEB_DIST: liveWeb,
      CPU_WEB_DEPLOY_BASE_PORT: String(basePort), CPU_WEB_DEPLOY_VOICE_PORT: process.env.VOICEHUB_PORT || '23335',
      DEPLOY_BLUE_PORT: String(ports[0]), DEPLOY_GREEN_PORT: String(ports[1]),
      DEPLOY_VOICE_BLUE_PORT: String(voicePorts[0]), DEPLOY_VOICE_GREEN_PORT: String(voicePorts[1]),
      DEPLOY_NGINX_CONFIGS: JSON.stringify(nginxConfigs), DEPLOY_VERIFY_URL: verifyUrl,
      DEPLOY_INTERNAL_ORIGIN: process.env.DEPLOY_INTERNAL_ORIGIN || 'https://cputime.cn',
      DEPLOY_DRAIN_SECONDS: String(drainSeconds),
      CPU_WEB_RELEASE_SHA: commit, CPU_WEB_RELEASE_ID: id, CPU_WEB_BACKGROUND_MARKER: marker,
      CPU_WEB_PREVIOUS_PORT: '', CPU_WEB_TRAFFIC_MARKER: trafficMarker,
      CPU_WEB_AGENT_GATEWAY_ROLE: 'client', CPU_WEB_AGENT_GATEWAY_PORT: String(gateway.port),
      CPU_WEB_AGENT_GATEWAY_SECRET_FILE: gateway.secretFile,
      VOICEHUB_ORIGIN: `http://127.0.0.1:${voicePort}`,
    // Nginx draining precedes retirement; PM2's own memory restart has no standby.
    // Keep that restart bounded instead of waiting two minutes on agent sockets.
    }, '1536M', [], 5000)
    mainStarted = true
    await run('pm2', ['save'])
    const complete = await cutover({
      previous, candidate,
      prepare: async () => { candidate.oldWorkers = await nginxWorkers(nginx) },
      ready: async () => {
        assertSameGateway(gateway, await readGateway(stateDir))
        await probe(`http://127.0.0.1:${port}/api/ready`, { commit })
        await verifyWeb(`http://127.0.0.1:${port}`, newIndex)
      },
      persist: async value => { switching = true; await save(value) },
      switchRoute: async () => {
        for (const item of snapshots) await replaceConfig(item.file, item.before, item.after)
        await run(nginx, ['-t'])
        await publishIndex()
        candidate.oldWorkers = await nginxWorkers(nginx)
        await save({ phase: 'switching', previous, candidate })
        await run(nginx, ['-s', 'reload'])
      },
      verify: async () => {
        assertSameGateway(gateway, await readGateway(stateDir))
        await probe(`${verifyUrl}/api/ready?deploy=${id}`, { commit, attempts: 10 })
        await verifyWeb(verifyUrl, newIndex, { entry: true })
      },
      rollbackRoute: async () => {
        await restoreConfigs(snapshots)
        await run(nginx, ['-t'])
        await atomicWrite(path.join(liveWeb, 'index.html'), oldIndex, 0o644)
        await atomicWrite(trafficMarker, '')
        await run(nginx, ['-s', 'reload'])
      },
      retire: old => retire(old, candidate, candidate.oldWorkers), activate,
    })
    if (!complete) throw new Error('Traffic switched successfully, but old connections have not drained. Both instances are retained; rerun update to finish.')
    log(`Deployment complete: ${commit}; previous release retained on disk for recovery`)
  } catch (error) {
    if (!switching) {
      if (mainStarted) await removeProcess(name)
      if (voiceStarted) await removeProcess(voiceName)
      await run('pm2', ['save'])
      await save({ phase: 'active', active: previous })
    }
    throw error
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  deploy().catch(error => { console.error(`[blue-green] ${error.message}`); process.exitCode = 1 })
}
