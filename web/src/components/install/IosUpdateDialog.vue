<template>
  <el-dialog
    v-model="open"
    width="340"
    align-center
    append-to-body
    class="ios-update-dialog"
    :show-close="false"
    aria-label="发现新版本"
  >
    <div class="ios-update-panel">
      <img class="update-icon" src="/icon-192-v3.png" alt="" width="56" height="56" />
      <h2 class="update-title">发现新版本</h2>
      <div class="update-versions" :aria-label="`当前版本 ${status.currentVersion}，新版本 ${status.latestVersion}`">
        <span class="update-version">{{ status.currentVersion }}</span>
        <svg class="update-arrow" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M11 5.5 15.5 10 11 14.5" /></svg>
        <span class="update-version is-new">{{ status.latestVersion }}</span>
      </div>
      <p class="update-lead">近期更新频繁，建议持续追更，获得更好体验。</p>
      <el-button class="update-primary" type="primary" size="large" @click="openAppStore">前往 App Store 更新</el-button>
      <div class="update-links">
        <button type="button" @click="open = false">稍后</button>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { siteApi, type IosAppUpdateStatus } from "@/api/site";
import { useAuthStore } from "@/stores/auth";
import { IOS_APP_STORE_URL, isIosNativeApp } from "@/utils/clientInfo";

// Each App Store version prompts once per device. The shell shares one Web
// view across its tabs, so a prompt opened behind the native timetable is
// still waiting when the user switches to a Web tab.
const SEEN_KEY = "cpu-ios-update-prompted";
// The launch heartbeat that reports a freshly updated version may land after
// the page loads; waiting a moment avoids prompting an already-updated app.
const FIRST_CHECK_DELAY = 8_000;
const RECHECK_INTERVAL = 60 * 60 * 1000;

const auth = useAuthStore();
const open = ref(false);
const status = ref<IosAppUpdateStatus>({ updateAvailable: false });
let timer = 0;
let lastCheck = -Infinity;
let checking = false;

onMounted(() => {
  if (!isIosNativeApp()) return;
  timer = window.setTimeout(() => { timer = 0; void check(); }, FIRST_CHECK_DELAY);
  document.addEventListener("visibilitychange", onVisible);
});

onBeforeUnmount(() => {
  if (timer) window.clearTimeout(timer);
  document.removeEventListener("visibilitychange", onVisible);
});

watch(() => auth.isLoggedIn, loggedIn => {
  if (loggedIn && isIosNativeApp() && !timer) {
    lastCheck = -Infinity;
    timer = window.setTimeout(() => { timer = 0; void check(); }, FIRST_CHECK_DELAY);
  }
});

function onVisible() {
  if (!document.hidden && performance.now() - lastCheck >= RECHECK_INTERVAL) void check();
}

function readSeen() {
  try { return localStorage.getItem(SEEN_KEY) ?? ""; } catch { return ""; }
}

async function check() {
  if (checking || open.value || !auth.isLoggedIn || document.hidden) return;
  checking = true;
  lastCheck = performance.now();
  try {
    const next = await siteApi.iosAppUpdate();
    if (!next?.updateAvailable || !next.latestVersion || !next.currentVersion) return;
    if (readSeen() === next.latestVersion) return;
    try { localStorage.setItem(SEEN_KEY, next.latestVersion); } catch { /* prompt anyway */ }
    status.value = next;
    open.value = true;
  } catch {
    // An update prompt is optional; try again on a later visit.
  } finally {
    checking = false;
  }
}

function openAppStore() {
  // The shell hands non-site links to the system, which opens the App Store app.
  const link = document.createElement("a");
  link.href = status.value.storeUrl || IOS_APP_STORE_URL;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
  open.value = false;
}
</script>

<style scoped>
.ios-update-panel {
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
.el-dialog.ios-update-dialog {
  max-width: calc(100vw - 48px);
  max-height: calc(100dvh - 32px);
  overflow-y: auto;
  padding: 24px 20px 12px;
  border-radius: 18px;
}

.el-dialog.ios-update-dialog .el-dialog__header {
  display: none;
}

.el-dialog.ios-update-dialog .el-dialog__body {
  padding: 0;
}
</style>
