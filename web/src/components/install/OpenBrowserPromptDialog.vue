<template>
  <el-dialog
    v-model="open"
    title="选择下载 / 安装方式"
    :width="dialogWidth"
    align-center
    append-to-body
    class="open-browser-dialog"
  >
    <div class="content">
      <p>
        当前可能正在 <b>{{ inAppBrowser.label || "微信 / QQ" }}</b> 内打开课表。
        内置浏览器会限制添加到主屏幕，也可能拦截安装流程。
      </p>

      <div class="platform-picker" role="group" aria-label="选择设备类型">
        <button
          type="button"
          :class="{ active: selectedPlatform === 'android' }"
          @click="selectedPlatform = 'android'"
        >
          安卓
        </button>
        <button
          type="button"
          :class="{ active: selectedPlatform === 'ios' }"
          @click="selectedPlatform = 'ios'"
        >
          iOS
        </button>
      </div>

      <template v-if="selectedPlatform === 'android'">
        <ol class="steps">
          <li>
            <span class="num">1</span>
            <span class="step-text">点击下方按钮复制 APK 下载链接</span>
          </li>
          <li>
            <span class="num">2</span>
            <span class="step-text">打开手机系统浏览器，粘贴链接并访问</span>
          </li>
          <li>
            <span class="num">3</span>
            <span class="step-text">下载完成后打开安装包，按系统提示安装</span>
          </li>
        </ol>
        <div class="copy-card">
          <code>{{ androidDownloadUrl }}</code>
          <el-button type="primary" size="small" @click="copyAndroidDownloadUrl">
            复制下载链接
          </el-button>
        </div>
        <p class="muted">如果系统提示“未知来源”，请允许当前浏览器安装应用。</p>
      </template>

      <template v-else>
        <ol class="steps">
          <li>
            <span class="num">1</span>
            <span class="step-text">点击右上角菜单，选择 <strong>“在浏览器打开”</strong></span>
          </li>
          <li>
            <span class="num">2</span>
            <span class="step-text">确认跳转到 <strong>Safari</strong> 后打开课表页</span>
          </li>
          <li>
            <span class="num">3</span>
            <span class="step-text">根据页面提示，把课表添加到主屏幕</span>
          </li>
        </ol>
        <div class="copy-card">
          <code>{{ schedulePageUrl }}</code>
          <el-button size="small" @click="copySchedulePageUrl">
            复制课表页链接
          </el-button>
        </div>
        <p class="muted">iOS 必须使用 Safari；微信 / QQ 内置浏览器不支持添加到主屏幕。</p>
      </template>

      <p class="support-note">
        仍有疑问，建议
        <button type="button" @click="openUserGroup">加入用户 QQ 群 {{ USER_QQ_GROUP }}</button>
        咨询。
      </p>
    </div>

    <template #footer>
      <div class="footer">
        <el-button type="primary" @click="dismissDialog">我知道了</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { ElMessage } from "element-plus";
import { detectInAppBrowser } from "@/utils/inAppBrowser";
import { ANDROID_APP_DOWNLOAD_URL, isFlutterNativeShell } from "@/utils/clientInfo";
import { USER_QQ_GROUP, copyText, openUserGroup } from "@/utils/userGroup";

const open = ref(false);
const inAppBrowser = computed(() => detectInAppBrowser());
const selectedPlatform = ref<"android" | "ios">(detectDevicePlatform());
let autoPromptTimer: number | null = null;
let disposed = false;

const dialogWidth = computed(() => window.innerWidth < 480 ? "92dvw" : "380px");
const androidDownloadUrl = computed(() => new URL(ANDROID_APP_DOWNLOAD_URL, window.location.origin).toString());
const schedulePageUrl = computed(() => new URL("/schedule", window.location.origin).toString());

function detectDevicePlatform(): "android" | "ios" {
  const ua = navigator.userAgent.toLowerCase();
  const looksLikeIos = /iphone|ipad|ipod/.test(ua) || (ua.includes("mac") && navigator.maxTouchPoints > 1);
  return looksLikeIos ? "ios" : "android";
}

function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;
}

function isNativeApp() {
  const ua = navigator.userAgent.toLowerCase();
  const params = new URLSearchParams(window.location.search);
  return ua.includes("cpuwebscheduleapp")
    || ua.includes("cpuwebharmonyapp")
    || isFlutterNativeShell()
    || params.get("client") === "android-app"
    || params.get("client") === "harmony-app";
}

function dismissDialog() {
  open.value = false;
}

onBeforeUnmount(() => {
  disposed = true;
  clearAutoPromptTimer();
});

function clearAutoPromptTimer() {
  if (autoPromptTimer) {
    window.clearTimeout(autoPromptTimer);
    autoPromptTimer = null;
  }
}

async function copyAndroidDownloadUrl() {
  await copyText(androidDownloadUrl.value);
  ElMessage.success("已复制 APK 下载链接");
}

async function copySchedulePageUrl() {
  await copyText(schedulePageUrl.value);
  ElMessage.success("已复制课表页链接");
}

function openDialog() {
  if (disposed) return;
  if (!inAppBrowser.value.isInApp || isStandalone() || isNativeApp()) return;
  selectedPlatform.value = detectDevicePlatform();
  open.value = true;
}

function autoPromptIfEligible() {
  if (disposed) return;
  if (!inAppBrowser.value.isInApp || isStandalone() || isNativeApp()) return;
  clearAutoPromptTimer();
  autoPromptTimer = window.setTimeout(() => {
    autoPromptTimer = null;
    if (disposed) return;
    if (detectInAppBrowser().isInApp && !isStandalone() && !isNativeApp()) {
      selectedPlatform.value = detectDevicePlatform();
      open.value = true;
    }
  }, 1500);
}

defineExpose({ openDialog, autoPromptIfEligible });
</script>

<style scoped>
.content {
  color: var(--cpu-text);
  font-size: 14px;
  line-height: 1.7;
  max-width: 100%;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.content p {
  margin: 0 0 12px;
}

.content b,
.content strong {
  color: var(--cpu-primary);
}

.platform-picker {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin: 12px 0;
}

.platform-picker button {
  appearance: none;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  background: var(--cpu-surface-soft);
  color: var(--cpu-text-secondary);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  min-height: 38px;
  padding: 8px 10px;
}

.platform-picker button.active {
  border-color: var(--cpu-primary);
  background: var(--el-color-primary-light-9);
  color: var(--cpu-primary);
}

.steps {
  display: grid;
  gap: 10px;
  list-style: none;
  margin: 12px 0;
  padding: 0;
}

.steps li {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  align-items: start;
  gap: 8px;
  color: var(--cpu-text);
  min-width: 0;
}

.step-text {
  display: block;
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: var(--el-color-primary-light-9);
  color: var(--cpu-primary);
  font-size: 12px;
  font-weight: 700;
}

.muted {
  color: var(--cpu-text-secondary);
  font-size: 12px;
}

.copy-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  margin: 12px 0;
  padding: 10px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  background: var(--cpu-surface-soft);
}

.copy-card code {
  display: block;
  min-width: 0;
  color: var(--cpu-text-secondary);
  font-size: 11px;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.support-note {
  color: var(--cpu-text-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.support-note button {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--cpu-primary);
  font: inherit;
  font-weight: 650;
  padding: 0;
  cursor: pointer;
}

.footer {
  display: flex;
  justify-content: flex-end;
}

@media (max-width: 420px) {
  .copy-card {
    grid-template-columns: 1fr;
  }

  .copy-card code {
    white-space: normal;
    overflow-wrap: anywhere;
  }
}
</style>
