<template>
  <el-dialog
    v-model="open"
    title="更新 Android 客户端"
    width="420"
    align-center
    append-to-body
    class="android-update-dialog"
    :close-on-click-modal="true"
  >
    <div class="android-update-panel">
      <p v-if="promptKind === 'install'">
        下载 <b>药大拾间</b> Android 客户端 {{ latestVersionLabel }}。
      </p>
      <p v-else-if="promptKind === 'widget'">
        当前客户端版本较低，更新到 {{ latestVersionLabel }} 后可使用桌面小组件。
      </p>
      <p v-else>
        发现新版本 {{ latestVersionLabel }}，当前版本 {{ currentVersionLabel }}。建议更新后继续使用。
      </p>

      <p v-if="showLegacyMigrationNote" class="migration-note">
        从 2.x 升级到新版架构不会覆盖旧客户端；确认新版可用后，可手动卸载旧版。
      </p>
      <p v-else-if="promptKind !== 'install'" class="muted">
        3.x 客户端可直接覆盖更新。
      </p>
    </div>

    <template #footer>
      <el-button @click="open = false">稍后</el-button>
      <el-button type="primary" @click="downloadAndroidUpdate">
        {{ primaryButtonText }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import {
  ANDROID_UPDATE_PROMPT_EVENT,
  type AndroidUpdatePromptDetail,
  type AndroidUpdatePromptKind,
} from "@/utils/androidUpdatePrompt";
import {
  ANDROID_APP_AUTO_UPDATE_PROMPT_ENABLED,
} from "@/utils/androidUpdatePolicy";
import {
  ANDROID_APP_DOWNLOAD_FILE_NAME,
  ANDROID_APP_DOWNLOAD_URL,
  ANDROID_APP_LATEST_VERSION_CODE,
  ANDROID_APP_LATEST_VERSION_NAME,
  getAndroidNativeVersionCode,
  getAndroidNativeVersionName,
  isAndroidAppUpdateAvailable,
  isAndroidLegacyMajorUpgrade,
  isAndroidNativeApp,
  supportsAndroidInAppApkDownload,
} from "@/utils/clientInfo";
import { shouldAutoPromptAndroidUpdate } from "@/utils/domainMigration";

interface AndroidBridge {
  copyText?: (text: string) => boolean;
  downloadAndInstallApk?: (url: string, fileName: string) => boolean;
  openExternalUrl?: (url: string) => void;
}

const open = ref(false);
const promptKind = ref<AndroidUpdatePromptKind>("app");
let autoPrompted = false;
let autoPromptTimer = 0;

const currentVersionCode = computed(() => getAndroidNativeVersionCode());
const currentVersionName = computed(() => getAndroidNativeVersionName());
const currentVersionLabel = computed(() => {
  if (currentVersionName.value && currentVersionCode.value) return `${currentVersionName.value} (${currentVersionCode.value})`;
  if (currentVersionName.value) return currentVersionName.value;
  if (currentVersionCode.value) return `版本 ${currentVersionCode.value}`;
  return "未知版本";
});
const latestVersionLabel = computed(() => `${ANDROID_APP_LATEST_VERSION_NAME} (${ANDROID_APP_LATEST_VERSION_CODE})`);
const canInAppUpdate = computed(() => supportsAndroidInAppApkDownload());
const showLegacyMigrationNote = computed(() => (
  promptKind.value === "install" || isAndroidLegacyMajorUpgrade()
));
const primaryButtonText = computed(() => {
  if (promptKind.value === "install") return "下载客户端";
  return canInAppUpdate.value ? "下载更新" : "复制下载链接";
});

onMounted(() => {
  window.addEventListener(ANDROID_UPDATE_PROMPT_EVENT, onPromptEvent as EventListener);
  if (ANDROID_APP_AUTO_UPDATE_PROMPT_ENABLED) {
    autoPromptTimer = window.setTimeout(autoPromptIfNeeded, 1200);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener(ANDROID_UPDATE_PROMPT_EVENT, onPromptEvent as EventListener);
  if (autoPromptTimer) window.clearTimeout(autoPromptTimer);
});

function onPromptEvent(event: CustomEvent<AndroidUpdatePromptDetail>) {
  const detail = event.detail ?? {};
  openPrompt(detail.kind ?? "app", detail.source === "auto");
}

function autoPromptIfNeeded() {
  autoPromptTimer = 0;
  if (autoPrompted) return;
  if (!shouldAutoPromptAndroidUpdate(
    window.location.hostname,
    isAndroidAppUpdateAvailable(),
    isAndroidLegacyMajorUpgrade(),
  )) return;
  autoPrompted = true;
  openPrompt("app", true);
}

function openPrompt(kind: AndroidUpdatePromptKind, auto = false) {
  if (kind !== "install" && !isAndroidNativeApp()) return;
  if (kind === "app" && !isAndroidAppUpdateAvailable()) {
    if (!auto) ElMessage.success(`当前已是最新版 ${currentVersionLabel.value}`);
    return;
  }
  promptKind.value = kind;
  open.value = true;
}

async function downloadAndroidUpdate() {
  const absoluteUrl = new URL(ANDROID_APP_DOWNLOAD_URL, window.location.origin).toString();
  if (promptKind.value === "install") {
    openExternalDownload(absoluteUrl);
    open.value = false;
    return;
  }

  const bridge = getAndroidBridge();
  if (canInAppUpdate.value && typeof bridge?.downloadAndInstallApk === "function") {
    const started = bridge.downloadAndInstallApk(absoluteUrl, ANDROID_APP_DOWNLOAD_FILE_NAME);
    if (started !== false) {
      open.value = false;
      ElMessage.success("已开始下载更新");
      return;
    }
  }

  if (await copyDownloadUrl(absoluteUrl, bridge)) {
    open.value = false;
    ElMessage.success("下载链接已复制，请到系统浏览器打开");
    return;
  }
  ElMessage.warning("复制失败，请稍后重试");
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
  color: var(--cpu-text);
  font-size: 14px;
  line-height: 1.75;
}

.android-update-panel p {
  margin: 0;
}

.android-update-panel p + p {
  margin-top: 10px;
}

.android-update-panel b {
  color: var(--cpu-primary);
}

.migration-note,
.muted {
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 12px;
  line-height: 1.6;
}

.migration-note {
  border: 1px solid color-mix(in srgb, var(--cpu-primary) 26%, transparent);
  background: color-mix(in srgb, var(--cpu-primary) 10%, transparent);
  color: var(--cpu-primary);
}

.muted {
  background: var(--cpu-surface-soft);
  color: var(--cpu-text-secondary);
}
</style>
