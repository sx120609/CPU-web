import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createServer, request } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { atomicWrite, cutover, probe, replaceConfig, replaceUpstream, runtimeEnvironment } from './blue-green-core.mjs'
import { linkSharedDirectory, configSnapshots, restoreConfigs, findProxyConfig, publishWebAssets, verifyWeb } from './blue-green.mjs'

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
const close = server => new Promise(resolve => server.close(resolve))
const tick = ms => new Promise(resolve => setTimeout(resolve, ms))

test('PM2 runtime cannot inherit a held deployment lock or a one-time migration authorization', () => {
  assert.deepEqual(runtimeEnvironment({ PATH: '/bin', DATABASE_URL: 'retained', DEPLOY_ALLOW_SCHEMA_EXPAND: '1', DEPLOY_FORCE_ALL: '1', CPU_WEB_UPDATE_LOCKED: '1', CPU_WEB_UPDATE_REEXEC: '1', CPU_WEB_ADMIN_DEPLOY: '1' }), { PATH: '/bin', DATABASE_URL: 'retained' })
})

test('update uses the verified-artifact coordinator and never records success after its failure', { skip: process.platform === 'win32' }, () => {
  const script = readFileSync(new URL('../../deploy.sh', import.meta.url), 'utf8')
  const update = script.match(/do_update\(\) \{[\s\S]*?\n\}/)[0]
  const harness = `set -eu
    exec 9>/dev/null
    CPU_WEB_UPDATE_LOCKED=1; DEPLOY_BUILD_MODE=auto; DEPLOY_ARTIFACT_READY=0
    ROOT_DIR=/tmp/cpu-test; DEPLOY_TARGET_COMMIT=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    DEPLOY_CHANGED_FILES=web/src/App.vue; DEPLOY_FORCE_ALL=0; DEPLOY_ARTIFACT_DIR=/tmp/artifact
    PORT=23333; VOICEHUB_PORT=23335; NGINX_BIN=nginx; NGINX_SITE_CONFIG=/tmp/site.conf
    collect_update_changes() { echo collect; }
    select_deploy_build_source() { test "$DEPLOY_BUILD_MODE" = ci; echo artifact; DEPLOY_ARTIFACT_READY=1; }
    record_successful_deployment() { echo recorded; }
    node() { test "$1" = /tmp/cpu-test/ops/deploy/blue-green.mjs; echo coordinator; return "$FAILURE"; }
    do_main_restart() { exit 91; }; do_build_server() { exit 92; }
    warn() { :; }; err() { echo "$*" >&2; exit 37; }
    ${update}
    do_update`
  assert.equal(execFileSync('bash', ['-c', harness], { env: { ...process.env, FAILURE: '0' }, encoding: 'utf8' }).trim(), 'collect\nartifact\ncoordinator\nrecorded')
  assert.throws(() => execFileSync('bash', ['-c', harness], { env: { ...process.env, FAILURE: '1' }, encoding: 'utf8' }), error => error.status === 1 && !String(error.stdout).includes('recorded'))
})

function fixture(overrides = {}) {
  const events = []
  const hooks = Object.fromEntries(['prepare', 'ready', 'switchRoute', 'verify', 'rollbackRoute', 'retire', 'activate'].map(name => [name, async () => { events.push(name); return true }]))
  hooks.persist = async state => events.push(state.phase)
  return { events, options: { previous: { name: 'old' }, candidate: { name: 'new' }, ...hooks, ...overrides } }
}

test('new release must be ready before any nginx change; startup failure leaves the active process alone', async () => {
  const f = fixture({ ready: async () => { throw Error('database unavailable') } })
  await assert.rejects(cutover(f.options), /database unavailable/)
  assert.deepEqual(f.events, ['prepare'])
})

test('readiness, cutover, external verification, drain and background ownership are ordered', async () => {
  const f = fixture()
  assert.equal(await cutover(f.options), true)
  assert.deepEqual(f.events, ['prepare', 'ready', 'switching', 'switchRoute', 'verify', 'draining', 'retire', 'activate', 'active'])
})

test('failed switch restores old routing and retains the candidate for in-flight requests', async () => {
  const f = fixture({ verify: async () => { throw Error('wrong SHA') } })
  await assert.rejects(cutover(f.options), /wrong SHA/)
  assert.deepEqual(f.events, ['prepare', 'ready', 'switching', 'switchRoute', 'rollbackRoute', 'rollback-draining'])
})

test('failed rollback records recovery-required instead of deleting either live process', async () => {
  const f = fixture({ switchRoute: async () => { throw Error('reload failed') }, rollbackRoute: async () => { throw Error('external config change') } })
  await assert.rejects(cutover(f.options), /reload failed/)
  assert.equal(f.events.at(-1), 'recovery-required')
  assert.ok(!f.events.includes('retire'))
})

test('drain timeout leaves both instances alive and never enables a second background worker', async () => {
  const f = fixture({ retire: async () => false })
  assert.equal(await cutover(f.options), false)
  assert.equal(f.events.at(-1), 'draining')
  assert.ok(!f.events.includes('activate'))
})

test('nginx rewrites only the intended literal loopback upstream', () => {
  const text = '# proxy_pass http://127.0.0.1:23333;\nlocation / { proxy_pass http://127.0.0.1:23333/; }\nlocation /other { proxy_pass http://127.0.0.1:23335; }'
  const output = replaceUpstream(text, 23333, 23433)
  assert.match(output, /^# proxy_pass http:\/\/127.0.0.1:23333;/)
  assert.match(output, /proxy_pass http:\/\/127.0.0.1:23433\//)
  assert.match(output, /127.0.0.1:23335;/)
  for (const input of ['proxy_pass http://backend;', 'proxy_pass http://127.0.0.1:233330;']) {
    assert.throws(() => replaceUpstream(input, 23333, 23433), /No literal/)
  }
})

test('proxy discovery refuses ambiguity and respects an explicit include', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cpu-proxy-config-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const site = path.join(root, 'site.conf'), include = path.join(root, 'proxy.conf')
  await writeFile(include, 'proxy_pass http://127.0.0.1:23333;')
  await writeFile(site, '# proxy is elsewhere')
  await assert.rejects(findProxyConfig(site, 23333), /found 0/)
  assert.equal(await findProxyConfig(site, 23333, include), include)
  if (process.platform !== 'win32') {
    await writeFile(site, `include ${include};`)
    assert.equal(await findProxyConfig(site, 23333), include)
    await writeFile(site, `include ${include};\nproxy_pass http://127.0.0.1:23333;`)
    await assert.rejects(findProxyConfig(site, 23333), /found 2/)
  }
})

test('shared uploads preserve archived samples and live contents', { skip: process.platform === 'win32' }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cpu-shared-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = path.join(root, 'live'), target = path.join(root, 'release')
  await mkdir(source)
  await mkdir(target)
  await writeFile(path.join(source, 'user.txt'), 'live user content')
  await writeFile(path.join(target, 'sample.txt'), 'archived sample')
  await linkSharedDirectory(source, target)
  assert.equal(await readFile(path.join(target, 'user.txt'), 'utf8'), 'live user content')
  assert.equal(await readFile(path.join(`${target}.packaged`, 'sample.txt'), 'utf8'), 'archived sample')
  await writeFile(path.join(target, 'new.txt'), 'new upload')
  assert.equal(await readFile(path.join(source, 'new.txt'), 'utf8'), 'new upload')
})

test('multi-file routing restores partial switches and refuses external edits before rollback', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cpu-proxy-set-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const configs = []
  for (const name of ['main', 'qqbot']) {
    const nginxConfig = path.join(root, `${name}.conf`), configBackup = path.join(root, `${name}.bak`)
    const text = `location /${name} { proxy_pass http://127.0.0.1:23333; }`
    await writeFile(nginxConfig, text)
    await writeFile(configBackup, text)
    configs.push({ nginxConfig, configBackup })
  }
  const snapshots = await configSnapshots({ configs }, 23333, 23433)
  await replaceConfig(snapshots[0].file, snapshots[0].before, snapshots[0].after)
  await restoreConfigs(snapshots)
  for (const item of snapshots) assert.equal(await readFile(item.file, 'utf8'), item.before)
  await writeFile(snapshots[0].file, snapshots[0].after)
  await writeFile(snapshots[1].file, 'external configuration')
  await assert.rejects(restoreConfigs(snapshots), /changed during deployment/)
  assert.equal(await readFile(snapshots[0].file, 'utf8'), snapshots[0].after)
  assert.equal(await readFile(snapshots[1].file, 'utf8'), 'external configuration')
  const legacy = await configSnapshots(configs[0], 23333, 23433)
  assert.deepEqual(legacy, [snapshots[0]])
})

test('HTTP 200 SPA fallbacks cannot masquerade as working JS assets or the new page entry', async t => {
  const html = '<script type="module" src="./assets/new.js"></script>'
  let correctMime = false, correctEntry = true
  const server = createServer((req, res) => {
    if (req.url === '/home') { res.setHeader('Content-Type', 'text/html'); res.end(correctEntry ? html : 'old page') }
    else { res.setHeader('Content-Type', correctMime ? 'application/javascript' : 'text/html'); res.end('') }
  })
  const port = await listen(server)
  t.after(() => close(server))
  const base = `http://127.0.0.1:${port}`
  await assert.rejects(verifyWeb(base, html), /content type/)
  correctMime = true
  await verifyWeb(base, html, { entry: true })
  correctEntry = false
  await assert.rejects(verifyWeb(base, html, { entry: true }), /does not match/)
})

test('config compare-and-swap refuses concurrent edits, and web publishing retains old chunks', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cpu-blue-green-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const config = path.join(root, 'nginx.conf')
  await writeFile(config, 'original')
  await assert.rejects(replaceConfig(config, 'stale', 'replacement'), /changed/)
  assert.equal(await readFile(config, 'utf8'), 'original')
  await replaceConfig(config, 'original', 'replacement')
  assert.equal(await readFile(config, 'utf8'), 'replacement')
  const stage = path.join(root, 'stage'), live = path.join(root, 'live')
  for (const dir of [stage, live]) await mkdir(path.join(dir, 'assets'), { recursive: true })
  await writeFile(path.join(live, 'index.html'), 'old index')
  await writeFile(path.join(live, 'assets/old.js'), 'old chunk')
  await writeFile(path.join(stage, 'index.html'), 'new index')
  await writeFile(path.join(stage, 'assets/new.js'), 'new chunk')
  await publishWebAssets(stage, live)
  assert.equal(await readFile(path.join(live, 'assets/old.js'), 'utf8'), 'old chunk')
  assert.equal(await readFile(path.join(live, 'assets/new.js'), 'utf8'), 'new chunk')
  assert.equal(await readFile(path.join(live, 'index.html'), 'utf8'), 'old index')
  await writeFile(path.join(stage, 'assets/old.js'), 'conflict')
  await assert.rejects(publishWebAssets(stage, live), /Conflicting immutable/)
  assert.equal(await readFile(path.join(live, 'assets/old.js'), 'utf8'), 'old chunk')
})

test('continuous real HTTP requests and an in-flight stream survive a route switch', async t => {
  const sha = 'a'.repeat(40)
  const old = createServer((req, res) => {
    if (req.url === '/stream') { res.write('first:'); setTimeout(() => res.end('last'), 150) }
    else res.end('old')
  })
  const next = createServer((req, res) => {
    if (req.url === '/api/ready') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: { ready: true, commit: sha } })) }
    else res.end('new')
  })
  const oldPort = await listen(old), newPort = await listen(next)
  let upstream = oldPort
  const proxy = createServer((req, res) => {
    const remote = request({ host: '127.0.0.1', port: upstream, path: req.url }, incoming => {
      res.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(res)
    })
    remote.on('error', () => { res.statusCode = 502; res.end('bad gateway') })
    req.pipe(remote)
  })
  const proxyPort = await listen(proxy), origin = `http://127.0.0.1:${proxyPort}`
  t.after(async () => { await close(proxy); await close(old); await close(next) })
  const stream = fetch(`${origin}/stream`).then(r => r.text())
  const results = []
  let collecting = true
  const reads = Promise.all(Array.from({ length: 4 }, async () => { while (collecting) { const r = await fetch(origin); results.push([r.status, await r.text()]); await tick(2) } }))
  await tick(35)
  const f = fixture({
    ready: () => probe(`http://127.0.0.1:${newPort}/api/ready`, { commit: sha }),
    switchRoute: async () => { upstream = newPort },
    verify: () => probe(`${origin}/api/ready`, { commit: sha }),
    retire: async () => { assert.equal(await stream, 'first:last'); return true },
  })
  await cutover(f.options)
  await tick(30)
  collecting = false
  await reads
  assert.ok(results.some(([, body]) => body === 'old'))
  assert.ok(results.some(([, body]) => body === 'new'))
  assert.ok(results.length >= 10)
  assert.ok(results.every(([status, body]) => status === 200 && ['old', 'new'].includes(body)))
  await assert.rejects(probe(`${origin}/api/ready`, { commit: 'b'.repeat(40), attempts: 1 }), /mismatch/)
})
