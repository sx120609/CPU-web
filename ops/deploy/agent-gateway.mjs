import { readFile } from 'node:fs/promises'

export async function readGateway(directory, fetcher = fetch, { requireReady = true } = {}) {
  const settings = JSON.parse(await readFile(`${directory}/agent-gateway.json`, 'utf8'))
  if (!Number.isInteger(settings.port) || settings.port < 1024 || settings.port > 65535
    || !Array.isArray(settings.requiredAgents) || !settings.requiredAgents.length
    || settings.requiredAgents.some(id => typeof id !== 'string' || !id)) throw new Error('Invalid persistent Agent gateway settings')
  const secretFile = `${directory}/agent-gateway.secret`
  const secret = (await readFile(secretFile, 'utf8')).trim()
  if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('Invalid persistent Agent gateway secret')
  if (!Array.isArray(settings.nginxConfigs) || !settings.nginxConfigs.length
    || !/^\/[A-Za-z0-9/_-]+$/.test(settings.agentPath || '')) throw new Error('Persistent Agent gateway routing is not recorded')
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const route = new RegExp(`location\\s*=\\s*${escape(settings.agentPath)}\\s*\\{[^{}]*proxy_pass\\s+http://127\\.0\\.0\\.1:${settings.port}\\s*;[^{}]*\\}`)
  for (const file of settings.nginxConfigs) {
    const config = (await readFile(file, 'utf8')).split('\n').filter(line => !/^\s*#/.test(line)).join('\n')
    if (!route.test(config)) throw new Error('Agent WebSocket must route directly to the persistent gateway')
  }
  const response = await fetcher(`http://127.0.0.1:${settings.port}/snapshot`, {
    headers: { authorization: `Bearer ${secret}` }, redirect: 'error', signal: AbortSignal.timeout(3000),
  })
  const snapshot = await response.json()
  if (!response.ok || snapshot.protocol !== 1 || !snapshot.instance) throw new Error('Persistent Agent gateway is unavailable')
  for (const id of settings.requiredAgents) {
    if (!Object.hasOwn(snapshot.agents || {}, id)) throw new Error(`Required Agent ${id} is not configured on the gateway`)
    if (!requireReady) continue
    if (!snapshot.agents?.[id]?.ready || !snapshot.agents[id].jwxtEnabled
      || !snapshot.recipients?.some(item => item.agentId === id && item.publicKey)) {
      throw new Error(`Agent ${id} is not ready on the persistent gateway; active service is retained`)
    }
  }
  return { port: settings.port, secretFile, instance: snapshot.instance, requiredAgents: settings.requiredAgents }
}

export async function awaitGatewayMigration(directory, expected, { timeoutMs = 300000, read = readGateway, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now } = {}) {
  const deadline = now() + timeoutMs
  let lastError
  do {
    try { assertSameGateway(expected, await read(directory)); return }
    catch (error) { lastError = error }
    await sleep(1000)
  } while (now() < deadline)
  throw new Error(`Initial Agent migration is not ready; no API cutover occurred: ${lastError?.message}`)
}

export function assertSameGateway(before, after) {
  if (before.instance !== after.instance || before.port !== after.port
    || JSON.stringify(before.requiredAgents) !== JSON.stringify(after.requiredAgents)) {
    throw new Error('Agent gateway changed during deployment; refusing cutover')
  }
}

export async function waitForUpstreamIdle(port, timeoutSeconds, { connections, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now } = {}) {
  const deadline = now() + timeoutSeconds * 1000
  let idleSince = null
  do {
    if (await connections(port)) idleSince = null
    else if (idleSince === null) idleSince = now()
    // Old nginx generations can remain alive solely for the independent gateway.
    // Only retire after this upstream has had no connections for a quiet period.
    if (idleSince !== null && now() - idleSince >= 5000) return true
    await sleep(500)
  } while (now() < deadline)
  return false
}
