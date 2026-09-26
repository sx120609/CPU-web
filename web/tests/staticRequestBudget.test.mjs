import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { gzipSync } from 'node:zlib'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// 首屏由 index.html 直接引用的 JS（入口 + modulepreload）与 CSS 的 gzip 总量。
// 2026-09 按路由拆包后实测约 245.5 KiB，预留约 15% 余量；超出时先检查是否有页面或大依赖被拉进了入口。
const INITIAL_GZIP_BUDGET_BYTES = 283 * 1024

test('public image URLs stay on the page origin when built modules move to a CDN', async (t) => {
  const { build, loadConfigFromFile } = await import('vite')
  const { config } = await loadConfigFromFile(
    { command: 'build', mode: 'production' },
    path.join(webRoot, 'vite.config.ts'),
  )
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'cpu-public-assets-'))
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }))
  await writeFile(path.join(fixtureRoot, 'entry.js'), [
    'export { default as qr } from "/wechat-service-qrcode.png";',
    'export { default as bundled } from "./bundled.svg";',
  ].join('\n'))
  await writeFile(path.join(fixtureRoot, 'bundled.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  const result = await build({
    configFile: false,
    root: fixtureRoot,
    publicDir: path.join(webRoot, 'public'),
    base: config.base,
    experimental: config.experimental,
    logLevel: 'silent',
    build: {
      write: false,
      copyPublicDir: false,
      assetsInlineLimit: 0,
      minify: false,
      rollupOptions: {
        input: path.join(fixtureRoot, 'entry.js'),
        preserveEntrySignatures: 'strict',
        output: { entryFileNames: 'assets/entry.js' },
      },
    },
  })
  const entry = result.output.find((item) => item.type === 'chunk' && item.isEntry)
  const bundled = result.output.find((item) => item.type === 'asset' && item.fileName.endsWith('.svg'))
  assert.ok(entry)
  assert.ok(bundled)
  const pageUrl = 'https://cputime.cn/messages?tab=settings'
  for (const moduleUrl of [
    'https://cputime.cn/assets/entry.js',
    'https://static.cputime.cn/cpu-web-media/web-static/assets/dual-origin-v2/entry.js',
    'https://img.cputime.cn/cpu-web-media/web-static/assets/dual-origin-v2/entry.js',
  ]) {
    // Execute Vite's generated module with the URL it has after deployment.
    const code = entry.code.replaceAll('import.meta.url', JSON.stringify(moduleUrl))
    const exports = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
    assert.equal(new URL(exports.qr, pageUrl).href, 'https://cputime.cn/wechat-service-qrcode.png')
    assert.equal(
      exports.bundled,
      new URL(path.posix.relative(path.posix.dirname(entry.fileName), bundled.fileName), moduleUrl).href,
    )
  }
})

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

test('startup logo is route-independent and only the matching iOS image is requested', () => {
  const indexHtml = readFileSync(path.join(webRoot, 'index.html'), 'utf8')
  assert.doesNotMatch(indexHtml, /apple-touch-startup-image/u)
  assert.match(indexHtml, /<svg\b[^>]*class="app-launch-logo"/u)
  assert.doesNotMatch(indexHtml, /<img\b[^>]*class="app-launch-logo"/u)
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

test('production output keeps the initial JS and CSS within the gzip byte budget', () => {
  const distRoot = path.join(webRoot, 'dist')
  const indexHtml = readFileSync(path.join(distRoot, 'index.html'), 'utf8')
  const initialFiles = [...indexHtml.matchAll(
    /<(?:script\b[^>]*\bsrc|link\b[^>]*\brel="(?:modulepreload|stylesheet)"[^>]*\bhref)="\.\/(assets\/[^"]+\.(?:js|css))"/gu,
  )].map((match) => match[1])
  assert.ok(initialFiles.some((file) => file.endsWith('.js')), 'expected an entry script in index.html')
  assert.ok(initialFiles.some((file) => file.endsWith('.css')), 'expected initial stylesheets in index.html')

  const sizes = initialFiles.map((file) => [file, gzipSync(readFileSync(path.join(distRoot, file))).length])
  const total = sizes.reduce((sum, [, size]) => sum + size, 0)
  assert.ok(
    total <= INITIAL_GZIP_BUDGET_BYTES,
    `initial JS+CSS is ${(total / 1024).toFixed(1)} KiB gzip, budget ${(INITIAL_GZIP_BUDGET_BYTES / 1024).toFixed(1)} KiB: `
      + sizes.map(([file, size]) => `${file} ${(size / 1024).toFixed(1)} KiB`).join(', '),
  )
})
