import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { updateManagedAgent, validateManagedConfig } from '../../ops/deploy/managed-agent-update.mjs'
import { createArtifactManifest } from '../../ops/deploy/artifact-manifest.mjs'

// Directory symlinks are required by the production updater; exercise it on Linux CI.
const skip = process.platform === 'win32'
const commit = 'a'.repeat(40), oldCommit = 'b'.repeat(40)

async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'managed-agent-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const previous = path.join(root, 'releases/previous')
  const payload = path.join(root, 'payload')
  const bundle = path.join(root, 'bundle')
  const requestFile = path.join(root, 'state/agent-remote-update.request')
  for (const dir of [path.join(previous, 'server/dist'), path.join(payload, 'dist'), bundle, path.dirname(requestFile)]) {
    await mkdir(dir, { recursive: true })
  }
  await writeFile(path.join(previous, 'server/dist/deployment-commit.txt'), oldCommit)
  await writeFile(path.join(previous, 'server/dist/jwxtAgent.js'), 'previous')
  await symlink(previous, path.join(root, 'current'), 'dir')
  await writeFile(requestFile, 'ignored request content; never a command or URL')
  await writeFile(path.join(payload, 'dist/jwxtAgent.js'), 'new agent')
  await writeFile(path.join(payload, 'dist/deployment-commit.txt'), options.marker || commit)
  const tar = (cwd, args) => execFileSync('tar', args, { cwd, encoding: 'utf8' }).trim()
  tar(payload, ['-czf', path.join(bundle, 'server-dist.tar.gz'), 'dist'])
  for (const file of ['web-dist.tar.gz', 'voicehub-output.tar.gz']) await writeFile(path.join(bundle, file), 'unused')
  const manifest = await createArtifactManifest({ commit: options.manifest || commit, directory: bundle })
  manifest.nodeMajor = 24
  await writeFile(path.join(bundle, 'manifest.json'), JSON.stringify(manifest))
  const archive = path.join(root, 'archive.tar.gz')
  tar(bundle, ['-czf', archive, 'manifest.json', 'server-dist.tar.gz', 'web-dist.tar.gz', 'voicehub-output.tar.gz'])
  const calls = []
  let registration = 0
  const config = { root, node: '/opt/node24/bin/node', service: 'jwxt-agent-test.service', requestFile }
  const dependencies = {
    resolveCommit: async () => commit,
    download: async (url, file) => {
      calls.push(['download', url])
      if (options.noArtifact) throw new Error('missing artifact')
      if (url.includes('/releases/')) return copyFile(archive, file)
      assert.ok(url.startsWith('https://api.github.com/repos/sx120609/CPU-web/contents/server/'))
      assert.ok(url.endsWith(`?ref=${commit}`))
      await writeFile(file, '{}')
    },
    execute: async (command, args, opts) => {
      calls.push([command, ...args])
      if (command === 'tar') return tar(opts?.cwd || root, args)
      if (options.dependenciesFail && args.includes('ci')) throw new Error('dependency preparation failed')
      return ''
    },
    confirmReady: async () => {
      registration++
      if (options.registrationFail && registration === 1) throw new Error('new Agent did not register')
    },
  }
  return { root, previous, config, dependencies, calls }
}

test('managed Agent stages a verified artifact before restarting and removes the request', { skip }, async t => {
  const f = await fixture(t)
  const result = await updateManagedAgent(f.config, f.dependencies)
  assert.equal(result.commit, commit)
  assert.equal(await realpath(path.join(f.root, 'current')), result.release)
  assert.equal(await readFile(path.join(f.previous, 'server/dist/jwxtAgent.js'), 'utf8'), 'previous')
  const npm = f.calls.findIndex(call => call.includes('ci'))
  const restart = f.calls.findIndex(call => call[0] === 'systemctl')
  assert.ok(npm >= 0 && restart > npm)
  assert.ok(f.calls[npm].includes('--ignore-scripts'))
  assert.equal(JSON.parse(await readFile(path.join(f.root, 'state/agent-remote-update.status.json'))).phase, 'success')
  await assert.rejects(readFile(f.config.requestFile), { code: 'ENOENT' })
})

for (const [name, options, error] of [
  ['missing exact-SHA artifact', { noArtifact: true }, /artifact is unavailable/],
  ['wrong manifest SHA', { manifest: oldCommit }, /commit mismatch/],
  ['wrong build marker', { marker: oldCommit }, /build marker/],
  ['dependency failure', { dependenciesFail: true }, /dependency preparation/],
]) test(`managed Agent preserves its running release on ${name}`, { skip }, async t => {
  const f = await fixture(t, options)
  await assert.rejects(updateManagedAgent(f.config, f.dependencies), error)
  assert.equal(await realpath(path.join(f.root, 'current')), f.previous)
  assert.equal(f.calls.filter(call => call[0] === 'systemctl').length, 0)
  assert.equal(JSON.parse(await readFile(path.join(f.root, 'state/agent-remote-update.status.json'))).phase, 'failed')
  await assert.rejects(readFile(f.config.requestFile), { code: 'ENOENT' })
})

test('managed Agent rolls back and re-registers the old release after a failed new registration', { skip }, async t => {
  const f = await fixture(t, { registrationFail: true })
  await assert.rejects(updateManagedAgent(f.config, f.dependencies), /did not register/)
  assert.equal(await realpath(path.join(f.root, 'current')), f.previous)
  assert.equal(f.calls.filter(call => call[0] === 'systemctl').length, 2)
  assert.equal(JSON.parse(await readFile(path.join(f.root, 'state/agent-remote-update.status.json'))).rolledBack, true)
})

test('an already current Agent accepts remote update without downloading or restarting', { skip }, async t => {
  const f = await fixture(t)
  await writeFile(path.join(f.previous, 'server/dist/deployment-commit.txt'), commit)
  const result = await updateManagedAgent(f.config, f.dependencies)
  assert.equal(result.alreadyCurrent, true)
  assert.equal(f.calls.length, 0)
  assert.equal(await realpath(path.join(f.root, 'current')), f.previous)
  await assert.rejects(readFile(f.config.requestFile), { code: 'ENOENT' })
})

test('managed updater never accepts an arbitrary systemd unit or installation root', () => {
  assert.throws(() => validateManagedConfig({ root: '/', node: '/bin/node', requestFile: '/tmp/agent-remote-update.request', service: 'jwxt-agent-test.service' }))
  assert.throws(() => validateManagedConfig({ root: '/opt/agent', node: '/bin/node', requestFile: '/tmp/agent-remote-update.request', service: 'sshd.service' }))
})
