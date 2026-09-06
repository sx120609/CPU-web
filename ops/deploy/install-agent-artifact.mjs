import { execFileSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import { readArtifactManifest, verifyArtifactManifest } from './artifact-manifest.mjs'

function run(command, args, cwd, options = {}) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', windowsHide: true, ...options })
}

export function validateArchiveEntries(names, details, component = false) {
  const entries = names.trim().split(/\r?\n/).filter(Boolean)
  if (!entries.length || new Set(entries).size !== entries.length) throw new Error('Empty or duplicate archive entries')
  for (const entry of entries) {
    if (entry.includes('\\') || entry.startsWith('/') || entry.split('/').includes('..')) throw new Error('Unsafe archive path')
    if (component ? !/^dist(?:\/|$)/.test(entry) : !['manifest.json', 'server-dist.tar.gz', 'web-dist.tar.gz', 'voicehub-output.tar.gz'].includes(entry)) {
      throw new Error('Unexpected archive entry')
    }
  }
  if (details.trim().split(/\r?\n/).some(line => !/^[d-]/.test(line))) throw new Error('Archive links are not allowed')
  if (component && !entries.includes('dist/jwxtAgent.js')) throw new Error('Missing Agent entry')
}

export async function installAgentArtifact(repositoryRoot) {
  const root = path.resolve(repositoryRoot)
  const gitDir = run('git', ['rev-parse', '--absolute-git-dir'], root).trim()
  const commit = run('git', ['rev-parse', 'HEAD'], root).trim()
  const tempRoot = path.join(gitDir, 'cpu-web-agent-artifacts')
  mkdirSync(tempRoot, { recursive: true })
  const incoming = mkdtempSync(path.join(tempRoot, 'incoming-'))
  const server = path.join(root, 'server')
  const stage = path.join(server, `dist.agent-${path.basename(incoming)}`)
  const live = path.join(server, 'dist')
  const previous = path.join(server, `dist.previous-${path.basename(incoming)}`)
  for (const target of [incoming, stage, live, previous]) {
    const allowed = target === incoming ? tempRoot : server
    if (!path.resolve(target).startsWith(`${path.resolve(allowed)}${path.sep}`)) throw new Error('Unsafe deployment path')
  }
  try {
    run('git', ['fetch', '--force', '--no-tags', 'origin', 'refs/heads/deploy-artifacts:refs/remotes/origin/deploy-artifacts'], root)
    const bundle = path.join(incoming, 'bundle.tar.gz')
    const output = openSync(bundle, 'w')
    try {
      run('git', ['show', 'refs/remotes/origin/deploy-artifacts:cpu-web-linux-deploy.tar.gz'], root, { stdio: ['ignore', output, 'pipe'] })
    } finally { closeSync(output) }
    validateArchiveEntries(run('tar', ['-tzf', bundle], root), run('tar', ['-tvzf', bundle], root))
    run('tar', ['-xzf', bundle, '-C', incoming], root)
    await verifyArtifactManifest({ manifest: readArtifactManifest(path.join(incoming, 'manifest.json')), expectedCommit: commit, directory: incoming })
    const archive = path.join(incoming, 'server-dist.tar.gz')
    validateArchiveEntries(run('tar', ['-tzf', archive], root), run('tar', ['-tvzf', archive], root), true)
    mkdirSync(stage)
    run('tar', ['-xzf', archive, '-C', stage], root)
    if (readFileSync(path.join(stage, 'dist', 'deployment-commit.txt'), 'utf8').trim() !== commit) throw new Error('Agent build marker does not match commit')
    if (existsSync(live)) renameSync(live, previous)
    try { renameSync(path.join(stage, 'dist'), live) } catch (error) {
      if (existsSync(previous)) renameSync(previous, live)
      throw error
    }
    console.log(`[deploy-agent] Published verified GitHub server artifact: ${commit}`)
  } finally {
    rmSync(incoming, { recursive: true, force: true })
    rmSync(stage, { recursive: true, force: true })
  }
}
