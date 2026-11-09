#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createArtifactManifest, writeArtifactManifest } from './artifact-manifest.mjs'
import { readServerModulesEntry } from './server-modules.mjs'

// The optional third argument is the JSON printed by `server-modules.mjs pack`.
const [commit, directoryArg, serverModulesFile] = process.argv.slice(2)
const directory = path.resolve(directoryArg || '.')

try {
  const serverModules = serverModulesFile ? JSON.parse(readFileSync(serverModulesFile, 'utf8')) : null
  if (serverModules) readServerModulesEntry({ serverModules })
  const manifest = await createArtifactManifest({ commit, directory, serverModules })
  writeArtifactManifest(path.join(directory, 'manifest.json'), manifest)
  console.log(`[artifact] manifest created for ${manifest.commit}`)
} catch (error) {
  console.error(`[artifact] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
