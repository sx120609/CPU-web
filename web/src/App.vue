<template>
  <el-config-provider :locale="zhCn">
    <router-view />
    <el-dialog
      v-model="inAppTipOpen"
      title="建议使用外部浏览器打开"
      width="420"
      class="in-app-tip-dialog"
      append-to-body
      :close-on-click-modal="inAppReadSeconds <= 0"
      :close-on-press-escape="inAppReadSeconds <= 0"
      :show-close="inAppReadSeconds <= 0"
    >
      <div class="in-app-tip">
        <p>
          当前可能正在{{ inAppBrowserLabel }}内打开本站。部分学校系统、统一认证或外部跳转页面可能无法正常加载。
        </p>
        <p>
          建议点击右上角菜单，选择“在浏览器打开”或“用默认浏览器打开”后继续使用。
        </p>
        <p class="muted">
          如果只是浏览站内内容，也可以继续使用当前页面。
        </p>
      </div>
      <template #footer>
        <el-button type="primary" :disabled="inAppReadSeconds > 0" @click="dismissInAppTip">
          {{ inAppReadSeconds > 0 ? `请先阅读 ${inAppReadSeconds}s` : "我知道了" }}
        </el-button>
      </template>
    </el-dialog>
  </el-config-provider>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import { detectInAppBrowser } from "@/utils/inAppBrowser";

const inAppTipOpen = ref(false);
const inAppBrowserLabel = ref("微信 / QQ");
const inAppReadSeconds = ref(0);
let inAppReadTimer: number | null = null;

onMounted(() => {
  const info = detectInAppBrowser();
  if (!info.isInApp) return;
  inAppBrowserLabel.value = info.label;
  inAppTipOpen.value = true;
});

watch(inAppTipOpen, (open) => {
  if (open) startInAppReadTimer();
  else clearInAppReadTimer();
});

onBeforeUnmount(() => {
  clearInAppReadTimer();
});

function dismissInAppTip() {
  if (inAppReadSeconds.value > 0) return;
  inAppTipOpen.value = false;
}

function startInAppReadTimer() {
  clearInAppReadTimer();
  inAppReadSeconds.value = 3;
  inAppReadTimer = window.setInterval(() => {
    inAppReadSeconds.value -= 1;
    if (inAppReadSeconds.value <= 0) {
      clearInAppReadTimer();
    }
  }, 1000);
}

function clearInAppReadTimer() {
  if (inAppReadTimer) {
    window.clearInterval(inAppReadTimer);
    inAppReadTimer = null;
  }
  if (!inAppTipOpen.value) inAppReadSeconds.value = 0;
}
</script>

<style lang="scss">
html, body, #app {
  height: 100%;
  margin: 0;
}

.in-app-tip {
  color: #374151;
  font-size: 14px;
  line-height: 1.7;

  p {
    margin: 0 0 8px;
  }

  .muted {
    color: #6b7280;
    font-size: 13px;
  }
}

@media (max-width: 480px) {
  .in-app-tip-dialog {
    --el-dialog-width: calc(100vw - 24px);
  }
}
</style>
