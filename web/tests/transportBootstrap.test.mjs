import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const script = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/transport-bootstrap.js'),
  'utf8'
)

function execute(location) {
  let replacement = null
  runInNewContext(script, {
    window: {
      location: {
        ...location,
        replace(value) {
          replacement = value
        }
      }
    }
  })
  return replacement
}

test('canonicalizes production HTTP URLs before the application starts', () => {
  assert.equal(
    execute({
      protocol: 'http:',
      hostname: 'www.cputime.cn',
      pathname: '/voicehub/',
      search: '?from=qq',
      hash: '#request'
    }),
    'https://cputime.cn/voicehub/?from=qq#request'
  )
})

test('does not redirect HTTPS or local development URLs', () => {
  const common = { pathname: '/', search: '', hash: '' }
  assert.equal(execute({ ...common, protocol: 'https:', hostname: 'cputime.cn' }), null)
  assert.equal(execute({ ...common, protocol: 'http:', hostname: 'localhost' }), null)
})
