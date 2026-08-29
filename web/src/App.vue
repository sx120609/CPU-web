<template>
  <el-config-provider :locale="zhCn" :z-index="5000">
    <router-view :key="routeViewKey" />
    <SmartPostTaskIndicator />
    <AndroidUpdateDialog />
    <LegacyDomainMigrationDialog />
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
          学校密码和验证码不会保存到本站或浏览器存储；登录完成后仅保留不可被页面脚本读取的安全会话 Cookie。请勿在公共设备上保持登录。
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
        <div class="strong-notice-head">
          <el-tag size="small" type="danger" effect="plain">强提醒</el-tag>
          <span class="strong-notice-source">{{ currentStrongNotice.source || "站务组" }}</span>
        </div>
        <h3 class="strong-notice-title">{{ currentStrongNotice.title }}</h3>
        <div class="strong-notice-content">{{ currentStrongNotice.content }}</div>
        <div v-if="currentStrongNotice.link" class="strong-notice-link">
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
      v-model="directNoticeOpen"
      title="收到新私信"
      width="420"
      class="direct-notice-dialog"
      append-to-body
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="false"
    >
      <div v-if="currentDirectNotice" class="direct-notice">
        <div class="direct-notice-icon" aria-hidden="true">
          <el-icon><ChatDotRound /></el-icon>
          <span>{{ Math.min(msg.directUnreadCount, 99) }}</span>
        </div>
        <div class="direct-notice-copy">
          <h3>你有 {{ msg.directUnreadCount }} 条未读私信</h3>
          <p>{{ currentDirectNotice.title || "有用户发来私聊" }}</p>
          <span>点击“立即查看”可直接进入对应会话。</span>
        </div>
      </div>
      <template #footer>
        <div class="direct-notice-footer">
          <el-button @click="deferDirectNotice">稍后查看</el-button>
          <el-button type="primary" @click="openDirectNotice">立即查看</el-button>
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
import { ChatDotRound } from "@element-plus/icons-vue";
import { useAuthStore } from "@/stores/auth";
import { useMessageStore } from "@/stores/message";
import { router } from "@/router";
import { messageApi } from "@/api/message";
import { AUTH_EXPIRED_EVENT } from "@/api/request";
import AndroidUpdateDialog from "@/components/install/AndroidUpdateDialog.vue";
import SmartPostTaskIndicator from "@/components/forum/SmartPostTaskIndicator.vue";
import LegacyDomainMigrationDialog from "@/components/common/LegacyDomainMigrationDialog.vue";
import { detectInAppBrowser } from "@/utils/inAppBrowser";

const auth = useAuthStore();
const msg = useMessageStore();
// 页面路径变化由嵌套路由负责切换；顶层布局只应在登录身份真正变化时重建。
// 把 fullPath 放进 key 会让每次站内导航都销毁导航栏、站点状态和页面热缓存。
const routeViewKey = computed(() => String(auth.sessionVersion));
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
let strongNoticeLoadSeq = 0;
let disposed = false;

const currentStrongNotice = computed(() => strongNoticeQueue.value[0] ?? null);
const directNoticeOpen = ref(false);
const currentDirectNotice = computed(() => msg.latestDirectNotice);

onMounted(() => {
  disposed = false;
  window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
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
    requestDirectNoticeOpen();
  }
});

onBeforeUnmount(() => {
  disposed = true;
  strongNoticeLoadSeq += 1;
  strongNoticeLoading = false;
  window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
  clearInAppReadTimer();
  clearDataAuthTimer();
  clearStrongNoticeTimer();
  clearStrongNoticePoller();
});

function handleAuthExpired() {
  auth.expireSession();
  strongNoticeLoadSeq += 1;
  strongNoticeLoading = false;
  dataAuthOpen.value = false;
  strongNoticeOpen.value = false;
  strongNoticeQueue.value = [];
  pendingStrongNoticeOpen = false;
  directNoticeOpen.value = false;
  clearDataAuthTimer();
  clearStrongNoticeTimer();
  clearStrongNoticePoller();
}

function dismissInAppTip() {
  if (inAppReadSeconds.value > 0) return;
  inAppTipOpen.value = false;
}

function isSchedulePage() {
  return window.location.pathname.replace(/\/+$/, "") === "/schedule";
}

function startInAppReadTimer() {
  clearInAppReadTimer();
  inAppReadSeconds.value = 1;
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
    strongNoticeLoadSeq += 1;
    strongNoticeLoading = false;
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
        void loadMessageAlerts();
        startStrongNoticePoller();
      }
    } else {
      dataAuthOpen.value = false;
      clearDataAuthTimer();
      strongNoticeQueue.value = [];
      strongNoticeOpen.value = false;
      pendingStrongNoticeOpen = false;
      directNoticeOpen.value = false;
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
  if (disposed) return;
  requestStrongNoticeOpen();
  requestDirectNoticeOpen();
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
  await auth.acceptDataAuthAgreement();
  if (disposed) return;
  dataAuthOpen.value = false;
  clearDataAuthTimer();
  await nextTick();
  if (disposed) return;
  requestStrongNoticeOpen();
}

async function loadStrongNotices() {
  if (disposed || !auth.isLoggedIn || auth.needDataAuthAgreement || strongNoticeLoading) return;
  const seq = ++strongNoticeLoadSeq;
  strongNoticeLoading = true;
  try {
    const [list, settings] = await Promise.all([
      messageApi.list("system").catch(() => []),
      messageApi.settings().catch(() => null),
    ]);
    if (disposed || seq !== strongNoticeLoadSeq || !auth.isLoggedIn || auth.needDataAuthAgreement) return;
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
    if (seq === strongNoticeLoadSeq) strongNoticeLoading = false;
  }
}

async function loadMessageAlerts() {
  await loadStrongNotices();
  if (disposed || !auth.isLoggedIn || auth.needDataAuthAgreement) return;
  await msg.refresh();
  if (disposed || !auth.isLoggedIn || auth.needDataAuthAgreement) return;
  if (!currentDirectNotice.value) {
    directNoticeOpen.value = false;
    return;
  }
  requestDirectNoticeOpen();
}

function directNoticeSeenKey() {
  return `cpu-direct-notice-seen:${auth.user?.id || "session"}`;
}

function readSeenDirectNoticeId() {
  try {
    return Number(window.sessionStorage.getItem(directNoticeSeenKey()) || 0);
  } catch {
    return 0;
  }
}

function rememberDirectNotice(id: number) {
  try {
    window.sessionStorage.setItem(directNoticeSeenKey(), String(id));
  } catch {
    // Storage may be disabled in hardened browsers. The prompt still works.
  }
}

function requestDirectNoticeOpen() {
  if (disposed || !auth.isLoggedIn || auth.needDataAuthAgreement) return;
  const current = currentDirectNotice.value;
  if (!current) {
    return;
  }
  const seenId = readSeenDirectNoticeId();
  if (seenId === current.id) {
    return;
  }
  if (inAppTipOpen.value || dataAuthOpen.value || strongNoticeOpen.value || currentStrongNotice.value) {
    return;
  }
  rememberDirectNotice(current.id);
  directNoticeOpen.value = true;
}

function deferDirectNotice() {
  directNoticeOpen.value = false;
}

function openDirectNotice() {
  const link = currentDirectNotice.value?.link || "/messages?tab=private";
  directNoticeOpen.value = false;
  if (link.startsWith("/")) {
    void router.push(link);
  } else {
    window.open(link, "_blank", "noopener,noreferrer");
  }
}

function openStrongNotice() {
  if (disposed) return;
  if (auth.needDataAuthAgreement) return;
  if (inAppTipOpen.value) return;
  if (!currentStrongNotice.value) return;
  strongNoticeOpen.value = true;
  startStrongNoticeTimer();
}

function requestStrongNoticeOpen() {
  if (disposed) return;
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
  if (disposed || strongNoticePoller || !auth.isLoggedIn) return;
  strongNoticePoller = window.setInterval(() => {
    if (document.hidden) return;
    void loadMessageAlerts();
  }, 30_000);
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
    if (disposed) return;
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
      requestDirectNoticeOpen();
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
    window.open(current.link, "_blank", "noopener,noreferrer");
  }
}
</script>

<style lang="scss">
html, body, #app {
  height: 100%;
  margin: 0;
}

/*
 * Element Plus locks page scrolling for dialogs, drawers, image previews and
 * message boxes by subtracting its measured scrollbar width from <body>.
 * Android WebView uses overlay scrollbars, so that desktop compensation makes
 * the page visibly narrower even though no layout space needs to be reserved.
 */
@media (max-width: 768px) {
  body.el-popup-parent--hidden,
  body.el-message-box-parent--hidden,
  body.el-image-viewer-parent--hidden,
  body.el-tour-parent--hidden {
    width: 100% !important;
  }
}

.in-app-tip {
  color: var(--cpu-text);
  font-size: 14px;
  line-height: 1.7;

  p {
    margin: 0 0 8px;
  }

  .muted {
    color: var(--cpu-text-secondary);
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

.direct-notice {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 6px 0;
  color: var(--cpu-text);
}

.direct-notice-icon {
  position: relative;
  width: 72px;
  height: 72px;
  flex: 0 0 72px;
  display: grid;
  place-items: center;
  border-radius: 22px;
  background: linear-gradient(145deg, color-mix(in srgb, var(--cpu-primary) 14%, var(--cpu-card)), color-mix(in srgb, var(--cpu-primary) 28%, var(--cpu-card)));
  color: var(--cpu-primary);
  box-shadow: 0 12px 30px color-mix(in srgb, var(--cpu-primary) 18%, transparent);
}

.direct-notice-icon .el-icon {
  font-size: 34px;
}

.direct-notice-icon span {
  position: absolute;
  top: -7px;
  right: -7px;
  min-width: 26px;
  height: 26px;
  padding: 0 6px;
  display: grid;
  place-items: center;
  border: 3px solid var(--cpu-card);
  border-radius: 999px;
  background: #ef4444;
  color: #fff;
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
  box-sizing: border-box;
}

.direct-notice-copy {
  min-width: 0;
}

.direct-notice-copy h3 {
  margin: 0 0 6px;
  color: var(--cpu-text);
  font-size: 19px;
  line-height: 1.4;
}

.direct-notice-copy p {
  margin: 0 0 4px;
  color: var(--cpu-text-secondary);
  font-size: 14px;
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.direct-notice-copy > span {
  color: var(--cpu-text-muted);
  font-size: 12px;
}

.direct-notice-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

@media (max-width: 520px) {
  .direct-notice {
    align-items: flex-start;
    gap: 13px;
  }

  .direct-notice-icon {
    width: 58px;
    height: 58px;
    flex-basis: 58px;
    border-radius: 18px;
  }

  .direct-notice-icon .el-icon { font-size: 28px; }
  .direct-notice-copy h3 { font-size: 17px; }

  .direct-notice-footer {
    display: grid;
    grid-template-columns: 1fr 1.25fr;
  }

  .direct-notice-footer .el-button {
    width: 100%;
    min-height: 42px;
    margin-left: 0;
  }
}

.strong-notice {
  color: #1f2937;
  font-size: 14px;
  line-height: 1.7;
}

.strong-notice-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.strong-notice-source {
  font-size: 12px;
  color: #9ca3af;
}

.strong-notice-title {
  margin: 0 0 10px;
  font-size: 18px;
  line-height: 1.45;
  color: #111827;
}

.strong-notice-content {
  white-space: pre-wrap;
  color: #374151;
  font-size: 14px;
}

.strong-notice-link {
  margin-top: 12px;
  font-size: 12px;
  color: #6b7280;
  word-break: break-all;
}

.strong-notice-link a {
  color: var(--cpu-primary);
}

.strong-notice-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
