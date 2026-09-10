import assert from 'node:assert/strict'
import test from 'node:test'
import { assertSameGateway, waitForUpstreamIdle, readGateway, awaitGatewayMigration } from './agent-gateway.mjs'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

test('migration gate requires both configured Agents, their keys, and a direct nginx route', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gateway-gate-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const nginx = path.join(directory, 'nginx.conf')
  await writeFile(nginx, 'location = /agent { proxy_pass http://127.0.0.1:23633; }')
  await writeFile(path.join(directory, 'agent-gateway.secret'), 'a'.repeat(64))
  await writeFile(path.join(directory, 'agent-gateway.json'), JSON.stringify({ port: 23633, agentPath: '/agent', nginxConfigs: [nginx], requiredAgents: ['a', 'b'] }))
  const snapshot = { protocol: 1, instance: 'stable', agents: { a: { ready: true, jwxtEnabled: true }, b: { ready: false, jwxtEnabled: true } }, recipients: [{ agentId: 'a', publicKey: 'key-a' }, { agentId: 'b', publicKey: 'key-b' }] }
  const fetcher = async () => ({ ok: true, json: async () => snapshot })
  await assert.rejects(readGateway(directory, fetcher), /Agent b is not ready/)
  assert.equal((await readGateway(directory, fetcher, { requireReady: false })).instance, 'stable')
  snapshot.agents.b.ready = true
  assert.equal((await readGateway(directory, fetcher)).instance, 'stable')
  await writeFile(nginx, '# location = /agent { proxy_pass http://127.0.0.1:23633; }')
  await assert.rejects(readGateway(directory, fetcher), /route directly/)
})

test('approved initial migration waits for the same complete gateway before API cutover', async () => {
  let time = 0
  const gateway = { instance: 'one', port: 23633, requiredAgents: ['a', 'b'] }
  const options = { timeoutMs: 5000, now: () => time, sleep: async ms => { time += ms }, read: async () => {
    if (time < 2000) throw new Error('b is offline')
    return gateway
  } }
  await awaitGatewayMigration('/unused', gateway, options)
  assert.equal(time, 2000)
  time = 0
  await assert.rejects(awaitGatewayMigration('/unused', gateway, { ...options, read: async () => ({ ...gateway, instance: 'changed' }) }), /no API cutover occurred/)
})

test('gateway replacement or baseline edits prevent cutover', () => {
  const before = { instance: 'one', port: 23633, requiredAgents: ['a', 'b'] }
  assertSameGateway(before, { ...before })
  assert.throws(() => assertSameGateway(before, { ...before, instance: 'two' }))
  assert.throws(() => assertSameGateway(before, { ...before, requiredAgents: ['a'] }))
})
test('unrelated gateway connections do not block retirement; an old upstream stream does', async () => {
  let time = 0
  const options = { now: () => time, sleep: async ms => { time += ms }, connections: async port => { assert.equal(port, 23433); return time < 4000 } }
  assert.equal(await waitForUpstreamIdle(23433, 12, options), true)
  assert.ok(time >= 9000)
  time = 0
  assert.equal(await waitForUpstreamIdle(23433, 12, { ...options, connections: async () => true }), false)
})
