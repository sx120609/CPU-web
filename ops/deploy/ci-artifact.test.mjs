import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const deploy = readFileSync(new URL('../../deploy.sh', import.meta.url), 'utf8')
const shellFunction = name => deploy.match(new RegExp(`${name}\\(\\) \\{[\\s\\S]*?\\n\\}`))[0]

test('artifact cache keeps the newest entries plus the active and last deployed commits', { skip: process.platform === 'win32' }, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cpu-artifact-cache-test-'))
  try {
    const cache = path.join(root, 'cpu-web-deploy-artifacts')
    const commits = ['1', '2', '3', '4', '5', '6'].map(digit => digit.repeat(40))
    const now = Date.now() / 1000
    commits.forEach((commit, index) => {
      mkdirSync(path.join(cache, commit), { recursive: true })
      writeFileSync(path.join(cache, commit, 'manifest.json'), '{}')
      const age = 3600 * (commits.length - index)
      utimesSync(path.join(cache, commit), now - age, now - age)
    })
    for (const [name, age] of [['.incoming-stale-1', 2 * 86400], ['.incoming-live-2', 60]]) {
      mkdirSync(path.join(cache, name))
      utimesSync(path.join(cache, name), now - age, now - age)
    }
    mkdirSync(path.join(cache, 'not-an-artifact'))
    const state = path.join(root, 'cpu-web-last-successful-deploy')
    writeFileSync(state, `${commits[1].toUpperCase()}\n`)
    const script = `set -euo pipefail
      warn() { echo "$*" >&2; }
      deployment_state_file() { printf '%s' "$STATE_FILE"; }
      DEPLOY_ARTIFACT_CACHE_KEEP=3
      ${shellFunction('prune_ci_artifact_cache')}
      prune_ci_artifact_cache "$CACHE" "$ACTIVE"`
    execFileSync('bash', ['-c', script], { env: { ...process.env, CACHE: cache, ACTIVE: commits[0], STATE_FILE: state } })
    // The oldest entry is the one being deployed and the second oldest is the running release.
    assert.deepEqual(readdirSync(cache).sort(), [commits[0], commits[1], commits[4], commits[5], '.incoming-live-2', 'not-an-artifact'].sort())
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('auto and ci build sources fail closed without the exact artifact; only explicit local compiles', { skip: process.platform === 'win32' }, () => {
  const script = `set -eu
    log() { echo "log: $*"; }; warn() { echo "warn: $*"; }; err() { echo "err: $*"; exit 37; }
    download_ci_artifact() { echo "download $1"; return "$ARTIFACT_FAILURE"; }
    DEPLOY_TARGET_COMMIT=${'a'.repeat(40)}
    ${shellFunction('select_deploy_build_source')}
    select_deploy_build_source
    echo selected`
  const run = (mode, failure) => {
    try {
      return { status: 0, stdout: execFileSync('bash', ['-c', script], { env: { ...process.env, DEPLOY_BUILD_MODE: mode, ARTIFACT_FAILURE: failure }, encoding: 'utf8' }) }
    } catch (error) {
      return { status: error.status, stdout: String(error.stdout) }
    }
  }
  for (const mode of ['auto', 'ci']) {
    const missing = run(mode, '1')
    assert.equal(missing.status, 37, mode)
    assert.match(missing.stdout, /download a{40}/u)
    assert.doesNotMatch(missing.stdout, /selected|local compilation/u)
    const ready = run(mode, '0')
    assert.equal(ready.status, 0, mode)
    assert.match(ready.stdout, /verified CI artifact[\s\S]*selected/u)
  }
  const local = run('local', '1')
  assert.equal(local.status, 0)
  assert.doesNotMatch(local.stdout, /download/u)
  assert.match(local.stdout, /protected local compilation/u)
  assert.equal(run('unknown', '0').status, 37)
})
