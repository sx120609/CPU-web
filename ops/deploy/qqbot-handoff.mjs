import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { atomicWrite } from './blue-green-core.mjs'

async function status(release, fetcher) {
  const response = await fetcher(`http://127.0.0.1:${release.port}/api/ready`, { signal: AbortSignal.timeout(3000) })
  const data = (await response.json()).data
  if (!response.ok || !data?.ready || data.commit !== release.commit || data.qqbot?.protocol !== 1) {
    throw new Error('QQBot deployment readiness is unavailable; retaining both releases')
  }
  return data.qqbot
}

export async function prepareQqBotHandoff(previous, candidate, { fetcher = fetch, read = readFile, write = atomicWrite } = {}) {
  if (!previous.qqbotDrainFile) return null
  const file = path.join(candidate.release, 'qqbot-handoff.json')
  let plan
  try { plan = JSON.parse(await read(file, 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  if (!plan) {
    const old = await status(previous, fetcher)
    await status(candidate, fetcher)
    plan = { previous: previous.id, successor: candidate.id, required: Boolean(old.inboundConfigured && old.connected) }
    await write(file, JSON.stringify(plan))
  }
  if (plan.previous !== previous.id || plan.successor !== candidate.id || typeof plan.required !== 'boolean') {
    throw new Error('QQBot handoff record does not match this deployment')
  }
  await write(previous.qqbotDrainFile, JSON.stringify({ release: previous.id, successor: candidate.id }))
  return plan
}

export async function verifyQqBotHandoff(plan, candidate, timeoutSeconds, { fetcher = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now } = {}) {
  if (!plan?.required) return
  const deadline = now() + timeoutSeconds * 1000
  do {
    const current = await status(candidate, fetcher)
    if (current.inboundConfigured && current.connected && !current.closing) return
    await sleep(500)
  } while (now() < deadline)
  throw new Error('QQBot has not reconnected to the candidate; retaining both releases for recovery')
}
