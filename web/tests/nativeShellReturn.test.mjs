import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const here = path.dirname(fileURLToPath(import.meta.url))
const standIn = readFileSync(path.resolve(here, '../public/native-shell-return.js'), 'utf8')
const bootstrap = readFileSync(path.resolve(here, '../public/transport-bootstrap.js'), 'utf8')

const ANDROID = 'Mozilla/5.0 (Linux; Android 15) CPUWebScheduleApp/59 CPUWebScheduleAppVersion/4.0.18 CPUTimeNative/1'
const HARMONY = 'Mozilla/5.0 (Phone; OpenHarmony 5.0) ArkWeb/4.1 CPUWebHarmonyApp/28 CPUTimeNative/1'
const BROWSER = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1'

function page({ ua = ANDROID, siteApp = false, bridge } = {}) {
  const timers = []
  const session = new Map()
  const visits = []
  const window = {
    navigator: { userAgent: ua },
    sessionStorage: { setItem: (key, value) => session.set(key, value) },
    location: { replace: (url) => visits.push(['replace', url]), reload: () => visits.push(['reload']) },
    CPUTimeNativeScheduleFetch: bridge,
  }
  const document = { currentScript: { hasAttribute: (name) => siteApp && name === 'data-site-app' } }
  runInNewContext(standIn, {
    window, document, Promise, JSON, Date,
    setTimeout: (fn, ms) => timers.push({ fn, ms }),
  })
  const elapse = (ms) => {
    for (const timer of timers.splice(0)) {
      if (timer.ms <= ms) timer.fn()
      else timers.push(timer)
    }
  }
  return { window, session, visits, elapse }
}

test('browsers never get a stand-in', () => {
  const view = page({ ua: BROWSER })
  assert.equal(view.window.CPUTimeNativeScheduleFetch, undefined)
})

test('an automatic request on another page explains how to recover and stays put', async () => {
  const view = page()
  const result = await view.window.CPUTimeNativeScheduleFetch('2026-2027-1', '8', false)
  assert.equal(result.auth.authenticated, true)
  assert.match(result.error, /刷新一下即可恢复/)
  const background = await view.window.CPUTimeNativeScheduleFetch('2026-2027-1', '8', true, true)
  assert.match(background.error, /刷新一下即可恢复/)
  view.elapse(1000)
  assert.deepEqual(view.visits, [])
  assert.equal(view.session.size, 0)
})

test('a refresh the user asked for returns to the site app once and leaves the refresh for it', async () => {
  const view = page()
  const result = await view.window.CPUTimeNativeScheduleFetch('2026-2027-1', '8', true)
  assert.equal(result.cancelled, true)
  const pending = JSON.parse(view.session.get('cpu-native-schedule-refresh'))
  assert.equal(pending.semester, '2026-2027-1')
  assert.equal(pending.week, '8')
  assert.ok(Date.now() - pending.at < 1000)
  await view.window.CPUTimeNativeScheduleFetch('2026-2027-1', '8', true)
  view.elapse(1000)
  assert.deepEqual(view.visits, [['replace', '/home']])
})

test('HarmonyOS gets no cancelled result, which it cannot read; the navigation cancels its request', async () => {
  const view = page({ ua: HARMONY })
  let settled = false
  view.window.CPUTimeNativeScheduleFetch('2026-2027-1', '8', true).then(() => { settled = true })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(settled, false)
  view.elapse(1000)
  assert.deepEqual(view.visits, [['replace', '/home']])
})

test('in the site app it stands in only after the app has failed to start, and then reloads', async () => {
  const view = page({ siteApp: true })
  assert.equal(view.window.CPUTimeNativeScheduleFetch, undefined)
  view.elapse(31000)
  assert.equal(view.window.CPUTimeNativeScheduleFetch, undefined)
  view.elapse(32000)
  assert.equal(typeof view.window.CPUTimeNativeScheduleFetch, 'function')
  await view.window.CPUTimeNativeScheduleFetch('', '', true)
  view.elapse(1000)
  assert.deepEqual(view.visits, [['reload']])
})

test('a real bridge is never replaced', () => {
  const real = () => 'real'
  const other = page({ bridge: real })
  assert.equal(other.window.CPUTimeNativeScheduleFetch, real)
  const site = page({ siteApp: true, bridge: real })
  site.elapse(32000)
  assert.equal(site.window.CPUTimeNativeScheduleFetch, real)
})

function bootstrapPage(ua, { readyState = 'complete', trusted = true } = {}) {
  const added = []
  const listeners = {}
  const element = {
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value },
    set src(value) {
      // Under require-trusted-types-for, a plain string throws until the app installs its default policy.
      if (!trusted) throw new TypeError("This document requires 'TrustedScriptURL' assignment.")
      this.url = value
    },
  }
  runInNewContext(bootstrap, {
    window: {
      location: { protocol: 'https:', hostname: 'cputime.cn', pathname: '/home', search: '', hash: '' },
      navigator: { userAgent: ua },
      document: {
        readyState,
        addEventListener: (type, listener) => { listeners[type] = listener },
        createElement: () => element,
        head: { appendChild: (node) => added.push(node) },
      },
    },
  })
  return { added, listeners }
}

test('the site page loads the stand-in in native shells only', () => {
  assert.deepEqual(bootstrapPage(BROWSER).added, [])
  const [script] = bootstrapPage(ANDROID).added
  assert.equal(script.url, '/native-shell-return.js')
  assert.equal(script.async, true)
  assert.ok('data-site-app' in script.attributes)
})

test('the site page waits for the app security bootstrap and never throws without it', () => {
  const early = bootstrapPage(ANDROID, { readyState: 'loading' })
  assert.deepEqual(early.added, [])
  early.listeners.DOMContentLoaded()
  assert.equal(early.added.length, 1)
  const blocked = bootstrapPage(ANDROID, { trusted: false })
  assert.deepEqual(blocked.added, [])
})
