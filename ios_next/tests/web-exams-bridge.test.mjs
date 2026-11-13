import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from '../../web/node_modules/esbuild/lib/main.js';

// `window.CPUTimeNativeExams` (web/src/utils/nativeExamsBridge.ts): what the native timetable
// reads 教务's exam arrangements through.
const webRoot = fileURLToPath(new URL('../../web/src', import.meta.url));
const mocks = {
  vue: 'export const watch = (_, callback) => { globalThis.settle = () => callback(true); return () => {}; };',
  '@/api/jwxt': 'export const jwxtApi = globalThis.api;',
  '@/stores/auth': 'export const useAuthStore = () => globalThis.auth;',
  '@/stores/jwxt': 'export const useJwxtStore = () => globalThis.jwxt;',
  '@/stores/site': 'export const useSiteStore = () => globalThis.site;',
  '@/utils/academicSystem': 'export const academicViewSet = views => new Set(Array.isArray(views) ? views : ["schedule", "grades"]);',
  '@/utils/clientInfo': 'export const isNativeScheduleShell = () => globalThis.native;',
  '@/utils/iosNextScheduleBridge': 'export const nativeScheduleAccountKey = () => "account-1";',
};
const bundle = await build({
  entryPoints: [`${webRoot}/utils/nativeExamsBridge.ts`], bundle: true, write: false,
  format: 'iife', globalName: 'bridge', platform: 'browser',
  plugins: [{ name: 'mocks', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: 'mock' } : undefined);
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'js' }));
  } }],
});
const rows = [
  { courseName: ' 药理学 ', examTime: '2027-01-05 09:30~11:30', location: '仙林校区 B11-209', seat: '23', examType: '期末考试', semester: '2026-2027-1' },
  { courseName: '诊断学', examTime: '2026-07-08(09:00-12:00)', examName: '2025-2026学年第二学期期末考试', seat: 12 },
  { examTime: '2027-01-06 09:30~11:30' },
  null,
];
function setup({ native = true, ready = true, loggedIn = true, jwxtIn = true, views = ['schedule', 'exams'], exams } = {}) {
  const calls = [];
  const context = vm.createContext({
    native, window: {}, Error, setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 5)), clearTimeout,
    auth: { ready, isLoggedIn: loggedIn },
    jwxt: { isLoggedIn: jwxtIn, withSessionRetry: fn => fn() },
    site: { school: views === null ? null : { academicViews: views } },
    api: { exams: exams ?? (async (params, options) => { calls.push([params, options]); return { parsed: { list: rows, currentSemester: '2026-2027-1' } }; }) },
  });
  context.window.setTimeout = context.setTimeout;
  context.window.clearTimeout = clearTimeout;
  vm.runInContext(bundle.outputFiles[0].text, context);
  context.bridge.installNativeExamsBridge();
  context.calls = calls;
  return context;
}
const plain = value => JSON.parse(JSON.stringify(value));

test('an ordinary browser gets no exams bridge', () => {
  assert.equal(setup({ native: false }).window.CPUTimeNativeExams, undefined);
});

test("the school's exams come back as the Web page lists them, tidied", async () => {
  const context = setup();
  const reply = plain(await context.window.CPUTimeNativeExams({}));
  assert.equal(reply.supported, true);
  assert.equal(reply.authenticated, true);
  assert.equal(reply.account, 'account-1');
  assert.equal(reply.semester, '2026-2027-1');
  // Rows without a course are dropped; every field is a trimmed string, whatever 教务 sent.
  assert.deepEqual(reply.list.map(row => row.courseName), ['药理学', '诊断学']);
  assert.deepEqual(reply.list[0], { courseName: '药理学', examTime: '2027-01-05 09:30~11:30', location: '仙林校区 B11-209', seat: '23',
    examType: '期末考试', examName: '', courseCode: '', semester: '2026-2027-1' });
  assert.equal(reply.list[1].seat, '');
  // Asked the same way the 考试安排 page asks: quietly, the current semester when none is named.
  assert.deepEqual(plain(context.calls), [[null, { silent: true }]]);
  await context.window.CPUTimeNativeExams({ semester: ' 2025-2026-2 ' });
  assert.deepEqual(plain(context.calls[1]), [{ semester: '2025-2026-2' }, { silent: true }]);
});

test('a school without exam arrangements says so and is never asked', async () => {
  for (const views of [['schedule', 'grades'], null]) {
    const context = setup({ views });
    const reply = plain(await context.window.CPUTimeNativeExams({}));
    assert.deepEqual(reply, { supported: false, authenticated: false, account: '', semester: '', list: [] });
    assert.equal(context.calls.length, 0);
  }
});

test('signed out of the site or of 教务: supported, nothing listed, 教务 not asked', async () => {
  for (const state of [{ loggedIn: false }, { jwxtIn: false }]) {
    const context = setup(state);
    const reply = plain(await context.window.CPUTimeNativeExams({}));
    assert.equal(reply.supported, true);
    assert.equal(reply.authenticated, false);
    assert.deepEqual(reply.list, []);
    assert.equal(context.calls.length, 0);
  }
});

test('教务 failing is an error beside what the app already has, not an empty list to believe', async () => {
  const context = setup({ exams: async () => { throw new Error('教务暂时不可用'); } });
  const reply = plain(await context.window.CPUTimeNativeExams({}));
  assert.equal(reply.authenticated, true);
  assert.equal(reply.error, '教务暂时不可用');
});

test('while the page is still restoring its login the bridge says it cannot tell', async () => {
  const context = setup({ ready: false });
  assert.deepEqual(plain(await context.window.CPUTimeNativeExams({})), { missing: true });
});
