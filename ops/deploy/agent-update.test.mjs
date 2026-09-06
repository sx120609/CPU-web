import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { installAgentArtifact, validateArchiveEntries } from './install-agent-artifact.mjs'
import { createArtifactManifest, writeArtifactManifest } from './artifact-manifest.mjs'

const deploy = readFileSync(new URL('../../deploy.sh', import.meta.url), 'utf8')
const agentUpdate = deploy.match(/do_agent_update\(\) \{[\s\S]*?\n\}/)[0]

test('Agent update publishes verified artifact without compiling and stops on a missing artifact', { skip: process.platform === 'win32' }, () => {
  const stubs = `
    log() { :; }; warn() { :; }; err() { exit 37; }
    ensure_agent_env() { :; }; git() { echo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; }
    download_ci_artifact() { echo verify; return "$ARTIFACT_FAILURE"; }
    do_install_server() { echo dependencies; }; do_generate_prisma() { echo prisma; }
    do_build_agent() { exit 99; }; do_build_server() { exit 99; }
    publish_ci_server_artifact() { echo publish; }; do_agent_restart() { echo restart; }
    commit_ci_artifact_publish() { echo commit; }
  `
  const script = `set -e\ncd /tmp\n${stubs}\n${agentUpdate}\ndo_agent_update`
  assert.equal(execFileSync('bash', ['-c', script], { env: { ...process.env, ARTIFACT_FAILURE: '0' }, encoding: 'utf8' }).trim(), 'verify\ndependencies\nprisma\npublish\nrestart\ncommit')
  assert.throws(() => execFileSync('bash', ['-c', script], { env: { ...process.env, ARTIFACT_FAILURE: '1' }, encoding: 'utf8' }), error => error.status === 37 && error.stdout.trim() === 'verify')
})

test('Agent artifact extraction rejects traversal, links and missing entrypoints', () => {
  validateArchiveEntries('dist/\ndist/jwxtAgent.js\n', 'drwx dist/\n-rwx dist/jwxtAgent.js', true)
  for (const [names, details] of [
    ['dist/../escape', '-rwx dist/../escape'],
    ['dist/jwxtAgent.js', 'lrwx dist/jwxtAgent.js -> elsewhere'],
    ['dist/only.js', '-rwx dist/only.js'],
  ]) assert.throws(() => validateArchiveEntries(names, details, true))
})

test('Agent installs a real verified bundle and preserves the running files on a SHA mismatch', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cpu-agent-artifact-test-'))
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const tar = (cwd, ...args) => execFileSync('tar', args, { cwd, windowsHide: true })
  try {
    const repo = path.join(root, 'agent')
    const origin = path.join(root, 'origin')
    const bundle = path.join(root, 'bundle')
    const payload = path.join(root, 'payload')
    for (const directory of [repo, origin, bundle, path.join(payload, 'dist'), path.join(repo, 'server', 'dist')]) mkdirSync(directory, { recursive: true })
    for (const directory of [repo, origin]) {
      git(directory, 'init')
      git(directory, 'config', 'user.name', 'Artifact Test')
      git(directory, 'config', 'user.email', 'artifact-test@example.invalid')
    }
    git(repo, 'commit', '--allow-empty', '-m', 'source')
    const commit = git(repo, 'rev-parse', 'HEAD')
    git(repo, 'remote', 'add', 'origin', origin)
    git(origin, 'checkout', '-b', 'deploy-artifacts')
    writeFileSync(path.join(repo, 'server/dist/jwxtAgent.js'), 'previous')
    writeFileSync(path.join(payload, 'dist/jwxtAgent.js'), 'new-agent')
    writeFileSync(path.join(payload, 'dist/deployment-commit.txt'), commit)
    tar(payload, '-czf', path.join(bundle, 'server-dist.tar.gz'), 'dist')
    for (const name of ['web-dist.tar.gz', 'voicehub-output.tar.gz']) writeFileSync(path.join(bundle, name), 'unused-by-agent')
    const publish = async expected => {
      writeArtifactManifest(path.join(bundle, 'manifest.json'), await createArtifactManifest({ commit: expected, directory: bundle }))
      tar(bundle, '-czf', path.join(origin, 'cpu-web-linux-deploy.tar.gz'), 'manifest.json', 'server-dist.tar.gz', 'web-dist.tar.gz', 'voicehub-output.tar.gz')
      git(origin, 'add', 'cpu-web-linux-deploy.tar.gz')
      git(origin, 'commit', '-m', 'bundle')
    }
    await publish('b'.repeat(40))
    await assert.rejects(installAgentArtifact(repo), /commit mismatch/)
    assert.equal(readFileSync(path.join(repo, 'server/dist/jwxtAgent.js'), 'utf8'), 'previous')
    await publish(commit)
    await installAgentArtifact(repo)
    assert.equal(readFileSync(path.join(repo, 'server/dist/jwxtAgent.js'), 'utf8'), 'new-agent')
    assert.equal(readFileSync(path.join(repo, 'server/dist/deployment-commit.txt'), 'utf8'), commit)
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep + 'cpu-agent-artifact-test-'))
    rmSync(root, { recursive: true, force: true })
  }
})
