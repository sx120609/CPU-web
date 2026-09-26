import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const routerSource = readFileSync(new URL('../src/router/index.ts', import.meta.url), 'utf8')
const middlewareSource = readFileSync(
  new URL('../../voicehub/app/middleware/auth.global.ts', import.meta.url), 'utf8'
)

function compile(source) {
  return ts.transpileModule(source.replaceAll('import.meta.client', 'true')
    .replaceAll('import.meta.server', 'false').replaceAll('import.meta.env.DEV', 'false'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
  }).outputText
}

function mainGuard(user) {
  let guard
  const redirects = []
  runInNewContext(compile(routerSource.slice(routerSource.indexOf('router.beforeEach('))), {
    router: { beforeEach: fn => { guard = fn } },
    window: { location: { replace: url => redirects.push(url) } },
    document: {},
    hidesNativeCommerce: () => false,
    isNativeScheduleShell: () => false,
    // 普通浏览器中不存在原生壳的内网限制账号，也不会隐藏小游戏入口。
    isNativeForumIntranetOnlyAccount: () => false,
    shouldHideNativeYaodaCanFly: () => false,
    usesImmediateIosScroll: () => false,
    useAuthStore: () => ({ ready: true, user, token: user ? 'session' : null, canAccessModuleAdmin: false }),
    useSiteStore: () => ({}),
    CACHE_FIRST_EDUCATION_ROUTES: new Set(),
    FEATURE_GATED: {},
    firstRouteValue: value => value,
    LEGACY_FILE_COLLECTION_SUBMIT_PREFIX: '/legacy-file-collection/'
  })
  return { guard, redirects }
}

function voiceHubGuard(user) {
  let guard
  const redirects = []
  const source = middlewareSource.replace(/^import .*\r?\n/gm, '')
    .replace('export default defineNuxtRouteMiddleware', 'defineNuxtRouteMiddleware')
  runInNewContext(compile(source), {
    defineNuxtRouteMiddleware: fn => { guard = fn },
    useAuth: () => ({
      user: { value: user }, isAuthenticated: { value: !!user }, initAuth: async () => {}
    }),
    navigateTo: path => { redirects.push(path); return path },
    navigateToCpuWeb: (target, redirect) => redirects.push({ target, redirect }),
    abortNavigation: () => false
  })
  return { guard, redirects }
}

function route(path, meta = { public: true }) {
  return { path, fullPath: path, name: path, meta, query: {} }
}

for (const user of [
  { role: 'user', voiceHubRole: 'admin' },
  { role: 'voicehub_admin' },
  { role: 'user', voiceHubRole: 'super_admin' },
  { role: 'user', voiceHubRole: 'admin', lostFoundRole: 'admin' }
]) {
  test(`module admin can enter services and return to main site: ${JSON.stringify(user)}`, async () => {
    const { guard, redirects } = mainGuard(user)
    for (const path of ['/', '/services', '/services/tools/voicehub', '/profile']) {
      assert.equal(await guard(route(path, { public: path !== '/profile' })), true)
    }
    assert.deepEqual(redirects, [])
  })
}

test('module admin does not gain access to the main administration panel', async () => {
  const { guard } = mainGuard({ role: 'user', voiceHubRole: 'admin' })
  assert.equal((await guard(route('/admin', { requireMod: true }))).name, 'home')
})

test('VoiceHub admin can leave dashboard, including with a cached voiceHubOnly flag', async () => {
  const { guard, redirects } = voiceHubGuard({ role: 'ADMIN', voiceHubOnly: true })
  for (const path of ['/dashboard', '/', '/notification-settings', '/dashboard', '/']) {
    assert.equal(await guard(route(path)), undefined)
  }
  assert.deepEqual(redirects, [])
})

test('VoiceHub still permits public access and requires login for protected pages', async () => {
  const { guard, redirects } = voiceHubGuard(null)
  assert.equal(await guard(route('/')), undefined)
  assert.deepEqual(redirects, [])
  assert.equal(await guard(route('/dashboard')), false)
  assert.equal(redirects[0].target, 'login')
  assert.equal(redirects[0].redirect, '/voicehub/dashboard')
})
