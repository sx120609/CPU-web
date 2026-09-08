import { readFile } from 'node:fs/promises'
import path from 'node:path'

const file = path.join(process.argv[2], '.deploy/blue-green/state.json')
try {
  const state = JSON.parse(await readFile(file, 'utf8'))
  if (!['active', 'draining'].includes(state.phase)) throw new Error(`Deployment is ${state.phase}; recover it with update before managing the runtime`)
  const active = state.active || state.candidate
  if (![active.name, active.voiceName].every(name => /^[a-zA-Z0-9-]+$/.test(name))
    || ![active.port, active.voicePort].every(port => Number.isInteger(port) && port > 1023 && port < 65536)) throw new Error('Invalid managed runtime state')
  console.log(`${active.name} ${active.port} ${active.voiceName} ${active.voicePort}`)
} catch (error) {
  if (error.code !== 'ENOENT') { console.error(error.message); process.exitCode = 1 }
}
