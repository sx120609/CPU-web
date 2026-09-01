import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function executeAppearance({ userAgent, platform = '', maxTouchPoints = 0, matchedMedia = '' }) {
  const links = []
  const root = { dataset: {}, classList: { toggle() {} }, style: {} }
  runInNewContext(readFileSync(path.join(webRoot, 'public/appearance-bootstrap.js'), 'utf8'), {
    localStorage: { getItem: () => null },
    navigator: { userAgent, platform, maxTouchPoints },
    window: { matchMedia: (query) => ({ matches: query === matchedMedia }) },
    document: {
      documentElement: root,
      querySelector: () => ({ setAttribute() {} }),
      createElement: () => ({}),
      head: { appendChild: (link) => links.push({ ...link }) },
    },
  })
  return links
}

test('startup images are omitted from HTML and only the matching iOS image is requested', () => {
  const indexHtml = readFileSync(path.join(webRoot, 'index.html'), 'utf8')
  assert.doesNotMatch(indexHtml, /apple-touch-startup-image/u)
  assert.deepEqual(executeAppearance({ userAgent: 'Mozilla/5.0 Chrome/140.0' }), [])

  const media = '(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)'
  assert.deepEqual(executeAppearance({ userAgent: 'Mozilla/5.0 (iPhone)', matchedMedia: media }), [{
    rel: 'apple-touch-startup-image',
    href: '/splash/ios-launch-v6-1170x2532.png?v=20260830',
    media,
  }])
})

test('service worker serves a cached static asset without refreshing it over the network', async () => {
  const listeners = new Map()
  const cached = { source: 'cache' }
  let networkRequests = 0
  const cache = { match: async () => cached, put: async () => undefined }
  runInNewContext(readFileSync(path.join(webRoot, 'public/sw.js'), 'utf8'), {
    URL,
    Request,
    Response,
    fetch: async () => {
      networkRequests += 1
      return { ok: true, clone() { return this } }
    },
    caches: {
      open: async () => cache,
      keys: async () => [],
      delete: async () => true,
    },
    self: {
      location: { origin: 'https://cputime.cn' },
      clients: { claim: async () => undefined },
      skipWaiting: async () => undefined,
      addEventListener: (name, listener) => listeners.set(name, listener),
    },
  })

  let responsePromise
  listeners.get('fetch')({
    request: { method: 'GET', mode: 'no-cors', url: 'https://cputime.cn/assets/app.js' },
    respondWith: (value) => { responsePromise = value },
  })
  assert.equal(await responsePromise, cached)
  assert.equal(networkRequests, 0)
})

test('production output keeps CSS assets relative and the initial bundle request count bounded', () => {
  const distRoot = path.join(webRoot, 'dist')
  const indexHtml = readFileSync(path.join(distRoot, 'index.html'), 'utf8')
  const initialAssets = [...indexHtml.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="\.\/assets\//gu)]
  assert.ok(initialAssets.length <= 10, `expected at most 10 initial asset requests, found ${initialAssets.length}`)

  for (const name of readdirSync(path.join(distRoot, 'assets')).filter((value) => value.endsWith('.js'))) {
    const source = readFileSync(path.join(distRoot, 'assets', name), 'utf8')
    assert.doesNotMatch(
      source,
      /\b(?:from|import\()\s*["']\/assets\//u,
      name,
    )
    assert.doesNotMatch(
      source,
      /new URL\(["']\.\.\/favicon\.svg/u,
      `${name} must keep the site logo on the main origin`,
    )
  }

  for (const name of readdirSync(path.join(distRoot, 'assets')).filter((value) => value.endsWith('.css'))) {
    assert.doesNotMatch(readFileSync(path.join(distRoot, 'assets', name), 'utf8'), /url\(\/?assets\//u, name)
  }
})
