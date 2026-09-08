import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer, get } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
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
  const writes = new Map()
  const writeResponse = (req, res, version) => {
    if (req.method !== 'POST' || req.url !== '/write') return false
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => { writes.set(body, (writes.get(body) || 0) + 1); res.end(version) })
    return true
  }
  let finishStream
  const old = createServer((req, res) => {
    if (writeResponse(req, res, 'old')) return
    if (req.url === '/stream') { res.write('before:'); finishStream = () => res.end('after') }
    else res.end('old')
  })
  const next = createServer((req, res) => {
    if (writeResponse(req, res, 'new')) return
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
  const require = createRequire(import.meta.url)
  const { chromium } = require(path.join(process.env.DEPLOY_TEST_PLAYWRIGHT_ROOT, 'node_modules/playwright'))
  const browser = await chromium.launch({ headless: true })
  t.after(async () => {
    await browser.close()
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
  const page = await browser.newPage()
  await page.goto(origin)
  await page.evaluate(() => {
    window.results = []; window.reading = true
    window.collector = Promise.all(Array.from({ length: 3 }, async (_, worker) => {
      let sequence = 0
      while (window.reading) {
        const id = `${worker}-${sequence++}`
        try {
          const response = await fetch('/write', { method: 'POST', body: id, cache: 'no-store' })
          window.results.push([response.status, await response.text(), id])
          const read = await fetch('/', { cache: 'no-store' })
          window.results.push([read.status, await read.text()])
        } catch (error) { window.results.push([0, String(error), id]) }
        await new Promise(resolve => setTimeout(resolve, 2))
      }
    }))
  })
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
  // Existing keep-alive connections are allowed to keep using the old worker.
  // Verify the new generation through fresh TCP connections as well.
  for (let index = 0; index < 10; index++) {
    const result = await new Promise((resolve, reject) => {
      get(origin, { agent: false }, response => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', chunk => { body += chunk })
        response.on('end', () => resolve([response.statusCode, body]))
        response.on('error', reject)
      }).on('error', reject)
    })
    results.push(result)
  }
  await sleep(80)
  results.push(...await page.evaluate(async () => { window.reading = false; await window.collector; return window.results }))
  assert.ok(results.length > 10)
  assert.ok(results.some(([, body]) => body === 'old'))
  assert.ok(results.some(([, body]) => body === 'new'))
  assert.ok(results.every(([status, body]) => status === 200 && ['old', 'new'].includes(body)))
  for (const [, , id] of results) if (id) assert.equal(writes.get(id), 1, `POST ${id} must be processed exactly once`)
  assert.deepEqual(phases, ['switching', 'draining', 'active'])
})
