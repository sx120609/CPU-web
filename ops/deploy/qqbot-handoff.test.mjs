import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareQqBotHandoff, verifyQqBotHandoff } from './qqbot-handoff.mjs'

const previous = { id: 'old', port: 23433, commit: 'sha-old', qqbotDrainFile: '/old/drain.json' }
const candidate = { id: 'new', port: 23434, commit: 'sha-new', release: '/new' }
const response = (commit, connected = true) => ({ ok: true, json: async () => ({ data: { ready: true, commit, qqbot: { protocol: 1, inboundConfigured: true, connected, closing: false } } }) })

test('records required reconnection before signaling old process and preserves it on recovery', async () => {
  const files = new Map()
  const writes = []
  const dependencies = {
    read: async file => { if (!files.has(file)) throw Object.assign(new Error(), { code: 'ENOENT' }); return files.get(file) },
    write: async (file, value) => { writes.push(file); files.set(file, value) },
    fetcher: async url => response(url.includes('23433') ? previous.commit : candidate.commit),
  }
  const plan = await prepareQqBotHandoff(previous, candidate, dependencies)
  assert.equal(plan.required, true)
  assert.equal(writes[1], previous.qqbotDrainFile)
  assert.deepEqual(JSON.parse(files.get(previous.qqbotDrainFile)), { release: 'old', successor: 'new' })
  const recovered = await prepareQqBotHandoff(previous, candidate, { ...dependencies, fetcher: async () => { throw new Error('must retain persisted requirement') } })
  assert.deepEqual(recovered, plan)
});

test('never requests reconnection if candidate readiness is invalid', async () => {
  let writes = 0
  await assert.rejects(prepareQqBotHandoff(previous, candidate, {
    read: async () => { throw Object.assign(new Error(), { code: 'ENOENT' }) },
    write: async () => { writes++ },
    fetcher: async () => response(previous.commit),
  }), /readiness/)
  assert.equal(writes, 0)
});

test('retains old release until NapCat reconnects to the expected candidate', async () => {
  let time = 0, reads = 0
  await verifyQqBotHandoff({ required: true }, candidate, 5, {
    fetcher: async () => response(candidate.commit, ++reads === 3),
    now: () => time, sleep: async ms => { time += ms },
  })
  assert.equal(reads, 3)
  await assert.rejects(verifyQqBotHandoff({ required: true }, candidate, 1, {
    fetcher: async () => response(candidate.commit, false),
    now: () => time, sleep: async ms => { time += ms },
  }), /not reconnected/)
});
