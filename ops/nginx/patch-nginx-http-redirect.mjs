#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { patchNginxHttpRedirect } from './nginx-http-redirect.mjs'

const [configPath, siteRoot, wellKnownInclude] = process.argv.slice(2)

try {
  if (!configPath) throw new Error('usage: patch-nginx-http-redirect.mjs <config> <site-root> [well-known-include]')
  const source = readFileSync(configPath, 'utf8')
  process.stdout.write(patchNginxHttpRedirect(source, { siteRoot, wellKnownInclude }))
} catch (error) {
  console.error(`[nginx] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
