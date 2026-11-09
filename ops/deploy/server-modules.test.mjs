import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { sha256File } from './artifact-manifest.mjs'
import {
  SERVER_MODULES_MARKER, SERVER_MODULES_REQUIRED, installServerModules, pruneServerModules,
  readServerModulesEntry, serverModulesFileName, serverModulesKey,
} from './server-modules.mjs'

const unix = process.platform !== 'win32'
const run = async (command, args, options = {}) => ({ stdout: execFileSync(command, args, { encoding: 'utf8', ...options }) })

function serverFixture(root, { lock = '{"lockfileVersion":3}\n', scripts = {}, schema = 'model A { id Int @id }\n' } = {}) {
  const server = path.join(root, 'server')
  mkdirSync(path.join(server, 'prisma'), { recursive: true })
  writeFileSync(path.join(server, 'package.json'), JSON.stringify({ name: 'server', scripts, dependencies: { express: '^5.0.0' } }))
  writeFileSync(path.join(server, 'package-lock.json'), lock)
  writeFileSync(path.join(server, '.npmrc'), 'onnxruntime-node-install=skip\n')
  writeFileSync(path.join(server, 'prisma', 'schema.prisma'), schema)
  return server
}

test('the dependency key follows dependencies, lockfile and schema, not scripts or line endings', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cpu-modules-key-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const base = await serverModulesKey(serverFixture(path.join(root, 'a')))
  assert.match(base, /^[a-f0-9]{64}$/)
  assert.equal(await serverModulesKey(serverFixture(path.join(root, 'b'), { scripts: { dev: 'tsx watch' } })), base)
  assert.equal(await serverModulesKey(serverFixture(path.join(root, 'c'), { lock: '{"lockfileVersion":3}\r\n' })), base)
  assert.notEqual(await serverModulesKey(serverFixture(path.join(root, 'd'), { lock: '{"lockfileVersion":3,"x":1}\n' })), base)
  assert.notEqual(await serverModulesKey(serverFixture(path.join(root, 'e'), { schema: 'model B { id Int @id }\n' })), base)
})

test('manifest entries must be content-addressed linux-x64 archives', () => {
  const sha = 'a'.repeat(64)
  const entry = { key: 'b'.repeat(64), file: serverModulesFileName(sha), sha256: sha, bytes: 10, platform: 'linux-x64' }
  assert.deepEqual(readServerModulesEntry({ serverModules: entry }), entry)
  assert.equal(readServerModulesEntry({}), null)
  assert.throws(() => readServerModulesEntry({ serverModules: { ...entry, file: 'modules.tar.gz' } }), /content-addressed/)
  assert.throws(() => readServerModulesEntry({ serverModules: { ...entry, platform: 'win32-x64' } }), /platform/)
  assert.throws(() => readServerModulesEntry({ serverModules: { ...entry, sha256: 'nope' } }), /invalid/)
})

async function archiveFixture(root, key) {
  const source = path.join(root, 'source')
  for (const required of SERVER_MODULES_REQUIRED) {
    mkdirSync(path.dirname(path.join(source, 'node_modules', required)), { recursive: true })
    writeFileSync(path.join(source, 'node_modules', required), required)
  }
  writeFileSync(path.join(source, 'node_modules', SERVER_MODULES_MARKER), `${key}\n`)
  const archive = path.join(root, 'modules.tar.gz')
  execFileSync('tar', ['-czf', archive, '-C', source, 'node_modules'])
  const sha256 = await sha256File(archive)
  return { archive, entry: { key, file: serverModulesFileName(sha256), sha256, bytes: statSync(archive).size, platform: 'linux-x64' } }
}

test('releases receive hard links to dependencies unpacked once per key', { skip: !unix }, async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cpu-modules-install-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const stateDir = path.join(root, 'state')
  const key = 'c'.repeat(64)
  const { archive, entry } = await archiveFixture(root, key)
  const logs = []
  const release = name => { const dir = path.join(stateDir, 'releases', name, 'server'); mkdirSync(dir, { recursive: true }); return dir }

  const first = release('one')
  await installServerModules({ stateDir, entry, expectedKey: key, archive, serverDir: first, run, log: line => logs.push(line) })
  const store = path.join(stateDir, 'server-modules', key, 'node_modules', '.prisma/client/index.js')
  const linked = path.join(first, 'node_modules', '.prisma/client/index.js')
  assert.equal(statSync(linked).ino, statSync(store).ino, 'release files are hard links into the store')
  assert.equal(existsSync(archive), false, 'the downloaded archive is dropped once unpacked')

  // A second release with the same key needs no archive at all.
  const second = release('two')
  await installServerModules({ stateDir, entry, expectedKey: key, archive: '', serverDir: second, run, log: line => logs.push(line) })
  assert.equal(readFileSync(path.join(second, 'node_modules', SERVER_MODULES_MARKER), 'utf8').trim(), key)
  assert.match(logs.at(-1), /Reusing prebuilt server dependencies/)

  await assert.rejects(installServerModules({ stateDir, entry, expectedKey: 'd'.repeat(64), archive: '', serverDir: release('three'), run, log() {} }), /this release needs/)
})

test('a tampered or missing archive never reaches a release', { skip: !unix }, async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cpu-modules-tamper-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const stateDir = path.join(root, 'state')
  const key = 'e'.repeat(64)
  const { archive, entry } = await archiveFixture(root, key)
  const serverDir = path.join(root, 'release', 'server')
  mkdirSync(serverDir, { recursive: true })
  await assert.rejects(installServerModules({ stateDir, entry, expectedKey: key, archive: '', serverDir, run, log() {} }), /neither on this host nor downloaded/)
  writeFileSync(archive, Buffer.concat([readFileSync(archive), Buffer.from('x')]))
  await assert.rejects(installServerModules({ stateDir, entry, expectedKey: key, archive, serverDir, run, log() {} }), /size mismatch/)
  assert.equal(existsSync(path.join(serverDir, 'node_modules')), false)
  assert.equal(existsSync(path.join(stateDir, 'server-modules', key)), false)
})

test('unused dependency sets are pruned, the ones releases still link to are kept', { skip: !unix }, async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cpu-modules-prune-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const stateDir = path.join(root, 'state')
  for (const key of ['1', '2', '3'].map(digit => digit.repeat(64))) mkdirSync(path.join(stateDir, 'server-modules', key, 'node_modules'), { recursive: true })
  const used = path.join(stateDir, 'releases', 'r1', 'server', 'node_modules')
  mkdirSync(used, { recursive: true })
  writeFileSync(path.join(used, SERVER_MODULES_MARKER), `${'2'.repeat(64)}\n`)
  assert.deepEqual(await pruneServerModules(stateDir, '3'.repeat(64)), ['1'.repeat(64)])
})

test('deploy.sh refuses an artifact without prebuilt dependencies and skips the download when the host has them', { skip: !unix }, t => {
  const deploy = readFileSync(new URL('../../deploy.sh', import.meta.url), 'utf8')
  const prepare = deploy.match(/prepare_server_modules\(\) \{[\s\S]*?\n\}/)[0]
  const root = mkdtempSync(path.join(os.tmpdir(), 'cpu-modules-prepare-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const key = 'f'.repeat(64)
  const script = `set -eu
    log() { echo "log: $*"; }; err() { echo "err: $*"; exit 37; }
    fetch_ci_artifact_release_transport() { echo fetched; return 1; }
    node() { printf '%s' "$MODULES_INFO"; }
    ROOT_DIR="$ROOT"; DEPLOY_ARTIFACT_DIR="$ROOT/artifact"
    ${prepare}
    prepare_server_modules
    echo "archive=[$DEPLOY_SERVER_MODULES_ARCHIVE]"`
  const exec = info => {
    try {
      return { status: 0, stdout: execFileSync('bash', ['-c', script], { env: { ...process.env, ROOT: root, MODULES_INFO: info }, encoding: 'utf8' }) }
    } catch (error) {
      return { status: error.status, stdout: String(error.stdout) }
    }
  }
  const missing = exec('')
  assert.equal(missing.status, 37)
  assert.match(missing.stdout, /没有 CI 预装的服务端依赖/)

  mkdirSync(path.join(root, '.deploy', 'blue-green', 'server-modules', key), { recursive: true })
  writeFileSync(path.join(root, '.deploy', 'blue-green', 'server-modules', key, '.complete'), 'x')
  const present = exec(`${key} ${serverModulesFileName('a'.repeat(64))} ${'a'.repeat(64)} 100\n`)
  assert.equal(present.status, 0)
  assert.doesNotMatch(present.stdout, /fetched/)
  assert.match(present.stdout, /archive=\[\]/)
})
