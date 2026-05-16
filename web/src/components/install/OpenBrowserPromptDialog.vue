<template>
  <el-dialog
    v-model="open"
    title="请在外部浏览器打开课表"
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
      <ol class="steps">
        <li>
          <span class="num">1</span>
          <span class="step-text">点击右上角菜单</span>
        </li>
        <li>
          <span class="num">2</span>
          <span class="step-text">
            选择 <strong>“在浏览器打开”</strong> 或 <strong>“用默认浏览器打开”</strong>
          </span>
        </li>
        <li>
          <span class="num">3</span>
          <span class="step-text">
            进入外部浏览器后，再按页面提示继续
          </span>
        </li>
      </ol>
      <p class="muted">
        微信 / QQ 内置浏览器不支持完整的添加桌面或安装流程。
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
import { computed, ref } from "vue";
import { detectInAppBrowser } from "@/utils/inAppBrowser";

const open = ref(false);
const inAppBrowser = computed(() => detectInAppBrowser());

const dialogWidth = computed(() => window.innerWidth < 480 ? "92vw" : "380px");

function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;
}

function isNativeApp() {
  const ua = navigator.userAgent.toLowerCase();
  const params = new URLSearchParams(window.location.search);
  return ua.includes("cpuwebscheduleapp") || params.get("client") === "android-app";
}

function dismissDialog() {
  open.value = false;
}

function openDialog() {
  if (!inAppBrowser.value.isInApp || isStandalone() || isNativeApp()) return;
  open.value = true;
}

function autoPromptIfEligible() {
  if (!inAppBrowser.value.isInApp || isStandalone() || isNativeApp()) return;
  setTimeout(() => {
    if (detectInAppBrowser().isInApp && !isStandalone() && !isNativeApp()) open.value = true;
  }, 1500);
}

defineExpose({ openDialog, autoPromptIfEligible });
</script>

<style scoped>
.content {
  color: #1f2937;
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
  color: #168776;
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
  color: #374151;
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
  background: #e8f7f3;
  color: #168776;
  font-size: 12px;
  font-weight: 700;
}

.muted {
  color: #6b7280;
  font-size: 12px;
}

.footer {
  display: flex;
  justify-content: flex-end;
}
</style>
