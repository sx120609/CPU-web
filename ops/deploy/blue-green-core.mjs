import { readFile, rename, writeFile, stat } from 'node:fs/promises'

export function runtimeEnvironment(environment) {
  return Object.fromEntries(Object.entries(environment).filter(([key]) => !/^DEPLOY_|^CPU_WEB_UPDATE_|^CPU_WEB_ADMIN_DEPLOY$/.test(key)))
}

export async function atomicWrite(file, contents, mode = 0o600) {
  const temporary = `${file}.tmp-${process.pid}`
  await writeFile(temporary, contents, { mode })
  await rename(temporary, file)
}

export function replaceUpstream(config, from, to) {
  for (const port of [from, to]) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid upstream port')
  }
  let matches = 0
  const result = config.split('\n').map(line => {
    // Only a literal proxy_pass in the explicitly selected file is managed.
    if (/^\s*#/.test(line)) return line
    return line.replace(new RegExp(`(\\bproxy_pass\\s+http://(?:127\\.0\\.0\\.1|localhost):)${from}(?=[/;\\s])`, 'g'), (_, prefix) => {
      matches++
      return `${prefix}${to}`
    })
  }).join('\n')
  if (!matches) throw new Error(`No literal proxy_pass to port ${from}; set DEPLOY_NGINX_CONFIG to the main site's actual proxy include`)
  return result
}

export async function probe(url, { commit, attempts = 30, delayMs = 1000, fetcher = fetch } = {}) {
  let lastError
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(3000), redirect: 'error' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      if (commit) {
        const body = await response.json()
        if (body?.data?.ready !== true || body.data.commit !== commit) throw new Error('Readiness/commit mismatch')
      } else await response.arrayBuffer()
      return
    } catch (error) { lastError = error }
    if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, delayMs))
  }
  throw new Error(`Probe failed for ${url}: ${lastError?.message}`)
}

// Persist the intent BEFORE reloading nginx. A killed deployment must leave
// enough information to retain both processes and recover on the next run.
export async function cutover({ previous, candidate, prepare, ready, switchRoute, verify, rollbackRoute, persist, retire, activate }) {
  await prepare()
  await ready()
  await persist({ phase: 'switching', previous, candidate })
  try {
    await switchRoute()
    await verify()
  } catch (error) {
    try {
      await rollbackRoute()
      await persist({ phase: 'rollback-draining', previous, candidate, error: error.message })
    } catch (rollbackError) {
      await persist({ phase: 'recovery-required', previous, candidate, error: `${error.message}; rollback: ${rollbackError.message}` })
    }
    // Either nginx generation can still have requests in flight. Never kill
    // the candidate here, even if restoring the previous configuration worked.
    throw error
  }
  await persist({ phase: 'draining', previous, candidate })
  if (!await retire(previous)) return false
  await activate(candidate)
  await persist({ phase: 'active', active: candidate })
  return true
}

export async function replaceConfig(file, expected, replacement) {
  if (await readFile(file, 'utf8') !== expected) throw new Error('Nginx configuration changed during deployment; refusing to overwrite it')
  const mode = (await stat(file)).mode & 0o777
  await atomicWrite(file, replacement, mode)
}
