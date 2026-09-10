import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomBytes } from 'node:crypto'
import { access, mkdir, readFile, rename, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import path from 'node:path'
import { assertCommit, readArtifactManifest, verifyArtifactManifest } from './artifact-manifest.mjs'

const exec = promisify(execFile)
const run = (command, args, options = {}) => exec(command, args, { maxBuffer: 16 * 1024 * 1024, ...options })
const exists = file => access(file).then(() => true, () => false)

// Preparation never edits nginx, restarts an Agent, or replaces an existing owner.
async function prepare() {
  if (process.platform !== 'linux' || Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Linux and Node.js 24 are required')
  if (!process.env.CPU_WEB_DEPLOY_ROOT || !process.env.DEPLOY_ARTIFACT_DIR) throw new Error('Deployment root and artifact directory are required')
  const root = path.resolve(process.env.CPU_WEB_DEPLOY_ROOT)
  const artifact = path.resolve(process.env.DEPLOY_ARTIFACT_DIR)
  const commit = assertCommit(process.env.DEPLOY_TARGET_COMMIT)
  const manifest = readArtifactManifest(path.join(artifact, 'manifest.json'))
  if (manifest.nodeMajor !== 24) throw new Error('Node.js 24 artifact is required')
  await verifyArtifactManifest({ manifest, expectedCommit: commit, directory: artifact })
  const directory = path.join(root, '.deploy', 'blue-green')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const secretFile = path.join(directory, 'agent-gateway.secret')
  if (!await exists(secretFile)) await writeFile(secretFile, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 })
  const secret = (await readFile(secretFile, 'utf8')).trim()
  if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('Invalid existing gateway secret')
  const port = Number(process.env.DEPLOY_AGENT_GATEWAY_PORT || 23633)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid gateway port')
  const processes = JSON.parse((await run('pm2', ['jlist'])).stdout)
  if (processes.some(item => item.name === 'cpu-jwxt-gateway')) throw new Error('Gateway already exists; it will not be restarted or replaced by preparation')
  await new Promise((resolve, reject) => {
    const probe = createServer(); probe.once('error', reject)
    probe.listen(port, '127.0.0.1', () => probe.close(resolve))
  })
  const release = path.join(directory, `agent-gateway-${commit}-${Date.now()}`)
  await mkdir(release, { mode: 0o700 })
  const source = path.join(release, 'source.tar')
  await run('git', ['archive', '--format=tar', `--output=${source}`, commit, 'server', 'desktop'], { cwd: root })
  await run('tar', ['-xf', source, '-C', release])
  const server = path.join(release, 'server')
  await run('tar', ['-xzf', path.join(artifact, 'server-dist.tar.gz'), '-C', server])
  await symlink(path.join(root, 'server', '.env'), path.join(server, '.env'))
  if (await exists(path.join(server, 'runtime'))) await rename(path.join(server, 'runtime'), path.join(server, 'runtime.packaged'))
  await symlink(path.join(root, 'server', 'runtime'), path.join(server, 'runtime'))
  await run('npm', ['ci', '--include=dev', '--no-audit', '--no-fund'], { cwd: server })
  await run('npm', ['run', 'prisma:generate'], { cwd: server })
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:CPU_WEB_|DEPLOY_)/.test(key)))
  await run('pm2', ['start', path.join(server, 'dist/jwxtGateway.js'), '--name', 'cpu-jwxt-gateway', '--cwd', server,
    '--interpreter', process.execPath, '--time', '--merge-logs'], { cwd: server, env: { ...environment,
      NODE_ENV: 'production', CPU_WEB_AGENT_GATEWAY_ROLE: 'owner', CPU_WEB_AGENT_GATEWAY_PORT: String(port), CPU_WEB_AGENT_GATEWAY_SECRET_FILE: secretFile,
    } })
  let ready = false
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/snapshot`, { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(3000) })
      const snapshot = await response.json()
      if (response.ok && snapshot.protocol === 1 && snapshot.instance) { ready = true; break }
    } catch { /* startup */ }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  if (!ready) throw new Error('Prepared gateway is not ready; active application and Agent routing were not changed')
  await run('pm2', ['save'])
  console.log(`Prepared persistent gateway from verified artifact ${commit} on loopback:${port}. Migration and API cutover have NOT occurred.`)
}
prepare().catch(error => { console.error(error.message); process.exitCode = 1 })
