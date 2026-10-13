import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { compileScript, parse } from "@vue/compiler-sfc";
import ts from "typescript";
import * as vue from "vue";
import * as policy from "../src/utils/androidUpdatePolicy";
import * as state from "../src/utils/androidUpdateState";

// Execute the real SFC setup with native/network/clock boundaries simulated.
// Reactive watchers are real Vue watchers; no sleeps or production connection.
const source = readFileSync(new URL("../src/components/install/AndroidUpdateDialog.vue", import.meta.url), "utf8");
const compiled = compileScript(parse(source).descriptor, { id: "android-update-test" }).content;
const js = ts.transpileModule(compiled, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const require = createRequire(import.meta.url);
const start = Date.parse("2026-10-13T08:00:00Z");
const deadline = start + 72 * 3_600_000;

function setup(t: any, options: { version?: number; now?: number; legacy?: boolean; pending?: string; pendingFile?: string; fails?: boolean } = {}) {
  let monotonic = 0;
  let nextTimer = 1;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const mounts: Array<() => void> = [];
  const unmounts: Array<() => void> = [];
  const navigations: string[] = [];
  const external: string[] = [];
  const version = options.version ?? 58;
  const scope = vue.effectScope();
  const fakeWindow = Object.assign(new EventTarget(), {
    location: { hostname: options.legacy ? "cpu.lizmt.cn" : "cputime.cn", origin: "https://cputime.cn" },
    CPUTimeNative: { navigate: (path: string) => navigations.push(path), postNative: () => undefined },
    CPUAndroid: {
      supportsNativeUpdatePrompt: () => !options.legacy,
      supportsPersistentApkUpdate: () => Boolean(options.pending),
      getApkUpdateState: () => JSON.stringify({ phase: options.pending || "idle", fileName: options.pendingFile || "CPU-Web-Android-V59.apk" }),
      openExternalUrl: (url: string) => external.push(url),
      downloadAndInstallApk: () => true,
      continueApkInstall: () => true,
    },
    setTimeout(callback: () => void, delay: number) { const id = nextTimer++; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id: number) { timers.delete(id); },
    setInterval: () => nextTimer++, clearInterval: () => undefined,
  });
  const modules: Record<string, unknown> = {
    vue: { ...vue, onMounted: (cb: () => void) => mounts.push(cb), onBeforeUnmount: (cb: () => void) => unmounts.push(cb) },
    "vue-router": { useRouter: () => ({ push: () => undefined }) },
    "element-plus": { ElMessage: { success() {}, warning() {}, info() {} } },
    "@/utils/androidUpdateState": state,
    "@/utils/androidUpdatePolicy": policy,
    "@/utils/androidUpdatePrompt": { ANDROID_UPDATE_PROMPT_EVENT: "cpu:android-update-prompt" },
    "@/utils/domainMigration": require("../src/utils/domainMigration.ts"),
    "@/utils/androidReleaseCheck": {
      async fetchAndroidRelease() {
        if (options.fails) throw new Error("network unavailable");
        return {
          versionCode: 59, versionName: "4.0.18", fileName: "CPU-Web-Android-V59.apk",
          updateRequirement: { minimumVersionCode: 59, startsAt: new Date(start).toISOString(), deadlineAt: new Date(deadline).toISOString(), message: "安全更新" },
          serverTime: new Date(options.now ?? start).toISOString(),
        };
      },
    },
    "@/utils/clientInfo": {
      ANDROID_APP_LATEST_VERSION_CODE: 59, ANDROID_APP_LATEST_VERSION_NAME: "4.0.18",
      ANDROID_APP_DOWNLOAD_FILE_NAME: "CPU-Web-Android-V59.apk", ANDROID_APP_DOWNLOAD_URL: "/api/site/downloads/android-app",
      getAndroidNativeVersionCode: () => version, getAndroidNativeVersionName: () => "4.0.17",
      isAndroidNativeApp: () => true, isAndroidLegacyMajorUpgrade: () => Boolean(options.legacy),
      supportsAndroidInAppApkDownload: () => !options.legacy, canInstallAndroidApk: () => true,
    },
  };
  const exports: any = {};
  runInNewContext(js, {
    exports,
    require: (name: string) => { assert.ok(name in modules, `unmocked import ${name}`); return modules[name]; },
    window: fakeWindow, document: Object.assign(new EventTarget(), { hidden: false }),
    performance: { now: () => monotonic }, URL, Intl, Date,
  });
  const component = scope.run(() => exports.default.setup({}, { expose() {} }));
  mounts.forEach(cb => cb());
  t.after(() => { unmounts.forEach(cb => cb()); scope.stop(); });
  return { component, timers, navigations, external, advance: (ms: number) => { monotonic += ms; } };
}

test("dismissed grace prompt becomes mandatory at the deadline without a fresh network response", async t => {
  const { component: c, timers, advance } = setup(t, { now: deadline - 1000 });
  await c.checkRelease(false);
  await vue.nextTick();
  assert.equal(c.open.value, true);
  assert.equal(c.updateRequired.value, false);
  c.dialogOpen.value = false;
  assert.equal(c.open.value, false);
  const timer = [...timers.values()].find(value => value.delay === 1000);
  assert.ok(timer);
  advance(1000);
  timer.callback();
  await vue.nextTick();
  assert.equal(c.updateRequired.value, true);
  assert.equal(c.open.value, true);
  c.dialogOpen.value = false;
  assert.equal(c.open.value, true);
  await c.downloadAndroidUpdate();
  assert.equal(c.open.value, true, "starting an update must not dismiss the mandatory dialog");
});

test("legacy-host clients receive the mandatory prompt and retain browser download", async t => {
  const { component: c, navigations, external } = setup(t, { version: 20, now: deadline, legacy: true });
  await c.checkRelease(false);
  await vue.nextTick();
  assert.equal(c.open.value, true);
  assert.equal(c.updateRequired.value, true);
  assert.ok(navigations.includes("/services"));
  await c.downloadAndroidUpdate();
  assert.equal(external[0], policy.ANDROID_BROWSER_DOWNLOAD_PAGE);
  assert.equal(c.open.value, true);
});

test("an unfinished failed update cannot suppress an expired requirement", async t => {
  const { component: c } = setup(t, { now: deadline, pending: "failed" });
  await c.checkRelease(false);
  await vue.nextTick();
  assert.equal(c.open.value, true);
  assert.equal(c.updateRequired.value, true);
  assert.equal(c.primaryButtonText.value, "重试下载");
});

test("a server upgrade rejection remains actionable even when the manifest fetch fails", async t => {
  const { component: c, external } = setup(t, { fails: true });
  await c.showRequestedPrompt({ source: "auto", required: true });
  await vue.nextTick();
  assert.equal(c.open.value, true);
  assert.equal(c.updateRequired.value, true);
  c.openBrowserDownload();
  assert.equal(external[0], policy.ANDROID_BROWSER_DOWNLOAD_PAGE);
});

test("installed V59 is unaffected by the expired campaign", async t => {
  const { component: c } = setup(t, { version: 59, now: deadline });
  await c.checkRelease(false);
  await vue.nextTick();
  assert.equal(c.updateRequired.value, false);
  assert.equal(c.open.value, false);
});

test("a cached package below V59 offers the latest browser download instead of continuing the old install", async t => {
  const { component: c, external } = setup(t, { now: deadline, pending: "ready", pendingFile: "CPU-Web-Android-V58.apk" });
  await c.checkRelease(false);
  await vue.nextTick();
  assert.equal(c.pendingUpdateUnsupported.value, true);
  assert.equal(c.primaryButtonText.value, "在浏览器下载最新版");
  await c.downloadAndroidUpdate();
  assert.equal(external[0], policy.ANDROID_BROWSER_DOWNLOAD_PAGE);
  assert.equal(c.open.value, true);
});
