import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import dotenv from 'dotenv'
import { installAgentArtifact } from '../../ops/deploy/install-agent-artifact.mjs'

const server = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
dotenv.config({ path: path.join(server, '.env') })
const run = (script, args = []) => execFileSync(process.execPath, [script, ...args], { cwd: server, stdio: 'inherit', windowsHide: true })

run(require.resolve('prisma/build/index.js'), ['generate'])
// 旧版 Windows 更新器拉取代码后执行 npm build，在这里接入制品以支持首次滚动升级。
if (process.env.NODE_ENV === 'production' && (process.env.JWXT_AGENT_SERVER || process.env.LOGIN_AGENT_SERVER)) {
  await installAgentArtifact(path.dirname(server))
} else {
  run(require.resolve('typescript/bin/tsc'), ['-p', 'tsconfig.json'])
  run(path.join(server, 'scripts/copy-desktop-userscripts.mjs'))
}
