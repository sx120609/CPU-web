<template>
  <el-config-provider :locale="zhCn" :z-index="5000">
    <router-view />
    <el-dialog
      v-model="dataAuthOpen"
      title="数据授权安全协议"
      width="480"
      class="data-auth-dialog"
      append-to-body
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="false"
    >
      <div class="data-auth">
        <div class="auth-head">
          <el-tag size="small" type="warning" effect="plain">首次使用</el-tag>
          <span class="auth-sub">请先阅读后继续</span>
        </div>
        <p>
          你正在使用学校统一身份认证登录本站。授权后，本站会读取课表、成绩、考试和培养方案等信息，仅用于你本人查看。
        </p>
        <p>
          学校密码和验证码不会保存到本站；如勾选“记住账号”，信息也只保存在当前设备浏览器中。请勿在公共设备上使用。
        </p>
        <p>
          继续点击同意，表示你已了解以上说明。
        </p>
      </div>
      <template #footer>
        <div class="data-auth-footer">
          <span class="read-hint">请先阅读 {{ dataAuthReadSeconds }}s</span>
          <el-button type="primary" :disabled="dataAuthReadSeconds > 0" @click="acceptDataAuth">
            {{ dataAuthReadSeconds > 0 ? `请先阅读 ${dataAuthReadSeconds}s` : "同意并继续" }}
          </el-button>
        </div>
      </template>
    </el-dialog>
    <el-dialog
      v-model="strongNoticeOpen"
      title="站务强提醒"
      width="420"
      class="strong-notice-dialog"
      append-to-body
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="false"
    >
      <div v-if="currentStrongNotice" class="strong-notice">
        <div class="notice-head">
          <el-tag size="small" type="danger" effect="plain">强提醒</el-tag>
          <span class="notice-source">{{ currentStrongNotice.source || "站务组" }}</span>
        </div>
        <h3 class="notice-title">{{ currentStrongNotice.title }}</h3>
        <div class="notice-content">{{ currentStrongNotice.content }}</div>
        <div v-if="currentStrongNotice.link" class="notice-link">
          <span>相关链接：</span>
          <a :href="currentStrongNotice.link" target="_blank" rel="noopener noreferrer">{{ currentStrongNotice.link }}</a>
        </div>
      </div>
      <template #footer>
        <div class="strong-notice-footer">
          <el-button
            v-if="currentStrongNotice?.link"
            plain
            type="primary"
            :disabled="strongNoticeReadSeconds > 0"
            @click="openStrongNoticeLink"
          >
            查看详情
          </el-button>
          <el-button type="primary" :disabled="strongNoticeReadSeconds > 0" @click="ackStrongNotice">
            {{ strongNoticeReadSeconds > 0 ? `请先阅读 ${strongNoticeReadSeconds}s` : "我知道了" }}
          </el-button>
        </div>
      </template>
    </el-dialog>
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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import { ElMessage } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import { useMessageStore } from "@/stores/message";
import { router } from "@/router";
import { messageApi } from "@/api/message";
import { detectInAppBrowser } from "@/utils/inAppBrowser";

const auth = useAuthStore();
const msg = useMessageStore();
const dataAuthOpen = ref(false);
const dataAuthReadSeconds = ref(0);
const inAppTipOpen = ref(false);
const inAppBrowserLabel = ref("微信 / QQ");
const inAppReadSeconds = ref(0);
let inAppReadTimer: number | null = null;
let dataAuthTimer: number | null = null;

type NoticeRow = {
  id: number;
  title: string;
  content: string;
  link?: string | null;
  source?: string | null;
  level?: string;
  readAt?: string | null;
  createdAt?: string;
};

const strongNoticeQueue = ref<NoticeRow[]>([]);
const strongNoticeOpen = ref(false);
const strongNoticeReadSeconds = ref(0);
let strongNoticeTimer: number | null = null;
let strongNoticePoller: number | null = null;
let strongNoticeLoading = false;
let pendingStrongNoticeOpen = false;

const currentStrongNotice = computed(() => strongNoticeQueue.value[0] ?? null);

onMounted(() => {
  if (isSchedulePage()) return;
  const info = detectInAppBrowser();
  if (!info.isInApp) return;
  inAppBrowserLabel.value = info.label;
  inAppTipOpen.value = true;
});

watch(inAppTipOpen, (open) => {
  if (open) startInAppReadTimer();
  else {
    clearInAppReadTimer();
    if (auth.needDataAuthAgreement && !dataAuthOpen.value) {
      openDataAuth();
    }
    if (strongNoticeQueue.value.length && !strongNoticeOpen.value) {
      requestStrongNoticeOpen();
    }
  }
});

onBeforeUnmount(() => {
  clearInAppReadTimer();
  clearDataAuthTimer();
  clearStrongNoticeTimer();
  clearStrongNoticePoller();
});

function dismissInAppTip() {
  if (inAppReadSeconds.value > 0) return;
  inAppTipOpen.value = false;
}

function isSchedulePage() {
  return window.location.pathname.replace(/\/+$/, "") === "/schedule";
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

watch(
  () => [auth.token, auth.user?.id, auth.needDataAuthAgreement],
  () => {
    if (auth.isLoggedIn) {
      if (auth.needDataAuthAgreement) {
        suspendStrongNotice();
        if (!inAppTipOpen.value) {
          openDataAuth();
        } else {
          dataAuthOpen.value = false;
          clearDataAuthTimer();
        }
        clearStrongNoticeTimer();
        clearStrongNoticePoller();
      } else {
        void loadStrongNotices();
        startStrongNoticePoller();
      }
    } else {
      dataAuthOpen.value = false;
      clearDataAuthTimer();
      strongNoticeQueue.value = [];
      strongNoticeOpen.value = false;
      pendingStrongNoticeOpen = false;
      clearStrongNoticeTimer();
      clearStrongNoticePoller();
    }
  },
  { immediate: true }
);

watch(dataAuthOpen, async (open) => {
  if (open) {
    suspendStrongNotice();
    return;
  }
  await nextTick();
  requestStrongNoticeOpen();
});

function openDataAuth() {
  if (inAppTipOpen.value) return;
  if (!auth.needDataAuthAgreement) return;
  dataAuthOpen.value = true;
  startDataAuthTimer();
}

function startDataAuthTimer() {
  clearDataAuthTimer();
  dataAuthReadSeconds.value = 6;
  dataAuthTimer = window.setInterval(() => {
    dataAuthReadSeconds.value -= 1;
    if (dataAuthReadSeconds.value <= 0) {
      clearDataAuthTimer();
    }
  }, 1000);
}

function clearDataAuthTimer() {
  if (dataAuthTimer) {
    window.clearInterval(dataAuthTimer);
    dataAuthTimer = null;
  }
  if (!dataAuthOpen.value) dataAuthReadSeconds.value = 0;
}

async function acceptDataAuth() {
  if (dataAuthReadSeconds.value > 0) return;
  auth.acceptDataAuthAgreement();
  dataAuthOpen.value = false;
  clearDataAuthTimer();
  await nextTick();
  requestStrongNoticeOpen();
}

async function loadStrongNotices() {
  if (!auth.isLoggedIn || auth.needDataAuthAgreement || strongNoticeLoading) return;
  strongNoticeLoading = true;
  try {
    const [list, settings] = await Promise.all([
      messageApi.list("system").catch(() => []),
      messageApi.settings().catch(() => null),
    ]);
    if (settings && settings.subscribeSystem === false) {
      strongNoticeQueue.value = [];
      strongNoticeOpen.value = false;
      pendingStrongNoticeOpen = false;
      clearStrongNoticeTimer();
      return;
    }
    strongNoticeQueue.value = (list as NoticeRow[])
      .filter((n) => n.level === "strong" && !n.readAt)
      .sort((a, b) => (new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()));
    requestStrongNoticeOpen();
  } finally {
    strongNoticeLoading = false;
  }
}

function openStrongNotice() {
  if (auth.needDataAuthAgreement) return;
  if (inAppTipOpen.value) return;
  if (!currentStrongNotice.value) return;
  strongNoticeOpen.value = true;
  startStrongNoticeTimer();
}

function requestStrongNoticeOpen() {
  if (!currentStrongNotice.value) {
    pendingStrongNoticeOpen = false;
    return;
  }
  if (auth.needDataAuthAgreement || inAppTipOpen.value || dataAuthOpen.value) {
    pendingStrongNoticeOpen = true;
    return;
  }
  if (strongNoticeOpen.value) {
    pendingStrongNoticeOpen = false;
    return;
  }
  pendingStrongNoticeOpen = false;
  openStrongNotice();
}

function suspendStrongNotice() {
  if (currentStrongNotice.value) {
    pendingStrongNoticeOpen = true;
  }
  if (strongNoticeOpen.value) {
    strongNoticeOpen.value = false;
    clearStrongNoticeTimer();
  }
}

function startStrongNoticeTimer() {
  clearStrongNoticeTimer();
  strongNoticeReadSeconds.value = 3;
  strongNoticeTimer = window.setInterval(() => {
    strongNoticeReadSeconds.value -= 1;
    if (strongNoticeReadSeconds.value <= 0) {
      clearStrongNoticeTimer();
    }
  }, 1000);
}

function clearStrongNoticeTimer() {
  if (strongNoticeTimer) {
    window.clearInterval(strongNoticeTimer);
    strongNoticeTimer = null;
  }
  if (!strongNoticeOpen.value) strongNoticeReadSeconds.value = 0;
}

function startStrongNoticePoller() {
  if (strongNoticePoller || !auth.isLoggedIn) return;
  strongNoticePoller = window.setInterval(() => {
    void loadStrongNotices();
  }, 60_000);
}

function clearStrongNoticePoller() {
  if (strongNoticePoller) {
    window.clearInterval(strongNoticePoller);
    strongNoticePoller = null;
  }
}

async function ackStrongNotice() {
  if (strongNoticeReadSeconds.value > 0) return;
  const current = currentStrongNotice.value;
  if (!current) return;
  try {
    await messageApi.read(current.id);
    msg.refresh();
    strongNoticeQueue.value.shift();
    if (strongNoticeQueue.value.length) {
      strongNoticeOpen.value = false;
      await nextTick();
      requestStrongNoticeOpen();
    } else {
      strongNoticeOpen.value = false;
      pendingStrongNoticeOpen = false;
      clearStrongNoticeTimer();
    }
  } catch {
    ElMessage.error("已读标记失败，请稍后重试");
  }
}

function openStrongNoticeLink() {
  const current = currentStrongNotice.value;
  if (!current?.link) return;
  if (current.link.startsWith("/")) {
    router.push(current.link);
  } else {
    window.open(current.link, "_blank", "noopener");
  }
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

.data-auth {
  color: #374151;
  font-size: 14px;
  line-height: 1.8;
}

.auth-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.auth-sub {
  font-size: 12px;
  color: #9ca3af;
}

.data-auth p {
  margin: 0 0 10px;
}

.data-auth-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.read-hint {
  font-size: 12px;
  color: #9ca3af;
}

.strong-notice {
  color: #1f2937;
  font-size: 14px;
  line-height: 1.7;
}

.notice-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.notice-source {
  font-size: 12px;
  color: #9ca3af;
}

.notice-title {
  margin: 0 0 10px;
  font-size: 18px;
  line-height: 1.45;
  color: #111827;
}

.notice-content {
  white-space: pre-wrap;
  color: #374151;
  font-size: 14px;
}

.notice-link {
  margin-top: 12px;
  font-size: 12px;
  color: #6b7280;
  word-break: break-all;
}

.notice-link a {
  color: var(--cpu-primary);
}

.strong-notice-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
