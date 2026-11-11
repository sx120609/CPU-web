<template>
  <el-dialog
    v-model="open"
    width="340"
    align-center
    append-to-body
    class="native-update-dialog"
    :show-close="false"
    aria-label="发现新版本"
    @closed="snooze"
  >
    <div class="native-update-panel">
      <img class="update-icon" src="/icon-192-v3.png" alt="" width="56" height="56" />
      <h2 class="update-title">发现新版本</h2>
      <div
        class="update-versions"
        :aria-label="status.currentVersion ? `当前版本 ${status.currentVersion}，新版本 ${status.latestVersion}` : `新版本 ${status.latestVersion}`"
      >
        <template v-if="status.currentVersion">
          <span class="update-version">{{ status.currentVersion }}</span>
          <svg class="update-arrow" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M11 5.5 15.5 10 11 14.5" /></svg>
        </template>
        <span class="update-version is-new">{{ status.latestVersion }}</span>
      </div>
      <div v-if="notes.length" class="update-notes">
        <h3 class="update-notes-title">更新内容</h3>
        <ul>
          <li v-for="(note, index) in notes" :key="index">{{ note }}</li>
        </ul>
      </div>
      <p v-else class="update-lead">新版本已上架，建议更新以获得最新功能和修复。</p>
      <el-button class="update-primary" type="primary" size="large" @click="openStore">{{ storeLabel }}</el-button>
      <div class="update-links">
        <button type="button" @click="open = false">稍后</button>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { siteApi, type NativeAppUpdateStatus } from "@/api/site";
import { useAuthStore } from "@/stores/auth";
import {
  HARMONY_APP_STORE_URL,
  IOS_APP_STORE_URL,
  getHarmonyNativeVersionCode,
  getHarmonyNativeVersionName,
  isHarmonyNativeApp,
  isIosNativeApp,
} from "@/utils/clientInfo";
import {
  NATIVE_UPDATE_SNOOZE_KEY,
  nativeUpdatePlatform,
  parseNativeUpdateSnooze,
  shouldAnnounceNativeUpdate,
  type NativeUpdatePlatform,
} from "@/utils/nativeAppUpdatePrompt";

// Every new store version is announced until the user answers it (稍后, the
// store button or closing the dialog), then again every few days while the app
// is still behind. A dialog that opened behind the native timetable is still
// waiting when the user switches to a Web tab, and counts as unanswered until then.
// The launch heartbeat that reports a freshly updated iOS version may land
// after the page loads; waiting a moment avoids prompting an updated app.
const FIRST_CHECK_DELAY = 8_000;
const RECHECK_INTERVAL = 60 * 60 * 1000;
const MAX_NOTES = 5;

type DialogStatus = NativeAppUpdateStatus & { currentVersion?: string | null };

const auth = useAuthStore();
const platform = ref<NativeUpdatePlatform | null>(null);
const open = ref(false);
const status = ref<DialogStatus>({ updateAvailable: false });
const notes = computed(() => (status.value.notes ?? []).slice(0, MAX_NOTES));
const storeLabel = computed(() => (platform.value === "harmony" ? "前往应用市场更新" : "前往 App Store 更新"));
let timer = 0;
let lastCheck = -Infinity;
let checking = false;

onMounted(() => {
  platform.value = nativeUpdatePlatform(
    isIosNativeApp(),
    isHarmonyNativeApp(),
    navigator.userAgent,
    (window as any).CPUHarmony,
  );
  if (!platform.value) return;
  scheduleCheck();
  document.addEventListener("visibilitychange", onVisible);
});

onBeforeUnmount(() => {
  if (timer) window.clearTimeout(timer);
  document.removeEventListener("visibilitychange", onVisible);
});

// Older iOS builds are matched to the account's install, so signing in is a new chance.
watch(() => auth.isLoggedIn, loggedIn => {
  if (loggedIn && platform.value === "ios" && !timer) {
    lastCheck = -Infinity;
    scheduleCheck();
  }
});

function scheduleCheck() {
  timer = window.setTimeout(() => { timer = 0; void check(); }, FIRST_CHECK_DELAY);
}

function onVisible() {
  if (!document.hidden && performance.now() - lastCheck >= RECHECK_INTERVAL) void check();
}

function readSnooze() {
  try { return parseNativeUpdateSnooze(localStorage.getItem(NATIVE_UPDATE_SNOOZE_KEY)); } catch { return null; }
}

async function fetchStatus(): Promise<DialogStatus | null> {
  if (platform.value === "harmony") {
    const versionCode = getHarmonyNativeVersionCode();
    if (versionCode <= 1) return null;
    const next = await siteApi.harmonyAppUpdate(versionCode);
    return { ...next, currentVersion: getHarmonyNativeVersionName() || null };
  }
  if (!auth.isLoggedIn) return null;
  return siteApi.iosAppUpdate();
}

async function check() {
  if (checking || open.value || document.hidden) return;
  checking = true;
  lastCheck = performance.now();
  try {
    const next = await fetchStatus();
    if (!next?.updateAvailable || !next.latestVersion) return;
    if (!shouldAnnounceNativeUpdate(next.latestVersion, readSnooze(), Date.now())) return;
    status.value = next;
    open.value = true;
  } catch {
    // An update prompt is optional; try again on a later visit.
  } finally {
    checking = false;
  }
}

function snooze() {
  if (!status.value.latestVersion) return;
  try {
    localStorage.setItem(NATIVE_UPDATE_SNOOZE_KEY, JSON.stringify({ version: status.value.latestVersion, at: Date.now() }));
  } catch {
    // Without storage the prompt simply returns on the next visit.
  }
}

function openStore() {
  const harmony = platform.value === "harmony";
  const url = status.value.storeUrl || (harmony ? HARMONY_APP_STORE_URL : IOS_APP_STORE_URL);
  const bridge = (window as any).CPUHarmony;
  if (harmony && typeof bridge?.openExternalUrl === "function") {
    // The shell hands the AppGallery link to the system, which opens 应用市场.
    bridge.openExternalUrl(url);
  } else {
    // The iOS shell hands non-site links to the system, which opens the App Store app.
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
  open.value = false;
}
</script>

<style scoped>
.native-update-panel {
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

.update-notes {
  align-self: stretch;
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: var(--cpu-radius-m);
  background: var(--cpu-surface-soft);
  text-align: left;
}

.update-notes-title {
  margin: 0 0 4px;
  color: var(--cpu-text);
  font-size: var(--cpu-fs-s);
  font-weight: 600;
}

.update-notes ul {
  margin: 0;
  padding-left: 18px;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-s);
  line-height: 1.55;
}

.update-notes li + li {
  margin-top: 4px;
}

.update-primary {
  width: 100%;
  min-height: 48px;
  margin-top: 18px;
  border-radius: var(--cpu-radius-m);
  font-weight: 600;
}

.update-links {
  display: flex;
  justify-content: center;
  margin-top: 6px;
}

.update-links button {
  min-height: 48px;
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
.el-dialog.native-update-dialog {
  max-width: calc(100vw - 48px);
  max-height: calc(100dvh - 32px);
  overflow-y: auto;
  padding: 24px 20px 12px;
  border-radius: 18px;
}

.el-dialog.native-update-dialog .el-dialog__header {
  display: none;
}

.el-dialog.native-update-dialog .el-dialog__body {
  padding: 0;
}
</style>
