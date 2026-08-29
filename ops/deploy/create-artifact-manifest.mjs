#!/usr/bin/env node

import path from 'node:path'
import { createArtifactManifest, writeArtifactManifest } from './artifact-manifest.mjs'

const [commit, directoryArg] = process.argv.slice(2)
const directory = path.resolve(directoryArg || '.')

try {
  const manifest = await createArtifactManifest({ commit, directory })
  writeArtifactManifest(path.join(directory, 'manifest.json'), manifest)
  console.log(`[artifact] manifest created for ${manifest.commit}`)
} catch (error) {
  console.error(`[artifact] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
