<template>
  <div class="msg-page" v-loading="loading">
    <div class="page-head">
      <div class="page-head-main">
        <h2 class="page-title">消息中心</h2>
        <span v-if="tab !== 'settings'" class="page-sub">{{ unreadCount ? `${unreadCount} 条未读` : "当前全部已读" }}</span>
      </div>
      <div v-if="tab !== 'settings'" class="page-head-actions">
        <el-button text :loading="markingAll" :disabled="!unreadCount || markingAll" @click="readAll">全部标为已读</el-button>
      </div>
    </div>
    <div v-if="pageError" class="cpu-card page-error">
      <el-empty :description="pageError">
        <el-button type="primary" @click="loadPage">重试</el-button>
      </el-empty>
    </div>
    <el-tabs v-else v-model="tab" class="cpu-card messages-tabs">
      <el-tab-pane label="全部" name="all">
        <MessageList :list="filteredMessages('')" @read="onRead" @open="openNotification" />
      </el-tab-pane>
      <el-tab-pane label="回复 / 提及" name="reply">
        <MessageList :list="filteredMessages('reply')" @read="onRead" @open="openNotification" />
      </el-tab-pane>
      <el-tab-pane label="点赞" name="like">
        <MessageList :list="filteredMessages('like')" @read="onRead" @open="openNotification" />
      </el-tab-pane>
      <el-tab-pane label="系统 / 站务" name="system">
        <MessageList :list="filteredMessages('system')" @read="onRead" @open="openNotification" />
      </el-tab-pane>
      <el-tab-pane label="小工具" name="service-tool">
        <MessageList :list="filteredMessages('service-tool')" @read="onRead" @open="openNotification" />
      </el-tab-pane>
      <el-tab-pane label="设置" name="settings">
        <div v-if="settings" class="settings">
          <h4>通知渠道</h4>
          <div class="qq-channel-card" v-loading="qqBotLoading">
            <div class="qq-channel-head">
              <div>
                <b>QQ 私聊</b>
                <span>绑定后，开启的通知可通过 QQ 私聊送达。</span>
              </div>
              <el-tag :type="qqChannelTagType" effect="plain">{{ qqChannelStateText }}</el-tag>
            </div>
            <el-alert
              v-if="qqBotProfileError"
              type="warning"
              :closable="false"
              show-icon
              class="qq-channel-alert"
              :title="qqBotProfileError"
            >
              <template #default>
                <el-button size="small" :loading="qqBotLoading" @click="refreshQqBotProfile">重试</el-button>
              </template>
            </el-alert>
            <template v-else>
              <div class="qq-channel-grid">
                <div>
                  <span>机器人账号</span>
                  <b>{{ qqBotProfile?.botQqId || "未配置" }}</b>
                </div>
                <div>
                  <span>绑定 QQ</span>
                  <b>{{ qqBotProfile?.binding?.qqId || "未绑定" }}</b>
                </div>
                <div>
                  <span>QQ 投稿</span>
                  <b>{{ qqPostingText }}</b>
                </div>
              </div>
              <div v-if="qqBotProfile?.activeBindToken" class="qq-token-box">
                <strong>{{ qqBotProfile.activeBindToken.token }}</strong>
                <span>请在 QQ 私聊机器人发送：{{ qqBotBindCommandText }}</span>
                <span>有效期至 {{ formatNoticeTime(qqBotProfile.activeBindToken.expiresAt) }}</span>
              </div>
              <p v-else class="qq-channel-hint">
                {{ qqBotProfile?.binding ? "当前账号已绑定 QQ，如需更换请先解绑。" : "生成绑定码后，在 QQ 私聊机器人发送绑定命令即可完成绑定。" }}
              </p>
              <label class="qq-channel-toggle">
                <span>
                  <b>QQ 私聊提醒</b>
                  <small>开启后，已订阅的通知会通过 QQ 私聊发送；关闭后仅保留站内消息。</small>
                </span>
                <el-switch v-model="settings.qqBotNotifyEnabled" />
              </label>
              <div class="qq-channel-actions">
                <el-button
                  v-if="!qqBotProfile?.binding"
                  type="primary"
                  plain
                  :loading="qqBotLoading"
                  :disabled="qqBotLoading || !qqBotProfile?.enabled"
                  @click="refreshQqBotToken"
                >
                  {{ qqBotProfile?.activeBindToken ? "重新生成绑定码" : "生成绑定码" }}
                </el-button>
                <el-button
                  v-if="qqBotProfile?.activeBindToken"
                  plain
                  :loading="qqBotLoading"
                  :disabled="qqBotLoading"
                  @click="copyQqBotCommand"
                >
                  复制绑定指令
                </el-button>
                <el-button
                  v-if="qqBotProfile?.binding"
                  type="danger"
                  plain
                  :loading="qqBotLoading"
                  :disabled="qqBotLoading"
                  @click="unbindQqBot"
                >
                  解绑 QQ
                </el-button>
                <el-button plain :loading="qqBotLoading" :disabled="qqBotLoading" @click="refreshQqBotProfile">刷新状态</el-button>
              </div>
            </template>
          </div>
          <el-divider />
          <h4>订阅偏好</h4>
          <div class="switches">
            <label class="switch-item">
              <span>收到回复时</span>
              <el-switch v-model="settings.subscribeReply" />
            </label>
            <label class="switch-item">
              <span>收到点赞时</span>
              <el-switch v-model="settings.subscribeLike" />
            </label>
            <label class="switch-item">
              <span>校园公告更新</span>
              <el-switch v-model="settings.subscribeSchool" />
            </label>
            <label class="switch-item">
              <span>系统 / 站务通知</span>
              <el-switch v-model="settings.subscribeSystem" />
            </label>
          </div>
          <el-divider />
          <h4>小工具提醒</h4>
          <button type="button" class="settings-action-row" @click="openQqBotReminderSettings">
            <span class="settings-action-icon">
              <el-icon><Bell /></el-icon>
            </span>
            <span class="settings-action-copy">
              <b>小工具提醒规则</b>
              <span>选择哪些问卷、文件收集和成绩表通过 QQ 私聊提醒。</span>
            </span>
            <el-icon class="settings-action-arrow"><ArrowRight /></el-icon>
          </button>
          <el-button type="primary" :loading="saving" :disabled="saving" class="save-btn" @click="saveSettings">保存设置</el-button>
        </div>
        <el-empty v-else description="设置暂不可用" />
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="detailOpen" title="通知详情" width="620px" append-to-body class="notice-dialog">
      <div v-if="activeNotice" class="notice-detail">
        <div class="notice-head">
          <h3 class="notice-title">{{ activeNotice.title }}</h3>
          <div class="notice-meta">{{ activeNotice.source || "校内" }} · {{ formatNoticeTime(activeNotice.createdAt) }}</div>
        </div>
        <p class="notice-content">{{ activeNotice.content }}</p>
        <div v-if="reviewStateText" class="review-state" :class="{ done: !canReviewActiveNotice }">
          {{ reviewStateText }}
        </div>

        <div v-if="activeNotice.payload?.riskScore !== undefined || activeNotice.payload?.reason" class="notice-risk">
          <span v-if="activeNotice.payload?.reason">审核说明：{{ activeNotice.payload.reason }}</span>
          <span v-else>系统判定这条内容需要进一步确认。</span>
        </div>

        <div v-if="activeNotice.payload?.title" class="notice-draft">
          <div class="draft-title">{{ activeNotice.payload.title }}</div>
          <div v-if="activeNotice.payload?.note" class="draft-note">{{ activeNotice.payload.note }}</div>
        </div>
      </div>
      <template #footer>
        <div class="notice-actions">
          <el-button v-if="canOpenActiveNoticeTarget" @click="goNoticeLink">前往查看</el-button>
          <el-button
            v-if="canRequestManualReviewFromNotice"
            type="warning"
            :loading="requestingManualReview"
            :disabled="requestingManualReview"
            @click="requestManualReviewFromNotice"
          >
            申请人工复核
          </el-button>
          <el-button
            v-if="canReviewActiveNotice"
            type="success"
            :loading="reviewing"
            :disabled="reviewing"
            @click="approveFromNotice"
          >
            {{ reviewActionLabel }}通过
          </el-button>
          <el-button
            v-if="canReviewActiveNotice"
            type="warning"
            :loading="reviewing"
            :disabled="reviewing"
            @click="rejectFromNotice"
          >
            {{ reviewActionLabel }}驳回
          </el-button>
          <el-button @click="detailOpen = false">关闭</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { ArrowRight, Bell } from "@element-plus/icons-vue";
import MessageList from "@/components/messages/MessageList.vue";
import { messageApi } from "@/api/message";
import { topicApi } from "@/api/topic";
import { authApi, type QqBotProfile } from "@/api/auth";
import { useMessageStore } from "@/stores/message";
import { useAuthStore } from "@/stores/auth";
import { adminApi } from "@/api/admin";
import { fmtDate } from "@/utils/format";
import { copyText } from "@/utils/userGroup";

const route = useRoute();
const router = useRouter();
const msg = useMessageStore();
const auth = useAuthStore();

const messageTabs = new Set(["all", "reply", "like", "system", "service-tool", "settings"]);
const tab = ref(normalizeMessageTab(route.query.tab));
const list = ref<any[]>([]);
const settings = ref<any>(null);
const qqBotProfile = ref<QqBotProfile | null>(null);
const qqBotLoading = ref(false);
const qqBotProfileError = ref("");
const loading = ref(false);
const pageError = ref("");
const saving = ref(false);
const markingAll = ref(false);
const detailOpen = ref(false);
const activeNotice = ref<any | null>(null);
const reviewing = ref(false);
const requestingManualReview = ref(false);
const reviewTarget = ref<{ kind: "topic" | "reply"; id: number; title: string; aiReviewStatus: string; hidden: boolean; topicId?: number; reviewable: boolean } | null>(null);
const reviewTargetLoading = ref(false);
let loadSeq = 0;
let qqBotProfileSeq = 0;
let reviewTargetSeq = 0;
let disposed = false;

const unreadCount = computed(() => list.value.filter((item) => !item.readAt).length);
const qqChannelStateText = computed(() => {
  if (qqBotProfileError.value) return "状态未知";
  if (!qqBotProfile.value?.enabled) return "未启用";
  if (!qqBotProfile.value.binding) return "未绑定";
  return qqBotProfile.value.binding.enabled ? "已绑定" : "已停用";
});
const qqChannelTagType = computed(() => {
  if (qqBotProfileError.value) return "warning";
  if (!qqBotProfile.value?.enabled || !qqBotProfile.value.binding) return "info";
  return qqBotProfile.value.binding.enabled ? "success" : "warning";
});
const qqPostingText = computed(() => {
  if (!qqBotProfile.value) return "—";
  if (qqBotProfile.value.allowPrivatePost && qqBotProfile.value.allowGroupPost) return "私聊 / 群聊";
  if (qqBotProfile.value.allowPrivatePost) return "仅私聊";
  if (qqBotProfile.value.allowGroupPost) return "仅群聊";
  return "未开启";
});
const qqBotBindCommandText = computed(() => {
  if (qqBotProfile.value?.activeBindToken) return `绑定 ${qqBotProfile.value.activeBindToken.token}`;
  return "绑定 绑定码";
});

onMounted(() => {
  disposed = false;
  void loadPage();
  void loadQqBotProfile({ silent: true });
});

onBeforeUnmount(() => {
  disposed = true;
  loadSeq += 1;
  qqBotProfileSeq += 1;
  reviewTargetSeq += 1;
  loading.value = false;
  qqBotLoading.value = false;
  saving.value = false;
  markingAll.value = false;
  reviewing.value = false;
  requestingManualReview.value = false;
  reviewTargetLoading.value = false;
});

watch(() => route.query.tab, (value) => {
  const next = normalizeMessageTab(value);
  if (tab.value !== next) tab.value = next;
  const raw = typeof value === "string" ? value : "";
  if (raw && (raw === "all" || !messageTabs.has(raw))) {
    router.replace({ query: { ...route.query, tab: undefined } }).catch(() => null);
  }
}, { immediate: true });

watch(tab, (value) => {
  const nextQuery = { ...route.query, tab: value === "all" ? undefined : value };
  if ((route.query.tab || "all") === (nextQuery.tab || "all")) return;
  router.replace({ query: nextQuery }).catch(() => null);
});

async function reloadNoticeState() {
  if (disposed) return;
  const seq = ++loadSeq;
  const [nextList, nextSettings] = await Promise.all([
    messageApi.list(undefined, { suppressErrorMessage: true }),
    messageApi.settings({ suppressErrorMessage: true }),
  ]);
  if (disposed || seq !== loadSeq) return;
  list.value = nextList;
  settings.value = normalizeMessageSettings(nextSettings);
  pageError.value = "";
  void msg.refresh();
}

async function refreshNoticeStateAfterAction() {
  try {
    await reloadNoticeState();
  } catch (error) {
    if (disposed) return;
    ElMessage.warning(normalizeMessageActionError(error, "操作已完成，但消息列表刷新失败"));
  }
}

function filteredMessages(cat: string) {
  if (!cat) return list.value;
  return list.value.filter((n) => n.category === cat);
}

async function onRead(id: number) {
  if (disposed) return;
  try {
    await messageApi.read(id, { suppressErrorMessage: true });
    if (disposed) return;
    const n = list.value.find((x) => x.id === id);
    if (n) n.readAt = new Date().toISOString();
    void msg.refresh();
  } catch (error) {
    if (disposed) return;
    ElMessage.error(normalizeMessageActionError(error, "消息标记已读失败"));
  }
}

async function readAll() {
  if (disposed || !unreadCount.value || markingAll.value) return;
  markingAll.value = true;
  try {
    await messageApi.readAll({ suppressErrorMessage: true });
    if (disposed) return;
    list.value.forEach((n) => (n.readAt = new Date().toISOString()));
    ElMessage.success("已全部已读");
    void msg.refresh();
  } catch (error) {
    if (disposed) return;
    ElMessage.error(normalizeMessageActionError(error, "全部已读失败"));
  } finally {
    if (!disposed) markingAll.value = false;
  }
}

async function saveSettings() {
  if (disposed || !settings.value || saving.value) return;
  saving.value = true;
  try {
    const { id, userId, ...payload } = settings.value;
    const nextSettings = await messageApi.updateSettings(payload, { suppressErrorMessage: true });
    if (disposed) return;
    settings.value = normalizeMessageSettings(nextSettings);
    ElMessage.success("已保存");
  } catch (error) {
    if (disposed) return;
    ElMessage.error(normalizeMessageActionError(error, "设置保存失败"));
  } finally {
    if (!disposed) saving.value = false;
  }
}

function openQqBotReminderSettings() {
  router.push("/messages/qqbot-reminders");
}

async function loadQqBotProfile(opts?: { silent?: boolean }) {
  if (disposed) return;
  const seq = ++qqBotProfileSeq;
  qqBotLoading.value = true;
  qqBotProfileError.value = "";
  try {
    const profile = await authApi.qqBotProfile({ suppressErrorMessage: true });
    if (disposed || seq !== qqBotProfileSeq) return;
    qqBotProfile.value = profile;
  } catch (error) {
    if (disposed || seq !== qqBotProfileSeq) return;
    qqBotProfile.value = null;
    qqBotProfileError.value = normalizeMessageActionError(error, "QQ 私聊状态加载失败");
    if (!opts?.silent) ElMessage.error(qqBotProfileError.value);
  } finally {
    if (!disposed && seq === qqBotProfileSeq) qqBotLoading.value = false;
  }
}

function refreshQqBotProfile() {
  return loadQqBotProfile();
}

async function refreshQqBotToken() {
  if (disposed || qqBotLoading.value) return;
  qqBotLoading.value = true;
  try {
    await authApi.createQqBotBindToken({ suppressErrorMessage: true });
    await loadQqBotProfile({ silent: true });
    if (disposed) return;
    ElMessage.success("绑定码已生成");
  } catch (error) {
    if (!disposed) ElMessage.error(normalizeMessageActionError(error, "绑定码生成失败"));
  } finally {
    if (!disposed) qqBotLoading.value = false;
  }
}

async function copyQqBotCommand() {
  if (disposed || qqBotLoading.value) return;
  if (!qqBotProfile.value?.activeBindToken) {
    ElMessage.warning("请先生成绑定码");
    return;
  }
  await copyText(`绑定 ${qqBotProfile.value.activeBindToken.token}`);
  ElMessage.success("已复制绑定指令");
}

async function unbindQqBot() {
  if (disposed || qqBotLoading.value) return;
  const confirmed = await ElMessageBox.confirm("确认解绑当前 QQ 私聊绑定？解绑后将不能通过 QQ 私聊接收提醒或投稿。", "解绑 QQ", { type: "warning" })
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return;
  qqBotLoading.value = true;
  try {
    await authApi.deleteQqBotBinding({ suppressErrorMessage: true });
    await loadQqBotProfile({ silent: true });
    if (disposed) return;
    ElMessage.success("QQ 私聊绑定已解绑");
  } catch (error) {
    if (!disposed) ElMessage.error(normalizeMessageActionError(error, "解绑失败"));
  } finally {
    if (!disposed) qqBotLoading.value = false;
  }
}

async function loadPage() {
  if (disposed) return;
  const seq = ++loadSeq;
  loading.value = true;
  pageError.value = "";
  try {
    const [nextList, nextSettings] = await Promise.all([
      messageApi.list(undefined, { suppressErrorMessage: true }),
      messageApi.settings({ suppressErrorMessage: true }),
    ]);
    if (disposed || seq !== loadSeq) return;
    list.value = nextList;
    settings.value = normalizeMessageSettings(nextSettings);
    void msg.refresh();
  } catch (error) {
    if (disposed || seq !== loadSeq) return;
    list.value = [];
    settings.value = null;
    pageError.value = normalizeMessageLoadError(error);
  } finally {
    if (!disposed && seq === loadSeq) loading.value = false;
  }
}

async function openNotification(item: any) {
  if (disposed) return;
  activeNotice.value = item;
  reviewTarget.value = null;
  detailOpen.value = true;
  const seq = ++reviewTargetSeq;
  const target = getReviewTargetFromNotice(item);
  if (!target || !auth.isMod) {
    reviewTargetLoading.value = false;
    return;
  }
  reviewTargetLoading.value = true;
  try {
    const nextTarget = await adminApi.reviewTarget(target.kind, target.id);
    if (disposed || seq !== reviewTargetSeq || activeNotice.value?.id !== item.id) return;
    reviewTarget.value = nextTarget;
  } catch {
    if (disposed || seq !== reviewTargetSeq || activeNotice.value?.id !== item.id) return;
    reviewTarget.value = null;
  } finally {
    if (!disposed && seq === reviewTargetSeq) reviewTargetLoading.value = false;
  }
}

const activeNoticeTargetLink = computed(() => resolveNoticeLink(activeNotice.value));
const canOpenActiveNoticeTarget = computed(() => Boolean(activeNoticeTargetLink.value));
const canRequestManualReviewFromNotice = computed(() => Boolean(
  auth.isLoggedIn &&
  !auth.user?.topicSubmissionLocked &&
  activeNotice.value?.payload?.type === "topic-ai-blocked" &&
  Number(activeNotice.value?.payload?.topicId) > 0
));

const canReviewActiveNotice = computed(() => {
  return Boolean(auth.isMod && reviewTarget.value?.reviewable);
});
const reviewActionLabel = computed(() => reviewTarget.value?.kind === "reply" ? "回复" : "帖子");
const reviewStateText = computed(() => {
  if (reviewTargetLoading.value) return "正在检查当前审核状态...";
  if (!reviewTarget.value) return "";
  return reviewTarget.value.reviewable
    ? `${reviewActionLabel.value}当前仍在待人工审核状态，可直接处理。`
    : `${reviewActionLabel.value}当前状态为「${reviewLabel(reviewTarget.value.aiReviewStatus)}」，不需要再次审核。`;
});

function goNoticeLink() {
  if (!activeNoticeTargetLink.value) return;
  detailOpen.value = false;
  router.push(activeNoticeTargetLink.value);
}

async function requestManualReviewFromNotice() {
  if (disposed) return;
  const topicId = Number(activeNotice.value?.payload?.topicId || 0);
  if (!topicId) return;
  requestingManualReview.value = true;
  try {
    await topicApi.requestManualReview(topicId);
    if (disposed) return;
    await auth.fetchMe();
    if (disposed) return;
    await refreshNoticeStateAfterAction();
    if (disposed) return;
    detailOpen.value = false;
    ElMessage.success("已提交人工复核申请");
  } finally {
    if (!disposed) requestingManualReview.value = false;
  }
}

async function approveFromNotice() {
  const target = reviewTarget.value;
  if (disposed || !target?.reviewable) return;
  reviewing.value = true;
  try {
    if (target.kind === "reply") {
      await adminApi.updateReply(target.id, {
        aiReviewStatus: "approved_manual",
        manualReviewNote: "管理员通过消息中心审核通过",
      });
    } else {
      await adminApi.updateTopic(target.id, {
        aiReviewStatus: "approved_manual",
        manualReviewNote: "管理员通过消息中心审核通过",
      });
    }
    if (disposed) return;
    ElMessage.success("已审核通过");
    detailOpen.value = false;
    await refreshNoticeStateAfterAction();
  } finally {
    if (!disposed) reviewing.value = false;
  }
}

async function rejectFromNotice() {
  const target = reviewTarget.value;
  if (disposed || !target?.reviewable || reviewing.value) return;
  reviewing.value = true;
  try {
    let value = "";
    try {
      ({ value } = await ElMessageBox.prompt("填写驳回说明（选填）", "人工驳回", {
        inputPlaceholder: "例如：存在明显人身攻击 / 泄露隐私信息",
      }));
    } catch {
      return;
    }
    if (disposed) return;
    if (target.kind === "reply") {
      await adminApi.updateReply(target.id, {
        aiReviewStatus: "rejected_manual",
        manualReviewNote: value || "管理员通过消息中心人工驳回",
      });
    } else {
      await adminApi.updateTopic(target.id, {
        aiReviewStatus: "rejected_manual",
        manualReviewNote: value || "管理员通过消息中心人工驳回",
      });
    }
    if (disposed) return;
    ElMessage.success("已驳回");
    detailOpen.value = false;
    await refreshNoticeStateAfterAction();
  } finally {
    if (!disposed) reviewing.value = false;
  }
}

function getReviewTargetFromNotice(item: any): { kind: "topic" | "reply"; id: number } | null {
  const type = item?.payload?.type;
  if (type === "topic-manual-review-admin" && item?.payload?.topicId) {
    return { kind: "topic", id: Number(item.payload.topicId) };
  }
  if (type === "reply-manual-review-admin" && item?.payload?.replyId) {
    return { kind: "reply", id: Number(item.payload.replyId) };
  }
  return null;
}

function reviewLabel(status?: string) {
  if (status === "manual_requested") return "申请人工审核";
  if (status === "manual_reviewing") return "人工审核中";
  if (status === "approved_manual") return "人工已通过";
  if (status === "rejected_manual") return "人工已驳回";
  if (status === "blocked_ai") return "AI 拦截";
  if (status === "auto_passed") return "自动通过";
  return "未审核";
}

function resolveNoticeLink(item: any) {
  if (item?.link) return String(item.link);
  const payload = item?.payload;
  const topicId = Number(payload?.topicId || 0);
  const replyId = Number(payload?.replyId || 0);
  if (topicId && replyId) return `/forum/topic/${topicId}#reply-${replyId}`;
  if (topicId) return `/forum/topic/${topicId}`;
  return "";
}

function formatNoticeTime(value?: string) {
  return fmtDate(value, "YYYY-MM-DD HH:mm");
}

function normalizeMessageTab(value: unknown) {
  const tabName = typeof value === "string" ? value : "all";
  return messageTabs.has(tabName) ? tabName : "all";
}

function normalizeMessageLoadError(error: unknown) {
  const status = (error as { response?: { status?: number; data?: { message?: string } } })?.response?.status;
  if (status === 401) return "登录已过期，请重新登录";
  if (status && status < 500) {
    return (error as { response?: { data?: { message?: string } } })?.response?.data?.message || "消息加载失败";
  }
  return "消息加载失败，请稍后再试";
}

function normalizeMessageActionError(error: unknown, fallback: string) {
  const message = (error as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
    || (error as { message?: string })?.message;
  return message || fallback;
}

function normalizeMessageSettings(value: any) {
  return {
    ...value,
    qqBotNotifyEnabled: value?.qqBotNotifyEnabled !== false,
  };
}
</script>

<style scoped>
.msg-page { display: flex; flex-direction: column; gap: 10px; }
.page-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.page-head-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.page-title { margin: 0; font-size: 22px; }
.page-sub {
  color: var(--cpu-text-secondary);
  font-size: 13px;
}
.page-head-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-shrink: 0;
}
.cpu-card {
  background: var(--cpu-card);
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  padding: 16px 20px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.04);
}
.page-error {
  padding: 24px 16px;
}
.notice-detail { display: flex; flex-direction: column; gap: 12px; }
.notice-head {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}
.notice-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}
.notice-title {
  margin: 0;
  font-size: 18px;
  line-height: 1.45;
  color: var(--cpu-text);
  overflow-wrap: anywhere;
}
.notice-meta {
  font-size: 12px;
  color: #94a3b8;
  line-height: 1.5;
  word-break: break-word;
}
.notice-content { margin: 0; color: var(--cpu-text-secondary); line-height: 1.75; white-space: pre-wrap; }
.review-state { font-size: 13px; color: #166534; background: #ecfdf5; border: 1px solid #bbf7d0; border-radius: 8px; padding: 10px 12px; }
.review-state.done { color: var(--cpu-text-secondary); background: var(--cpu-surface-subtle); border-color: var(--cpu-border-soft); }
.notice-risk { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: #92400e; background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.34); border-radius: 8px; padding: 10px 12px; }
.notice-draft { border: 1px solid var(--cpu-border); border-radius: 8px; background: var(--cpu-surface-subtle); padding: 12px; }
.draft-title { font-size: 14px; font-weight: 600; color: var(--cpu-text); }
.draft-note { margin-top: 8px; font-size: 13px; color: var(--cpu-text-secondary); }

.settings h4 { margin: 8px 0 6px; color: var(--cpu-text); }
.hint { font-size: 12px; color: var(--cpu-text-secondary); margin: 0 0 10px; }
.qq-channel-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  background: var(--cpu-card);
}
.qq-channel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.qq-channel-head > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}
.qq-channel-head b {
  color: var(--cpu-text);
  font-size: 14px;
  line-height: 1.35;
}
.qq-channel-head span,
.qq-channel-hint {
  color: var(--cpu-text-secondary);
  font-size: 12px;
  line-height: 1.55;
}
.qq-channel-hint {
  margin: 0;
}
.qq-channel-alert {
  margin-top: 2px;
}
.qq-channel-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.qq-channel-grid > div {
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  background: var(--cpu-surface-soft);
}
.qq-channel-grid span {
  display: block;
  margin-bottom: 5px;
  color: var(--cpu-text-secondary);
  font-size: 12px;
}
.qq-channel-grid b {
  display: block;
  color: var(--cpu-text);
  font-size: 14px;
  line-height: 1.35;
  overflow-wrap: anywhere;
}
.qq-token-box {
  display: grid;
  gap: 5px;
  padding: 12px;
  border: 1px dashed rgba(20, 143, 123, 0.35);
  border-radius: 8px;
  background: rgba(20, 143, 123, 0.08);
}
.qq-token-box strong {
  color: var(--cpu-primary);
  font-size: 22px;
  line-height: 1.2;
  letter-spacing: 1px;
}
.qq-token-box span {
  color: var(--cpu-text-secondary);
  font-size: 12px;
  line-height: 1.5;
}
.qq-channel-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.qq-channel-actions .el-button {
  margin-left: 0 !important;
}
.qq-channel-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  background: var(--cpu-surface-soft);
}
.qq-channel-toggle > span {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}
.qq-channel-toggle b {
  color: var(--cpu-text);
  font-size: 14px;
  line-height: 1.35;
}
.qq-channel-toggle small {
  color: var(--cpu-text-secondary);
  font-size: 12px;
  line-height: 1.45;
}
.switches { display: flex; flex-direction: column; gap: 12px; }
.switch-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  background: var(--cpu-surface-soft);
  color: var(--cpu-text);
  font-size: 14px;
}
.settings-action-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 62px;
  padding: 12px 14px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  background: var(--cpu-card);
  color: inherit;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.18s ease, background-color 0.18s ease, box-shadow 0.18s ease;
}
.settings-action-row:hover {
  border-color: rgba(20, 143, 123, 0.35);
  background: rgba(20, 143, 123, 0.08);
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.05);
}
.settings-action-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 34px;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: rgba(20, 143, 123, 0.1);
  color: var(--cpu-primary);
}
.settings-action-copy {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}
.settings-action-copy b {
  color: var(--cpu-text);
  font-size: 14px;
  line-height: 1.35;
}
.settings-action-copy span {
  color: var(--cpu-text-secondary);
  font-size: 12px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}
.settings-action-arrow {
  flex: 0 0 auto;
  color: var(--cpu-text-muted);
}
.save-btn {
  margin-top: 14px;
}

@media (max-width: 640px) {
  .msg-page {
    gap: 12px;
  }

  .page-head {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }

  .page-title {
    font-size: 20px;
  }

  .page-head-main {
    width: 100%;
  }

  .page-head-actions {
    width: 100%;
  }

  .page-head-actions .el-button {
    width: 100%;
    margin-left: 0;
  }

  .cpu-card {
    border-radius: 10px;
    padding: 12px;
  }

  .messages-tabs {
    margin: 0 -4px;
    padding: 10px 8px 12px;
    min-width: 0;
    overflow: hidden;
  }

  .messages-tabs :deep(.el-tabs__header) {
    min-width: 0;
    margin-bottom: 12px;
    overflow: visible;
  }

  .messages-tabs :deep(.el-tabs__nav-wrap) {
    padding: 0 0 2px;
    overflow: hidden;
  }

  .messages-tabs :deep(.el-tabs__nav-scroll) {
    width: 100%;
    max-width: 100%;
    min-width: 0;
    padding: 0 4px 2px;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-x: contain;
    touch-action: pan-x;
  }

  .messages-tabs :deep(.el-tabs__nav-wrap::after),
  .messages-tabs :deep(.el-tabs__active-bar) {
    display: none;
  }

  .messages-tabs :deep(.el-tabs__nav-scroll::-webkit-scrollbar) {
    display: none;
  }

  .messages-tabs :deep(.el-tabs__nav) {
    display: flex;
    float: none;
    width: max-content;
    min-width: max-content;
    white-space: nowrap;
    gap: 8px;
    padding-inline: 4px;
    padding-right: max(16px, env(safe-area-inset-right));
  }

  .messages-tabs :deep(.el-tabs__item) {
    height: 34px;
    padding: 0 12px;
    font-size: 13px;
    border-radius: 999px;
    background: var(--cpu-surface-subtle);
    color: var(--cpu-text-secondary);
  }

  .messages-tabs :deep(.el-tabs__item.is-active) {
    background: linear-gradient(135deg, var(--cpu-primary), var(--cpu-primary-dark));
    color: #fff;
  }

  .messages-tabs :deep(.el-tabs__content) {
    overflow: visible;
  }

  .switch-item {
    padding: 12px;
  }

  .qq-channel-head {
    align-items: stretch;
    flex-direction: column;
  }

  .qq-channel-grid {
    grid-template-columns: 1fr;
  }

  .settings-action-row {
    align-items: flex-start;
    min-height: 0;
    padding: 12px;
  }

  .settings .el-button {
    width: 100%;
  }

  .notice-head {
    gap: 4px;
  }

  .notice-title {
    font-size: 17px;
  }

  :deep(.notice-dialog) {
    width: 100% !important;
    max-width: 100% !important;
    margin-top: 4dvh;
  }

  :deep(.notice-dialog .el-dialog) {
    border-radius: 16px;
    overflow: hidden;
  }

  :deep(.notice-dialog .el-dialog__header) {
    padding: 16px 16px 8px;
    margin-right: 0;
  }

  :deep(.notice-dialog .el-dialog__body) {
    padding: 10px 16px 12px;
  }

  :deep(.notice-dialog .el-dialog__footer) {
    padding: 0 16px 16px;
  }

  .notice-actions {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 118px), 1fr));
    gap: 8px;
    width: 100%;
  }

  .notice-actions :deep(.el-button) {
    width: 100%;
    min-width: 0;
    margin-left: 0;
    padding-inline: 10px;
  }

  .notice-actions :deep(.el-button > span) {
    white-space: nowrap;
  }
}

@media (max-width: 420px) {
  .qq-channel-toggle,
  .switch-item,
  .settings-action-row,
  .qq-channel-actions {
    align-items: flex-start;
    flex-direction: column;
  }

  .qq-channel-actions .el-button {
    width: 100%;
  }

  .settings-action-arrow {
    display: none;
  }
}
</style>
