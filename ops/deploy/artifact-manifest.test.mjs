import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  COMPONENT_FILES,
  createArtifactManifest,
  verifyArtifactManifest
} from './artifact-manifest.mjs'

const COMMIT = '1234567890abcdef1234567890abcdef12345678'

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'cpu-web-artifact-'))
  for (const [component, file] of Object.entries(COMPONENT_FILES)) {
    writeFileSync(path.join(directory, file), `artifact:${component}`)
  }
  return directory
}

test('creates and verifies a commit-bound deployment manifest', async () => {
  const directory = fixture()
  const manifest = await createArtifactManifest({ commit: COMMIT, directory })
  assert.equal(manifest.commit, COMMIT)
  assert.equal(await verifyArtifactManifest({ manifest, expectedCommit: COMMIT, directory }), true)
})

test('rejects another commit and modified artifacts', async () => {
  const directory = fixture()
  const manifest = await createArtifactManifest({ commit: COMMIT, directory })
  await assert.rejects(
    verifyArtifactManifest({
      manifest,
      expectedCommit: 'abcdef1234567890abcdef1234567890abcdef12',
      directory
    }),
    /commit mismatch/
  )
  writeFileSync(path.join(directory, COMPONENT_FILES.web), 'tampered')
  await assert.rejects(
    verifyArtifactManifest({ manifest, expectedCommit: COMMIT, directory }),
    /(size|SHA-256) mismatch/
  )
})
