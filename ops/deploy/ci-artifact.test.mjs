import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { promisify } from 'node:util'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
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

test('artifact transport fetch is non-interactive and bounded by a hard timeout', { skip: process.platform === 'win32' }, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cpu-artifact-fetch-test-'))
  try {
    const bin = path.join(root, 'bin')
    const record = path.join(root, 'git-call.txt')
    mkdirSync(bin)
    const fakeGit = path.join(bin, 'git')
    writeFileSync(fakeGit, `#!/usr/bin/env bash\nprintf '%s\\n' "$GIT_TERMINAL_PROMPT|$*" > "$RECORD"\nsleep 30\n`)
    chmodSync(fakeGit, 0o755)
    const script = `set -u
      log() { echo "log: $*"; }
      warn() { echo "warn: $*" >&2; }
      DEPLOY_CI_FETCH_TIMEOUT_SECONDS=1
      DEPLOY_CI_GIT_LOW_SPEED_LIMIT=10240
      DEPLOY_CI_GIT_LOW_SPEED_SECONDS=30
      DEPLOY_ARTIFACT_GIT_SOURCE=refs/heads/deploy-artifacts
      DEPLOY_ARTIFACT_GIT_REF=refs/remotes/origin/deploy-artifacts
      ${shellFunction('fetch_ci_artifact_transport')}
      fetch_ci_artifact_transport 2`
    const startedAt = Date.now()
    let result
    try {
      execFileSync('bash', ['-c', script], {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RECORD: record },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5_000,
      })
      assert.fail('fetch unexpectedly succeeded')
    } catch (error) {
      result = error
    }
    assert.ok(Date.now() - startedAt < 4_000, 'fetch did not stop within the hard timeout')
    assert.equal(result.status, 124)
    assert.match(String(result.stderr), /timed out after 1s/u)
    const invocation = readFileSync(record, 'utf8')
    assert.match(invocation, /^0\|/u)
    assert.match(invocation, /maintenance\.auto=false/u)
    assert.match(invocation, /http\.lowSpeedLimit=10240/u)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('release artifact transport resumes partial downloads and keeps a hard total timeout', { skip: process.platform === 'win32' }, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cpu-artifact-release-test-'))
  try {
    const bin = path.join(root, 'bin')
    const record = path.join(root, 'curl-call.txt')
    const destination = path.join(root, 'bundle.part')
    mkdirSync(bin)
    const fakeCurl = path.join(bin, 'curl')
    writeFileSync(fakeCurl, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" > "$RECORD"\n[ "\${SLOW:-0}" = 1 ] && sleep 30\nprintf 'tail' >> "$DESTINATION"\n`)
    chmodSync(fakeCurl, 0o755)
    writeFileSync(destination, 'partial')
    const script = `set -u
      log() { echo "log: $*"; }
      warn() { echo "warn: $*" >&2; }
      DEPLOY_ARTIFACT_URL=https://unused.test/cpu-web-linux-deploy.tar.gz
      DEPLOY_ARTIFACT_RELEASE_TIMEOUT_SECONDS="$FETCH_TIMEOUT"
      DEPLOY_ARTIFACT_RELEASE_LOW_SPEED_LIMIT=1024
      DEPLOY_ARTIFACT_RELEASE_LOW_SPEED_SECONDS=90
      ${shellFunction('fetch_ci_artifact_release_transport')}
      fetch_ci_artifact_release_transport ${'b'.repeat(40)} 3 "$DESTINATION" "$RELEASE_URL"`
    execFileSync('bash', ['-c', script], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RECORD: record, DESTINATION: destination, FETCH_TIMEOUT: '7', RELEASE_URL: 'https://mirror.test/cpu-web-linux-deploy.tar.gz' },
      encoding: 'utf8',
    })
    assert.equal(readFileSync(destination, 'utf8'), 'partialtail')
    const invocation = readFileSync(record, 'utf8')
    assert.match(invocation, /--continue-at -/u)
    assert.match(invocation, /--speed-limit 1024 --speed-time 90/u)
    assert.match(invocation, /mirror\.test\/cpu-web-linux-deploy\.tar\.gz\?commit=b{40}/u)
    assert.doesNotMatch(invocation, /unused\.test/u)

    execFileSync('bash', ['-c', script], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RECORD: record, DESTINATION: destination, FETCH_TIMEOUT: '7', RELEASE_URL: 'https://mirror.test/cpu-web-linux-COMMIT_SHA.tar.gz' },
      encoding: 'utf8',
    })
    const pinnedInvocation = readFileSync(record, 'utf8')
    assert.match(pinnedInvocation, /cpu-web-linux-b{40}\.tar\.gz(?: |$)/u)
    assert.doesNotMatch(pinnedInvocation, /\?commit=|attempt=|Cache-Control|--retry-all-errors/u)
    assert.doesNotMatch(pinnedInvocation, /COMMIT_SHA/u)

    writeFileSync(destination, 'partial')
    const startedAt = Date.now()
    assert.throws(() => execFileSync('bash', ['-c', script], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RECORD: record, DESTINATION: destination, FETCH_TIMEOUT: '1', RELEASE_URL: 'https://mirror.test/cpu-web-linux-deploy.tar.gz', SLOW: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5_000,
    }), error => error.status === 124)
    assert.ok(Date.now() - startedAt < 4_000, 'release fetch did not stop within the hard timeout')
    assert.equal(readFileSync(destination, 'utf8'), 'partial')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a failed HTTP transfer keeps its bytes and the next mirror resumes without cache busting', { skip: process.platform === 'win32' }, async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cpu-artifact-http-test-'))
  const destination = path.join(root, 'bundle.part')
  const commit = 'c'.repeat(40)
  const payload = Buffer.alloc(256 * 1024, 'artifact')
  const prefixSize = 64 * 1024
  const requests = []
  const server = createServer((request, response) => {
    requests.push({ url: request.url, range: request.headers.range, cacheControl: request.headers['cache-control'] })
    if (request.url.startsWith('/primary/')) {
      response.writeHead(200, { 'Content-Length': payload.length })
      response.write(payload.subarray(0, prefixSize))
      setTimeout(() => response.destroy(), 50)
    } else {
      const start = Number(request.headers.range?.match(/^bytes=(\d+)-$/u)?.[1] || 0)
      response.writeHead(206, {
        'Content-Length': payload.length - start,
        'Content-Range': `bytes ${start}-${payload.length - 1}/${payload.length}`,
      })
      response.end(payload.subarray(start))
    }
  })
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${server.address().port}`
    const script = `set -eu
      log() { echo "$*"; }; warn() { echo "$*" >&2; }
      DEPLOY_ARTIFACT_RELEASE_TIMEOUT_SECONDS=10
      DEPLOY_ARTIFACT_RELEASE_LOW_SPEED_LIMIT=10240
      DEPLOY_ARTIFACT_RELEASE_LOW_SPEED_SECONDS=30
      ${shellFunction('fetch_ci_artifact_release_transport')}
      fetch_ci_artifact_release_transport ${commit} 1 "$DESTINATION" "$RELEASE_URL"`
    const run = mirror => promisify(execFile)('bash', ['-c', script], {
      env: { ...process.env, DESTINATION: destination, RELEASE_URL: `${origin}/${mirror}/cpu-web-linux-COMMIT_SHA.tar.gz` },
      timeout: 15_000,
    })
    await assert.rejects(run('primary'), error => error.code === 18)
    assert.equal(requests.length, 1, 'a failed mirror must not retry internally and discard downloaded bytes')
    assert.deepEqual(readFileSync(destination), payload.subarray(0, prefixSize))
    await run('fallback')
    assert.deepEqual(readFileSync(destination), payload)
    assert.deepEqual(requests, [
      { url: `/primary/cpu-web-linux-${commit}.tar.gz`, range: undefined, cacheControl: undefined },
      { url: `/fallback/cpu-web-linux-${commit}.tar.gz`, range: `bytes=${prefixSize}-`, cacheControl: undefined },
    ])
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    rmSync(root, { recursive: true, force: true })
  }
})

test('a trickling HTTP mirror is abandoned promptly with its partial download intact', { skip: process.platform === 'win32' }, async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cpu-artifact-trickle-test-'))
  const destination = path.join(root, 'bundle.part')
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Length': 100_000 })
    response.write('part')
    const timer = setInterval(() => response.write('.'), 100)
    response.on('close', () => clearInterval(timer))
  })
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const script = `set -eu
      log() { echo "$*"; }; warn() { echo "$*" >&2; }
      DEPLOY_ARTIFACT_RELEASE_TIMEOUT_SECONDS=10
      DEPLOY_ARTIFACT_RELEASE_LOW_SPEED_LIMIT=10240
      DEPLOY_ARTIFACT_RELEASE_LOW_SPEED_SECONDS=1
      ${shellFunction('fetch_ci_artifact_release_transport')}
      fetch_ci_artifact_release_transport ${'d'.repeat(40)} 1 "$DESTINATION" "$RELEASE_URL"`
    const startedAt = Date.now()
    await assert.rejects(promisify(execFile)('bash', ['-c', script], {
      env: { ...process.env, DESTINATION: destination, RELEASE_URL: `http://127.0.0.1:${server.address().port}/COMMIT_SHA.tar.gz` },
      timeout: 5_000,
    }), error => error.code === 28)
    assert.ok(Date.now() - startedAt < 4_000, 'slow transfer must fail over before the full download timeout')
    assert.match(readFileSync(destination, 'utf8'), /^part\.+$/u)
    assert.match(deploy, /DEPLOY_ARTIFACT_RELEASE_LOW_SPEED_LIMIT="\$\{DEPLOY_ARTIFACT_RELEASE_LOW_SPEED_LIMIT:-10240\}"/u)
    assert.match(deploy, /DEPLOY_ARTIFACT_RELEASE_LOW_SPEED_SECONDS="\$\{DEPLOY_ARTIFACT_RELEASE_LOW_SPEED_SECONDS:-30\}"/u)
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    rmSync(root, { recursive: true, force: true })
  }
})

test('release artifact download uses the fast mirror before the legacy fallback', () => {
  assert.match(deploy, /DEPLOY_CI_FETCH_TIMEOUT_SECONDS="\$\{DEPLOY_CI_FETCH_TIMEOUT_SECONDS:-600\}"/u)
  assert.match(deploy, /DEPLOY_ARTIFACT_URL="\$\{DEPLOY_ARTIFACT_URL:-https:\/\/gh\.noki\.eu\.org\//u)
  assert.match(deploy, /DEPLOY_ARTIFACT_FALLBACK_URL="\$\{DEPLOY_ARTIFACT_FALLBACK_URL:-https:\/\/ghfast\.top\//u)
  assert.match(deploy, /DEPLOY_ARTIFACT_PRIMARY_TIMEOUT_SECONDS="\$\{DEPLOY_ARTIFACT_PRIMARY_TIMEOUT_SECONDS:-1800\}"/u)
  const download = shellFunction('download_ci_artifact')
  const primary = download.indexOf('"$DEPLOY_ARTIFACT_URL"')
  const fallback = download.indexOf('"$DEPLOY_ARTIFACT_FALLBACK_URL"')
  assert.ok(primary >= 0)
  assert.ok(fallback > primary)
  assert.ok(download.indexOf('fetch_ci_artifact_transport') > fallback, 'resumable HTTP must precede the non-resumable Git fetch')
  assert.match(deploy, /cpu-web-linux-COMMIT_SHA\.tar\.gz/u)
  assert.match(download, /"\$DEPLOY_ARTIFACT_URL" "\$DEPLOY_ARTIFACT_PRIMARY_TIMEOUT_SECONDS"/u)
  assert.match(download, /"\$DEPLOY_ARTIFACT_FALLBACK_URL" "\$DEPLOY_ARTIFACT_RELEASE_TIMEOUT_SECONDS"/u)
})


test('every built SHA gets a commit-specific release asset, even after main advances', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/linux-deploy-artifact.yml', import.meta.url), 'utf8')
  const step = workflow.split('- name: Publish commit-specific deployment asset')[1].split('- name: Publish fast Git deployment transport')[0]
  assert.match(step, /asset="cpu-web-linux-\$GITHUB_SHA\.tar\.gz"/u)
  assert.doesNotMatch(step, /if: steps\.tip/u)
  assert.match(step, /gh release upload deploy-artifacts "\$asset" "\$asset\.sha256"/u)
})
