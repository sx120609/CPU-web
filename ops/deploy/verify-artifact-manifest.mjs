#!/usr/bin/env node

import path from 'node:path'
import { readArtifactManifest, verifyArtifactManifest } from './artifact-manifest.mjs'

const [expectedCommit, directoryArg] = process.argv.slice(2)
const directory = path.resolve(directoryArg || '.')

try {
  const manifest = readArtifactManifest(path.join(directory, 'manifest.json'))
  await verifyArtifactManifest({ manifest, expectedCommit, directory })
  console.log(`[artifact] verified Linux deployment bundle for ${manifest.commit}`)
} catch (error) {
  console.error(`[artifact] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
