import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { cutover, probe, replaceConfig, replaceUpstream } from './blue-green-core.mjs'

const exec = promisify(execFile)
const nginx = process.env.TEST_NGINX_BIN || '/usr/sbin/nginx'
const available = process.platform === 'linux' && await exec(nginx, ['-v']).then(() => true, () => false)
if (process.env.REQUIRE_NGINX_TEST === '1' && !available) throw new Error('nginx is required for the deployment CI gate')
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

test('real nginx reload keeps concurrent requests and an old streaming response alive', { skip: !available }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cpu-nginx-cutover-'))
  const sha = 'c'.repeat(40)
  let finishStream
  const old = createServer((req, res) => {
    if (req.url === '/stream') { res.write('before:'); finishStream = () => res.end('after') }
    else res.end('old')
  })
  const next = createServer((req, res) => {
    if (req.url === '/api/ready') res.end(JSON.stringify({ data: { ready: true, commit: sha } }))
    else res.end('new')
  })
  const oldPort = await listen(old), nextPort = await listen(next)
  const reserve = createServer(), proxyPort = await listen(reserve)
  await new Promise(resolve => reserve.close(resolve))
  const config = path.join(root, 'nginx.conf')
  const before = `pid ${root}/nginx.pid; error_log ${root}/error.log; events {} http { access_log off; server { listen 127.0.0.1:${proxyPort}; location / { proxy_buffering off; proxy_pass http://127.0.0.1:${oldPort}; } } }`
  const after = replaceUpstream(before, oldPort, nextPort)
  await writeFile(config, before)
  const command = args => exec(nginx, ['-p', `${root}/`, '-c', config, ...args])
  await command([])
  t.after(async () => {
    finishStream?.()
    await command(['-s', 'quit']).catch(() => {})
    await sleep(150)
    for (const server of [old, next]) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
    await rm(root, { recursive: true, force: true })
  })
  const origin = `http://127.0.0.1:${proxyPort}`
  await probe(origin)
  const streamResponse = await fetch(`${origin}/stream`)
  const stream = streamResponse.text()
  const results = []
  let reading = true
  const collector = Promise.all(Array.from({ length: 3 }, async () => {
    while (reading) { const r = await fetch(origin); results.push([r.status, await r.text()]); await sleep(2) }
  }))
  await sleep(80)
  const phases = []
  await cutover({
    previous: { port: oldPort }, candidate: { port: nextPort },
    prepare: async () => {},
    ready: () => probe(`http://127.0.0.1:${nextPort}/api/ready`, { commit: sha }),
    persist: async state => phases.push(state.phase),
    switchRoute: async () => { await replaceConfig(config, before, after); await command(['-t']); await command(['-s', 'reload']) },
    verify: () => probe(`${origin}/api/ready`, { commit: sha, delayMs: 50 }),
    rollbackRoute: async () => { await replaceConfig(config, after, before); await command(['-s', 'reload']) },
    retire: async () => { finishStream(); assert.equal(await stream, 'before:after'); return true },
    activate: async () => {},
  })
  await sleep(80)
  reading = false
  await collector
  assert.ok(results.length > 10)
  assert.ok(results.some(([, body]) => body === 'old'))
  assert.ok(results.some(([, body]) => body === 'new'))
  assert.ok(results.every(([status, body]) => status === 200 && ['old', 'new'].includes(body)))
  assert.deepEqual(phases, ['switching', 'draining', 'active'])
})
