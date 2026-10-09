import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { computed, ref } from 'vue'
import ts from 'typescript'

const source = readFileSync(new URL('../../voicehub/app/components/Admin/SiteConfigManager.vue', import.meta.url), 'utf8')
const script = source.split('<script setup>')[1].split('</script>')[0]
const baseUrl = readFileSync(new URL('../../voicehub/app/utils/baseUrl.ts', import.meta.url), 'utf8')
const apiSource = readFileSync(new URL('../../voicehub/server/api/admin/system-settings/index.ts', import.meta.url), 'utf8')
const defaults = {
  siteTitle: '药苑之声', enableReplayRequests: false, enableSubmissionLimit: true,
  dailySubmissionLimit: 5, weeklySubmissionLimit: null, monthlySubmissionLimit: null
}
const copy = value => JSON.parse(JSON.stringify(value))

function form(fetch, base = '/voicehub/') {
  const notifications = []
  const context = {
    computed, ref, onMounted: () => {},
    useToast: () => ({ showToast: (...args) => notifications.push(args) }),
    useRuntimeConfig: () => ({ public: {}, app: { baseURL: base } }),
    $fetch: fetch, console: { error: () => {} }, setTimeout: () => {}
  }
  runInNewContext(ts.transpileModule(baseUrl.replaceAll('export ', ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText + script.slice(script.indexOf('const { showToast')) + `
    this.state = { formData, originalData, loading, saving, saveSuccess, configLoaded, saveError,
      hasChanges, currentLimitType, currentLimitValue, loadConfig, saveConfig, handleLimitTypeChange }
  `, context)
  return { ...context.state, notifications }
}

test('daily, weekly and monthly settings persist through save and reload under the app base', async () => {
  for (const [period, value] of [['daily', 0], ['weekly', 12], ['monthly', 30]]) {
    let stored = { ...defaults }
    const state = form(async (url, options) => {
      assert.equal(url, '/voicehub/api/admin/system-settings')
      assert.equal(options.credentials, 'include')
      if (options.method === 'POST') stored = copy(options.body)
      return copy(stored)
    })
    await state.loadConfig()
    state.handleLimitTypeChange(period)
    state.currentLimitValue.value = value
    state.formData.value.enableReplayRequests = true
    await state.saveConfig()
    await state.loadConfig()
    assert.equal(state.currentLimitType.value, period)
    assert.equal(state.currentLimitValue.value, value)
    assert.equal(state.formData.value.enableReplayRequests, true)
    assert.equal(state.hasChanges.value, false)
    for (const other of ['daily', 'weekly', 'monthly'].filter(type => type !== period)) {
      assert.equal(stored[`${other}SubmissionLimit`], null)
    }
  }
})

test('failed loading prevents a default form from overwriting persisted settings', async () => {
  let posts = 0
  const state = form(async (url, options) => {
    if (options.method === 'POST') posts++
    throw new Error('offline')
  })
  await state.loadConfig()
  await state.saveConfig()
  assert.equal(state.configLoaded.value, false)
  assert.equal(posts, 0)
})

test('save failure retains the edited values and displays the actual error', async () => {
  const state = form(async (url, options) => {
    if (options.method === 'POST') throw { data: { message: '保存失败，请重试' } }
    return copy(defaults)
  })
  await state.loadConfig()
  state.currentLimitValue.value = 8
  await state.saveConfig()
  assert.equal(state.currentLimitValue.value, 8)
  assert.equal(state.hasChanges.value, true)
  assert.equal(state.saveSuccess.value, false)
  assert.equal(state.saveError.value, '保存失败，请重试')
})

test('save completion reflects the submitted response and cannot mark later edits saved', async () => {
  let finish
  let submitted
  let posts = 0
  const state = form(async (url, options) => {
    if (options.method !== 'POST') return copy(defaults)
    posts++
    submitted = copy(options.body)
    return new Promise(resolve => { finish = resolve })
  })
  await state.loadConfig()
  state.currentLimitValue.value = 7
  const pending = state.saveConfig()
  assert.equal(state.saving.value, true)
  state.currentLimitValue.value = 9
  await state.saveConfig()
  assert.equal(posts, 1)
  finish(submitted)
  await pending
  assert.equal(state.currentLimitValue.value, 7)
  assert.equal(state.originalData.value.dailySubmissionLimit, 7)
  assert.match(source, /<fieldset v-else :disabled="saving"/)
})

test('invalid and empty quotas do not send a save request', async () => {
  let posts = 0
  const state = form(async (url, options) => {
    if (options.method === 'POST') posts++
    return copy(defaults)
  })
  await state.loadConfig()
  for (const value of ['', -1, 1.5]) {
    state.currentLimitValue.value = value
    await state.saveConfig()
    assert.match(state.saveError.value, /非负整数/)
  }
  assert.equal(posts, 0)
})

test('a successful HTTP response with unchanged settings is not reported as saved', async () => {
  const state = form(async () => copy(defaults))
  await state.loadConfig()
  state.currentLimitValue.value = 8
  await state.saveConfig()
  assert.equal(state.currentLimitValue.value, 8)
  assert.equal(state.hasChanges.value, true)
  assert.equal(state.saveSuccess.value, false)
  assert.match(state.saveError.value, /未确认/)
})

test('a malformed load response cannot enable saving', async () => {
  const state = form(async () => '<html>Wrong API</html>')
  await state.loadConfig()
  assert.equal(state.configLoaded.value, false)
})

test('submission limits can be disabled after clearing a quota input', async () => {
  let saved
  const state = form(async (url, options) => {
    if (options.method !== 'POST') return copy(defaults)
    saved = copy(options.body)
    return saved
  })
  await state.loadConfig()
  state.currentLimitValue.value = ''
  state.formData.value.enableSubmissionLimit = false
  await state.saveConfig()
  assert.equal(saved.enableSubmissionLimit, false)
  assert.equal(saved.dailySubmissionLimit, null)
  assert.equal(state.saveSuccess.value, true)
})

test('admin reload reads persisted settings even when a shared cache has old values', async () => {
  let handler
  let databaseReads = 0
  let cacheReads = 0
  runInNewContext(apiSource.replace(/^import .*\r?\n/gm, '')
    .replace('export default defineEventHandler', 'defineEventHandler'), {
    defineEventHandler: fn => { handler = fn },
    db: { select: () => ({ from: () => ({ limit: async () => {
      databaseReads++
      return [{ ...defaults, dailySubmissionLimit: 8 }]
    } }) }) },
    systemSettings: {},
    CacheService: { getInstance: () => ({ getSystemSettings: async () => {
      cacheReads++
      return defaults
    } }) },
    console, createError: value => value
  })
  const result = await handler({ context: { user: { role: 'ADMIN' } } })
  assert.equal(result.dailySubmissionLimit, 8)
  assert.equal(databaseReads, 1)
  assert.equal(cacheReads, 0)
})
