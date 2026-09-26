#!/usr/bin/env node
// Runs every Node.js test file in server/tests and web/tests with the loader each one needs.
//
//   node tools/run-node-tests.mjs                      all discovered files except EXCLUDED below
//   node tools/run-node-tests.mjs schedule forum       only files whose repository path contains a filter
//   node tools/run-node-tests.mjs web/tests/a.test.ts  explicit test files always run, even excluded ones
//   node tools/run-node-tests.mjs --list               print the selection without running it
//
// Any other --flag (for example --test-concurrency=2 or --test-name-pattern=...) is passed to `node --test`.
// The exit code is non-zero when any group fails or when nothing matches the given filters.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TEST_DIRECTORIES = ['server/tests', 'web/tests']
const TEST_FILE = /\.test\.(?:ts|mjs)$/u

// Files that cannot run in the dependency-only unit phase. Keep each reason precise.
const EXCLUDED = new Map([
  ['server/tests/campusAssistant.test.ts', 'needs a PostgreSQL DATABASE_URL (site settings are read and written through Prisma)'],
  ['web/tests/staticRequestBudget.test.mjs', 'reads web/dist; CI runs it after the build in "Package and verify commit-bound bundle"'],
])

const tsxLoader = path.join(root, 'server/node_modules/tsx/dist/loader.mjs')
const GROUPS = [
  {
    name: 'server TypeScript',
    matches: file => file.endsWith('.ts') && !file.startsWith('web/'),
    loader: true,
    env: { TSX_TSCONFIG_PATH: undefined },
  },
  {
    name: 'web TypeScript',
    matches: file => file.endsWith('.ts') && file.startsWith('web/'),
    loader: true,
    env: { TSX_TSCONFIG_PATH: path.join(root, 'web/tsconfig.json') },
  },
  {
    name: 'JavaScript modules',
    matches: file => file.endsWith('.mjs'),
    loader: false,
    env: {},
  },
]

const toRepositoryPath = file => path.relative(root, path.resolve(file)).split(path.sep).join('/')

function discover() {
  return TEST_DIRECTORIES
    .flatMap(directory => readdirSync(path.join(root, directory))
      .filter(name => TEST_FILE.test(name))
      .map(name => `${directory}/${name}`))
    .sort()
}

function explicitFile(argument) {
  for (const candidate of [path.resolve(argument), path.resolve(root, argument)]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      const file = toRepositoryPath(candidate)
      if (!file.startsWith('../') && TEST_FILE.test(file)) return file
    }
  }
  return null
}

function select(argumentsList) {
  const discovered = discover()
  const selectors = argumentsList.filter(argument => !argument.startsWith('--'))
  if (!selectors.length) {
    return { files: discovered.filter(file => !EXCLUDED.has(file)), skipped: discovered.filter(file => EXCLUDED.has(file)), unmatched: [] }
  }

  const files = new Set()
  const skipped = new Set()
  const unmatched = []
  for (const selector of selectors) {
    const file = explicitFile(selector)
    if (file) {
      files.add(file)
      continue
    }
    const filter = selector.split('\\').join('/').toLowerCase()
    const matches = discovered.filter(candidate => candidate.toLowerCase().includes(filter))
    for (const candidate of matches) (EXCLUDED.has(candidate) ? skipped : files).add(candidate)
    if (!matches.some(candidate => !EXCLUDED.has(candidate))) {
      unmatched.push(matches.length ? `${selector} (only excluded files; pass the path to run one)` : selector)
    }
  }
  return { files: [...files].sort(), skipped: [...skipped].filter(file => !files.has(file)).sort(), unmatched }
}

function main(argumentsList) {
  const listOnly = argumentsList.includes('--list')
  const passthrough = argumentsList.filter(argument => argument.startsWith('--') && argument !== '--list')
  const { files, skipped, unmatched } = select(argumentsList)

  for (const selector of unmatched) console.error(`[run-node-tests] no runnable test file matches: ${selector}`)
  if (!files.length || unmatched.length) return 1

  if (listOnly) {
    for (const file of files) console.log(file)
    for (const file of skipped) console.log(`# excluded ${file}: ${EXCLUDED.get(file)}`)
    return 0
  }

  if (files.some(file => file.endsWith('.ts')) && !existsSync(tsxLoader)) {
    console.error('[run-node-tests] tsx is missing; install server dependencies first: npm ci --prefix server')
    return 1
  }

  for (const file of skipped) console.log(`[run-node-tests] skipping ${file}: ${EXCLUDED.get(file)}`)

  const failures = []
  for (const group of GROUPS) {
    const groupFiles = files.filter(group.matches)
    if (!groupFiles.length) continue
    console.log(`[run-node-tests] ${group.name}: ${groupFiles.length} file(s)`)
    const env = { ...process.env }
    for (const [name, value] of Object.entries(group.env)) {
      if (value === undefined) delete env[name]
      else env[name] = value
    }
    const nodeArguments = [
      ...(group.loader ? ['--import', pathToFileURL(tsxLoader).href] : []),
      '--test',
      ...passthrough,
      ...groupFiles,
    ]
    const result = spawnSync(process.execPath, nodeArguments, { cwd: root, env, stdio: 'inherit', windowsHide: true })
    if (result.error) console.error(`[run-node-tests] ${group.name} could not start: ${result.error.message}`)
    if (result.status !== 0) failures.push(`${group.name} (${result.signal ? `signal ${result.signal}` : `exit ${result.status}`})`)
  }

  if (failures.length) {
    console.error(`[run-node-tests] failed: ${failures.join(', ')}`)
    return 1
  }
  console.log(`[run-node-tests] passed: ${files.length} file(s)`)
  return 0
}

process.exitCode = main(process.argv.slice(2))
