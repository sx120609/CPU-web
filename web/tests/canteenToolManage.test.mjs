import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as Vue from 'vue'
import { computed, ref } from 'vue'
import { parse, compileScript } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'

const source = readFileSync(new URL('../src/views/services/ToolManage.vue', import.meta.url), 'utf8')
const script = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
const ast = ts.createSourceFile('ToolManage.ts', script, ts.ScriptTarget.Latest, true)
const functions = ['normalizeToolQuery', 'pickInitialTool', 'reloadActive', 'openStandaloneTool']
const statements = ast.statements.filter(node =>
  (ts.isFunctionDeclaration(node) && functions.includes(node.name?.text))
  || (ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(ast) === 'standaloneTool')))

test('canteen and PDF management deep links open their own settings without fetching questionnaires', async () => {
  const activeTool = ref('canteen_picker')
  const queries = []
  const navigations = []
  const sandbox = {
    computed, activeTool,
    route: { query: { tool: 'canteen_picker' } },
    manageableCodes: ref(['questionnaire', 'pdf_tools', 'canteen_picker']),
    canAdminActiveTool: ref(true), managers: ref([]), questionnaires: ref([{}]), gradeChecks: ref([{}]),
    toolsApi: { managers: async () => [], questionnaires: async args => { queries.push(args); return [] } },
    router: { push: path => navigations.push(path) },
  }
  const js = ts.transpileModule(statements.map(node => node.getText(ast)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  runInNewContext(`${js}\nthis.api = { pickInitialTool, reloadActive, openStandaloneTool, standaloneTool };`, sandbox)
  assert.equal(sandbox.api.pickInitialTool(), 'canteen_picker')
  assert.equal(sandbox.api.standaloneTool.value.name, '药大今天吃什么')
  await sandbox.api.reloadActive()
  sandbox.api.openStandaloneTool()
  activeTool.value = 'pdf_tools'
  assert.equal(sandbox.api.standaloneTool.value.name, 'PDF 工具')
  await sandbox.api.reloadActive()
  sandbox.api.openStandaloneTool()
  assert.deepEqual(queries, [])
  assert.deepEqual(navigations, ['/services/tools/canteen_picker', '/services/tools/pdf_tools'])
  assert.equal(sandbox.questionnaires.value.length, 0)
  activeTool.value = 'questionnaire'
  assert.equal(sandbox.api.standaloneTool.value, null)
  await sandbox.api.reloadActive()
  assert.equal(queries[0].toolCode, 'questionnaire')
})

test('canteen detail waits for settings and blocks guests when login is required', async () => {
  const detail = readFileSync(new URL('../src/views/services/ToolDetail.vue', import.meta.url), 'utf8')
  const { descriptor } = parse(detail)
  const compiled = compileScript(descriptor, { id: 'canteen-access-test', inlineTemplate: true }).content
  const js = ts.transpileModule(compiled, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  const auth = Vue.reactive({ isLoggedIn: false })
  const toolMetas = ref([])
  const tool = { slug: 'canteen_picker', componentKey: 'canteen_picker', name: '药大今天吃什么' }
  const module = { exports: {} }
  const stub = { render: () => Vue.h('span') }
  const imports = {
    vue: { ...Vue, defineAsyncComponent: loader => ({ render: () => Vue.h('div', loader.toString().includes('CanteenPickerPanel') ? 'CANTEEN_PICKER' : '') }) },
    'vue-router': { useRoute: () => ({ params: { slug: tool.slug }, fullPath: '/services/tools/canteen_picker' }) },
    '@/api/request': { getToken: () => '' },
    '@/data/serviceTools': { findServiceTool: () => tool },
    '@/utils/documentTitle': { useDocumentTitle: () => {} },
    './servicesPage': {
      useServiceTools: () => ({ auth, toolMetas, toolsError: ref(''), loadToolMetas: async () => {},
        isLoginRequired: () => toolMetas.value[0]?.requireLogin, toolBadge: () => '' }),
      useToolManageEntry: () => ({ canManageTool: () => false }), toolBadgeTone: () => '',
    },
  }
  runInNewContext(js, { exports: module.exports, module, require: name => imports[name] ?? { default: stub } })
  const render = async () => {
    const app = Vue.createSSRApp(module.exports.default)
    app.component('router-link', { props: ['to'], render() { return Vue.h('a', { href: typeof this.to === 'string' ? this.to : this.to.path }, this.$slots.default?.()) } })
    app.component('el-icon', stub)
    app.component('el-button', stub)
    app.component('el-empty', stub)
    return renderToString(app)
  }
  assert.match(await render(), /正在加载工具设置/)
  toolMetas.value = [{ code: 'canteen_picker', requireLogin: true }]
  const restricted = await render()
  assert.match(restricted, /登录后使用药大今天吃什么/)
  assert.doesNotMatch(restricted, /CANTEEN_PICKER/)
  auth.isLoggedIn = true
  assert.match(await render(), /CANTEEN_PICKER/)
  auth.isLoggedIn = false
  toolMetas.value[0].requireLogin = false
  assert.match(await render(), /CANTEEN_PICKER/)
})
