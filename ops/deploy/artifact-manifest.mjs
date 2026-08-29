import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const ARTIFACT_SCHEMA_VERSION = 1
export const COMPONENT_FILES = Object.freeze({
  server: 'server-dist.tar.gz',
  web: 'web-dist.tar.gz',
  voicehub: 'voicehub-output.tar.gz'
})

export function assertCommit(commit) {
  if (!/^[a-f0-9]{40}$/i.test(String(commit || ''))) {
    throw new Error('commit must be a full 40-character Git SHA')
  }
  return String(commit).toLowerCase()
}

export async function sha256File(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

export async function createArtifactManifest({ commit, directory }) {
  const normalizedCommit = assertCommit(commit)
  const artifacts = {}
  for (const [component, file] of Object.entries(COMPONENT_FILES)) {
    const filePath = path.join(directory, file)
    if (!existsSync(filePath)) throw new Error(`missing ${component} artifact: ${file}`)
    artifacts[component] = {
      file,
      bytes: statSync(filePath).size,
      sha256: await sha256File(filePath)
    }
  }
  return {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    commit: normalizedCommit,
    platform: 'linux-x64',
    nodeMajor: Number(process.versions.node.split('.')[0]),
    createdAt: new Date().toISOString(),
    artifacts
  }
}

export function readArtifactManifest(manifestPath) {
  return JSON.parse(readFileSync(manifestPath, 'utf8'))
}

export async function verifyArtifactManifest({ manifest, expectedCommit, directory }) {
  if (manifest?.schemaVersion !== ARTIFACT_SCHEMA_VERSION) {
    throw new Error(`unsupported artifact schema: ${manifest?.schemaVersion}`)
  }
  if (assertCommit(manifest.commit) !== assertCommit(expectedCommit)) {
    throw new Error(`artifact commit mismatch: expected ${expectedCommit}, received ${manifest.commit}`)
  }
  if (manifest.platform !== 'linux-x64') {
    throw new Error(`unsupported artifact platform: ${manifest.platform}`)
  }

  for (const [component, expectedFile] of Object.entries(COMPONENT_FILES)) {
    const entry = manifest.artifacts?.[component]
    if (!entry || entry.file !== expectedFile || path.basename(entry.file) !== entry.file) {
      throw new Error(`invalid ${component} artifact entry`)
    }
    if (!/^[a-f0-9]{64}$/i.test(String(entry.sha256 || ''))) {
      throw new Error(`invalid ${component} SHA-256`)
    }
    const filePath = path.join(directory, entry.file)
    if (!existsSync(filePath)) throw new Error(`missing ${component} artifact file`)
    const actualBytes = statSync(filePath).size
    if (actualBytes !== entry.bytes) {
      throw new Error(`${component} size mismatch: expected ${entry.bytes}, received ${actualBytes}`)
    }
    const actualHash = await sha256File(filePath)
    if (actualHash !== entry.sha256.toLowerCase()) {
      throw new Error(`${component} SHA-256 mismatch`)
    }
  }
  return true
}

export function writeArtifactManifest(manifestPath, manifest) {
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}
