<template>
  <el-dialog
    v-model="open"
    width="340"
    align-center
    append-to-body
    class="android-update-dialog"
    :show-close="false"
    :close-on-click-modal="true"
    :aria-label="headline"
  >
    <div class="android-update-panel">
      <img class="update-icon" src="/icon-192-v3.png" alt="" width="56" height="56" />
      <h2 class="update-title">{{ headline }}</h2>

      <div v-if="showVersionStep" class="update-versions" :aria-label="`当前版本 ${currentVersionShort}，新版本 ${latestRelease.versionName}`">
        <span class="update-version">{{ currentVersionShort }}</span>
        <svg class="update-arrow" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M11 5.5 15.5 10 11 14.5" /></svg>
        <span class="update-version is-new">{{ latestRelease.versionName }}</span>
      </div>

      <div v-if="hasPendingUpdate" class="update-status" aria-live="polite">
        <div class="update-status-line">
          <span>{{ nativeUpdate.message || '正在读取更新状态' }}</span>
          <span v-if="showPercent" class="update-percent">{{ nativeUpdate.progress }}%</span>
        </div>
        <el-progress
          v-if="nativeUpdate.phase !== 'failed'"
          :percentage="nativeUpdate.progress"
          :indeterminate="nativeUpdate.totalBytes <= 0 && updateBusy"
          :show-text="false"
          :stroke-width="6"
        />
      </div>
      <p v-else-if="saveOnly" class="update-lead">
        当前已安装 {{ currentVersionLabel }}，无需重复安装。需要保存安装包时，可以在浏览器下载。
      </p>
      <p v-else-if="promptKind === 'install'" class="update-lead">
        下载药大拾间 Android 客户端 {{ latestVersionLabel }}。
      </p>
      <p v-else-if="promptKind === 'widget'" class="update-lead">
        当前客户端版本较低，更新后可使用桌面小组件。
      </p>
      <p v-else class="update-lead">建议更新后继续使用。</p>

      <ul v-if="notes.length" class="update-notes">
        <li v-for="note in notes" :key="note">{{ note }}</li>
      </ul>

      <el-button class="update-primary" type="primary" size="large" :disabled="updateBusy" @click="downloadAndroidUpdate">
        {{ primaryButtonText }}
      </el-button>
      <div class="update-links">
        <button type="button" @click="open = false">稍后</button>
        <button v-if="canInAppUpdate" type="button" @click="openBrowserDownload">浏览器下载</button>
        <button v-if="isAndroidNativeApp()" type="button" @click="copyBrowserDownload">复制下载链接</button>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { parseAndroidUpdateState } from "@/utils/androidUpdateState";
import { fetchAndroidRelease } from "@/utils/androidReleaseCheck";
import { isAndroidUpdateAvailable } from "@/utils/androidUpdatePolicy";
import { ElMessage } from "element-plus";
import {
  ANDROID_UPDATE_PROMPT_EVENT,
  type AndroidUpdatePromptDetail,
  type AndroidUpdatePromptKind,
} from "@/utils/androidUpdatePrompt";
import {
  ANDROID_APP_AUTO_UPDATE_PROMPT_ENABLED,
  ANDROID_BROWSER_DOWNLOAD_PAGE,
  shouldPromptAndroidInstallRepair,
  isObsoleteAndroidUpdateFailure,
} from "@/utils/androidUpdatePolicy";
import {
  ANDROID_APP_DOWNLOAD_FILE_NAME,
  ANDROID_APP_DOWNLOAD_URL,
  ANDROID_APP_LATEST_VERSION_CODE,
  ANDROID_APP_LATEST_VERSION_NAME,
  canInstallAndroidApk,
  getAndroidNativeVersionCode,
  getAndroidNativeVersionName,
  isAndroidLegacyMajorUpgrade,
  isAndroidNativeApp,
  supportsAndroidInAppApkDownload,
} from "@/utils/clientInfo";
import { shouldAutoPromptAndroidUpdate } from "@/utils/domainMigration";

interface AndroidBridge {
  supportsNativeUpdatePrompt?: () => boolean;
  copyText?: (text: string) => boolean;
  downloadAndInstallApk?: (url: string, fileName: string) => boolean;
  openExternalUrl?: (url: string) => void;
  supportsPersistentApkUpdate?: () => boolean;
  getApkUpdateState?: () => string;
  continueApkInstall?: () => boolean;
  retryApkUpdate?: () => boolean;
}

const router = useRouter();
const open = ref(false);
function notifyNativeUpdateVisibility(visible: boolean) {
  if (isAndroidNativeApp()) (window as any).CPUTimeNative?.postNative?.({ type: "androidUpdatePrompt", visible });
}
watch(open, notifyNativeUpdateVisibility, { flush: "post" });
const promptKind = ref<AndroidUpdatePromptKind>("app");
let autoPromptedVersion = 0;
let autoPromptTimer = 0;
let updatePollTimer = 0;
let releasePollTimer = 0;
let lastReleaseCheck = 0;
let releaseCheck: Promise<void> | null = null;
let disposed = false;
const latestRelease = ref({ versionCode: ANDROID_APP_LATEST_VERSION_CODE, versionName: ANDROID_APP_LATEST_VERSION_NAME, fileName: ANDROID_APP_DOWNLOAD_FILE_NAME });
const updateAvailable = computed(() => isAndroidUpdateAvailable(isAndroidNativeApp(), currentVersionCode.value, latestRelease.value.versionCode));
const nativeUpdate = ref(parseAndroidUpdateState("{}"));
const hasPendingUpdate = computed(() => nativeUpdate.value.phase !== "idle");
const updateBusy = computed(() => ["downloading", "paused", "validating", "installing"].includes(nativeUpdate.value.phase));

const currentVersionCode = computed(() => getAndroidNativeVersionCode());
const currentVersionName = computed(() => getAndroidNativeVersionName());
const currentVersionLabel = computed(() => {
  if (currentVersionName.value && currentVersionCode.value) return `${currentVersionName.value} (${currentVersionCode.value})`;
  if (currentVersionName.value) return currentVersionName.value;
  if (currentVersionCode.value) return `版本 ${currentVersionCode.value}`;
  return "未知版本";
});
const latestVersionLabel = computed(() => `${latestRelease.value.versionName} (${latestRelease.value.versionCode})`);
const canInAppUpdate = computed(() => supportsAndroidInAppApkDownload());
const saveOnly = computed(() => promptKind.value === "install" && isAndroidNativeApp() && !updateAvailable.value && !hasPendingUpdate.value);
const needsBrowserUpdate = computed(() => isAndroidNativeApp() && !canInAppUpdate.value);
const showLegacyMigrationNote = computed(() => (
  (promptKind.value === "install" && !isAndroidNativeApp()) || isAndroidLegacyMajorUpgrade()
));
const currentVersionShort = computed(() => currentVersionName.value || (currentVersionCode.value ? `版本 ${currentVersionCode.value}` : "未知版本"));
const showVersionStep = computed(() => isAndroidNativeApp() && updateAvailable.value && !saveOnly.value);
const showPercent = computed(() => nativeUpdate.value.phase === "downloading" && nativeUpdate.value.totalBytes > 0);
const headline = computed(() => {
  if (nativeUpdate.value.phase === "failed") return "更新没有完成";
  if (["ready", "permission"].includes(nativeUpdate.value.phase)) return "更新已下载";
  if (hasPendingUpdate.value) return "正在更新";
  if (saveOnly.value) return "已是最新版";
  if (promptKind.value === "install") return "下载 Android 客户端";
  return "发现新版本";
});
const notes = computed(() => {
  const list: string[] = [];
  if (showLegacyMigrationNote.value) list.push("从 2.x 升级到新版架构不会覆盖旧客户端；确认新版可用后，可手动卸载旧版。");
  else if (promptKind.value !== "install") list.push("可直接覆盖更新，无需卸载当前客户端。");
  if (needsBrowserUpdate.value) {
    list.push("旧版应用内更新可能提示“解析软件包时出现问题”。请在系统浏览器下载新版，下载完成后打开 APK 安装，无需卸载当前 3.x 客户端。");
    list.push("如果浏览器没有打开，请复制下载链接，粘贴到系统浏览器中打开。");
  }
  return list;
});
const primaryButtonText = computed(() => {
  if (saveOnly.value) return "在浏览器保存安装包";
  if (["ready", "permission"].includes(nativeUpdate.value.phase)) return "继续安装";
  if (nativeUpdate.value.phase === "failed") return "重试下载";
  if (updateBusy.value) return nativeUpdate.value.phase === "paused" ? "等待网络" : "更新进行中";
  if (needsBrowserUpdate.value) return "在浏览器下载";
  if (promptKind.value === "install") return "下载客户端";
  return canInAppUpdate.value ? "下载更新" : "在浏览器下载";
});

onMounted(() => {
  window.addEventListener(ANDROID_UPDATE_PROMPT_EVENT, onPromptEvent as EventListener);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
  resumeUpdateStatus();
  if (ANDROID_APP_AUTO_UPDATE_PROMPT_ENABLED || shouldPromptAndroidInstallRepair(isAndroidNativeApp(), currentVersionCode.value)) {
    autoPromptTimer = window.setTimeout(() => { void checkRelease(false); }, 1200);
    releasePollTimer = window.setInterval(() => { void checkRelease(false); }, 300_000);
  }
});

onBeforeUnmount(() => {
  disposed = true;
  notifyNativeUpdateVisibility(false);
  window.removeEventListener(ANDROID_UPDATE_PROMPT_EVENT, onPromptEvent as EventListener);
  if (autoPromptTimer) window.clearTimeout(autoPromptTimer);
  if (updatePollTimer) window.clearInterval(updatePollTimer);
  if (releasePollTimer) window.clearInterval(releasePollTimer);
  document.removeEventListener("visibilitychange", onVisible);
  window.removeEventListener("focus", onVisible);
});

function onVisible() {
  resumeUpdateStatus();
  if (!document.hidden) void checkRelease(false);
}

async function checkRelease(manual: boolean): Promise<boolean> {
  if (!isAndroidNativeApp() || (!manual && document.hidden)) return false;
  if (!manual && lastReleaseCheck && Date.now() - lastReleaseCheck < 60_000) return true;
  try {
    if (!releaseCheck) {
      releaseCheck = fetchAndroidRelease().then(value => {
        if (!disposed) latestRelease.value = value;
        lastReleaseCheck = Date.now();
      }).finally(() => { releaseCheck = null; });
    }
    await releaseCheck;
    if (disposed) return false;
    if (!manual) autoPromptIfNeeded();
    return true;
  } catch {
    if (manual) ElMessage.warning("暂时无法检查更新，请稍后重试");
    return false;
  }
}

function readUpdateStatus() {
  const bridge = getAndroidBridge();
  try {
    if (bridge?.supportsPersistentApkUpdate?.() !== true || typeof bridge.getApkUpdateState !== "function") return false;
    const state = parseAndroidUpdateState(bridge.getApkUpdateState());
    nativeUpdate.value = isObsoleteAndroidUpdateFailure(state.phase, state.fileName, currentVersionCode.value)
      ? parseAndroidUpdateState("{}") : state;
    return true;
  } catch { return false; }
}

function pollUpdateStatus() {
  if (updatePollTimer) return;
  updatePollTimer = window.setInterval(() => {
    if (document.hidden) return;
    if (!readUpdateStatus() || (!open.value && !hasPendingUpdate.value)) {
      window.clearInterval(updatePollTimer);
      updatePollTimer = 0;
    }
  }, 1500);
}

function resumeUpdateStatus() {
  if (document.hidden || !readUpdateStatus()) return;
  if (hasPendingUpdate.value) {
    if (nativeUpdate.value.phase !== "failed") open.value = true;
    pollUpdateStatus();
  }
}

function onPromptEvent(event: Event) {
  void showRequestedPrompt((event as CustomEvent<AndroidUpdatePromptDetail>).detail ?? {});
}

async function showRequestedPrompt(detail: AndroidUpdatePromptDetail) {
  readUpdateStatus();
  if (isAndroidNativeApp() && !hasPendingUpdate.value && !await checkRelease(true)) return;
  openPrompt(detail.kind ?? "app", detail.source === "auto");
}

function autoPromptIfNeeded() {
  autoPromptTimer = 0;
  if (autoPromptedVersion === latestRelease.value.versionCode || hasPendingUpdate.value) return;
  if (!shouldAutoPromptAndroidUpdate(
    window.location.hostname,
    updateAvailable.value,
    isAndroidLegacyMajorUpgrade(),
  )) return;
  autoPromptedVersion = latestRelease.value.versionCode;
  if (!ANDROID_APP_AUTO_UPDATE_PROMPT_ENABLED) {
    const key = `cpu-android-install-repair-${latestRelease.value.versionCode}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
    } catch { /* storage may be unavailable */ }
  }
  openPrompt("app", true);
}

function openPrompt(kind: AndroidUpdatePromptKind, auto = false) {
  if (kind !== "install" && !isAndroidNativeApp()) return;
  // An APK cannot be installed on iOS/iPadOS or HarmonyOS NEXT; the download page offers their store builds.
  if (kind === "install" && !isAndroidNativeApp() && !canInstallAndroidApk()) {
    void router.push("/download");
    return;
  }
  readUpdateStatus();
  if (kind === "app" && !updateAvailable.value && !hasPendingUpdate.value) {
    if (!auto) ElMessage.success(`当前已是最新版 ${currentVersionLabel.value}`);
    return;
  }
  promptKind.value = kind;
  // Older native shells always cover the WebView with their timetable. Move
  // the one-time automatic prompt onto an existing Web tab so those clients
  // can actually discover the upgrade that adds native overlay support.
  if (auto && isAndroidNativeApp()) {
    const shell = (window as any).CPUTimeNative;
    let nativePrompt = false;
    try { nativePrompt = getAndroidBridge()?.supportsNativeUpdatePrompt?.() === true; } catch { /* older shell */ }
    if (!nativePrompt && typeof shell?.navigate === "function") shell.navigate("/services");
  }
  open.value = true;
  if (hasPendingUpdate.value) pollUpdateStatus();
}

async function downloadAndroidUpdate() {
  const currentBridge = getAndroidBridge();
  if (saveOnly.value) {
    openExternalDownload(new URL(ANDROID_APP_DOWNLOAD_URL, window.location.origin).toString());
    open.value = false;
    return;
  }
  if (["ready", "permission"].includes(nativeUpdate.value.phase)) {
    try {
      if (currentBridge?.continueApkInstall?.() !== true) ElMessage.warning("无法继续安装，请重试或使用浏览器下载");
    } catch { ElMessage.warning("无法继续安装，请重试或使用浏览器下载"); }
    readUpdateStatus();
    pollUpdateStatus();
    return;
  }
  if (nativeUpdate.value.phase === "failed") {
    try {
      if (currentBridge?.retryApkUpdate?.() !== true) ElMessage.warning("重试未能开始，请使用浏览器下载");
    } catch { ElMessage.warning("重试未能开始，请使用浏览器下载"); }
    readUpdateStatus();
    pollUpdateStatus();
    return;
  }
  if (needsBrowserUpdate.value) {
    openBrowserDownload();
    return;
  }
  const absoluteUrl = new URL(ANDROID_APP_DOWNLOAD_URL, window.location.origin).toString();
  if (promptKind.value === "install" && !isAndroidNativeApp()) {
    openExternalDownload(absoluteUrl);
    open.value = false;
    return;
  }

  const bridge = getAndroidBridge();
  if (canInAppUpdate.value && typeof bridge?.downloadAndInstallApk === "function") {
    try {
      const started = bridge.downloadAndInstallApk(absoluteUrl, latestRelease.value.fileName);
      if (started !== false) {
        if (readUpdateStatus()) pollUpdateStatus();
        else open.value = false;
        ElMessage.success("已开始下载更新");
        return;
      }
    } catch { /* keep the browser fallback available */ }
  }

  openBrowserDownload();
}

function openBrowserDownload() {
  try {
    openExternalDownload(ANDROID_BROWSER_DOWNLOAD_PAGE);
    ElMessage.info("请在浏览器下载并安装；未打开时可复制下载链接");
  } catch {
    ElMessage.warning("无法打开浏览器，请复制下载链接后手动打开");
  }
}

async function copyBrowserDownload() {
  if (await copyDownloadUrl(ANDROID_BROWSER_DOWNLOAD_PAGE, getAndroidBridge())) {
    ElMessage.success("下载链接已复制，请到系统浏览器打开");
  } else {
    ElMessage.warning("复制失败，请在浏览器打开 cputime.cn/download");
  }
}

function getAndroidBridge(): AndroidBridge | null {
  return ((window as any).CPUAndroid ?? null) as AndroidBridge | null;
}

function openExternalDownload(url: string) {
  const bridge = getAndroidBridge();
  if (typeof bridge?.openExternalUrl === "function") {
    bridge.openExternalUrl(url);
    return;
  }
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function copyDownloadUrl(url: string, bridge: AndroidBridge | null) {
  try {
    if (typeof bridge?.copyText === "function" && bridge.copyText(url) !== false) return true;
  } catch {
    /* continue to clipboard */
  }
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(url);
      return true;
    }
  } catch {
    /* continue to legacy copy */
  }
  const textarea = document.createElement("textarea");
  textarea.value = url;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "0";
  textarea.style.top = "0";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus({ preventScroll: true });
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  const ok = document.execCommand("copy");
  textarea.remove();
  return ok;
}
</script>

<style scoped>
.android-update-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  color: var(--cpu-text);
  font-size: var(--cpu-fs-m);
  line-height: 1.6;
  text-align: center;
}

.update-icon {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  box-shadow: var(--cpu-shadow-sm);
}

.update-title {
  margin: 14px 0 0;
  font-size: var(--cpu-fs-xl);
  font-weight: 650;
  line-height: 1.3;
}

.update-versions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  font-size: var(--cpu-fs-s);
  font-variant-numeric: tabular-nums;
}

.update-version {
  padding: 2px 10px;
  border-radius: var(--cpu-radius-pill);
  background: var(--cpu-surface-soft);
  color: var(--cpu-text-secondary);
}

.update-version.is-new {
  background: var(--cpu-primary-soft);
  color: var(--cpu-primary);
  font-weight: 600;
}

.update-arrow {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: var(--cpu-text-muted);
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.update-lead {
  margin: 10px 0 0;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-s);
}

.update-status {
  width: 100%;
  margin-top: 16px;
  text-align: left;
}

.update-status-line {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-s);
}

.update-percent {
  flex: none;
  color: var(--cpu-text);
  font-variant-numeric: tabular-nums;
}

.update-notes {
  width: 100%;
  margin: 16px 0 0;
  padding: 12px 0 0;
  border-top: 1px solid var(--cpu-border-soft);
  list-style: none;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-xs);
  line-height: 1.6;
  text-align: left;
}

.update-notes li + li {
  margin-top: 6px;
}

.update-primary {
  width: 100%;
  margin-top: 18px;
  border-radius: var(--cpu-radius-m);
  font-weight: 600;
}

.update-links {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px 6px;
  margin-top: 6px;
}

.update-links button {
  min-height: 36px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--cpu-radius-s);
  background: none;
  color: var(--cpu-text-secondary);
  font: inherit;
  font-size: var(--cpu-fs-s);
  cursor: pointer;
}

.update-links button:active {
  background: var(--cpu-surface-soft);
}

.update-links button:focus-visible {
  outline: 2px solid var(--cpu-primary);
  outline-offset: 1px;
}
</style>

<style>
.el-dialog.android-update-dialog {
  max-width: calc(100vw - 48px);
  padding: 24px 20px 12px;
  border-radius: 18px;
}

.el-dialog.android-update-dialog .el-dialog__header {
  display: none;
}

.el-dialog.android-update-dialog .el-dialog__body {
  padding: 0;
}
</style>
