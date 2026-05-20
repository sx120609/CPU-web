<template>
  <div class="msg-page">
    <div class="page-head">
      <h2 class="page-title">消息中心</h2>
      <span v-if="tab !== 'settings' && unreadCount" class="page-sub">{{ unreadCount }} 条未读</span>
    </div>
    <el-tabs v-model="tab" class="cpu-card messages-tabs">
      <el-tab-pane label="全部" name="all">
        <MessageList :list="filtered('')" @read="onRead" @open="openNotification" />
      </el-tab-pane>
      <el-tab-pane label="回复 / 提及" name="reply">
        <MessageList :list="filtered('reply')" @read="onRead" @open="openNotification" />
      </el-tab-pane>
      <el-tab-pane label="点赞" name="like">
        <MessageList :list="filtered('like')" @read="onRead" @open="openNotification" />
      </el-tab-pane>
      <el-tab-pane label="系统 / 站务" name="system">
        <MessageList :list="filtered('system')" @read="onRead" @open="openNotification" />
      </el-tab-pane>
      <el-tab-pane label="设置" name="settings">
        <div v-if="settings" class="settings">
          <h4>静默时段</h4>
          <p class="hint">在此时段内，平台仅向您推送强提醒消息。</p>
          <div class="setting-block time-row">
            <el-time-select v-model="settings.quietStart" start="00:00" step="00:30" end="23:30" />
            <span class="time-sep">至</span>
            <el-time-select v-model="settings.quietEnd" start="00:00" step="00:30" end="23:30" />
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
          <el-button type="primary" :loading="saving" class="save-btn" @click="saveSettings">保存设置</el-button>
        </div>
      </el-tab-pane>
    </el-tabs>

    <div class="bar" v-if="tab !== 'settings'">
      <span class="bar-meta">{{ unreadCount ? `${unreadCount} 条未读` : "当前全部已读" }}</span>
      <el-button text :disabled="!unreadCount" @click="readAll">全部标为已读</el-button>
    </div>

    <el-dialog v-model="detailOpen" title="通知详情" width="620px" append-to-body class="notice-dialog">
      <div v-if="activeNotice" class="notice-detail">
        <div class="notice-head">
          <h3>{{ activeNotice.title }}</h3>
          <span>{{ activeNotice.source || "校内" }} · {{ formatNoticeTime(activeNotice.createdAt) }}</span>
        </div>
        <p class="notice-content">{{ activeNotice.content }}</p>
        <div v-if="reviewStateText" class="review-state" :class="{ done: !canReviewActiveNotice }">
          {{ reviewStateText }}
        </div>

        <div v-if="activeNotice.payload?.riskScore !== undefined || activeNotice.payload?.reason" class="notice-risk">
          <span v-if="activeNotice.payload?.riskScore !== undefined">风险分：{{ activeNotice.payload.riskScore }}</span>
          <span v-if="activeNotice.payload?.reason">原因：{{ activeNotice.payload.reason }}</span>
        </div>

        <div v-if="activeNotice.payload?.title" class="notice-draft">
          <div class="draft-title">{{ activeNotice.payload.title }}</div>
          <div v-if="activeNotice.payload?.note" class="draft-note">{{ activeNotice.payload.note }}</div>
        </div>
      </div>
      <template #footer>
        <div class="notice-actions">
          <el-button v-if="activeNotice?.link" @click="goNoticeLink">前往查看</el-button>
          <el-button
            v-if="canReviewActiveNotice"
            type="success"
            :loading="reviewing"
            @click="approveFromNotice"
          >
            {{ reviewActionLabel }}通过
          </el-button>
          <el-button
            v-if="canReviewActiveNotice"
            type="warning"
            :loading="reviewing"
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
import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import MessageList from "@/components/messages/MessageList.vue";
import { messageApi } from "@/api/message";
import { useMessageStore } from "@/stores/message";
import { useAuthStore } from "@/stores/auth";
import { adminApi } from "@/api/admin";
import { fmtDate } from "@/utils/format";

const route = useRoute();
const router = useRouter();
const msg = useMessageStore();
const auth = useAuthStore();

const tab = ref(route.query.tab === "settings" ? "settings" : "all");
const list = ref<any[]>([]);
const settings = ref<any>(null);
const saving = ref(false);
const detailOpen = ref(false);
const activeNotice = ref<any | null>(null);
const reviewing = ref(false);
const reviewTarget = ref<{ kind: "topic" | "reply"; id: number; title: string; aiReviewStatus: string; hidden: boolean; topicId?: number; reviewable: boolean } | null>(null);
const reviewTargetLoading = ref(false);

const unreadCount = computed(() => list.value.filter((item) => !item.readAt).length);

onMounted(async () => {
  [list.value, settings.value] = await Promise.all([messageApi.list(), messageApi.settings()]);
  msg.refresh();
});

const filtered = (cat: string) => computed(() => {
  if (!cat) return list.value;
  return list.value.filter((n) => n.category === cat);
}).value;

async function onRead(id: number) {
  await messageApi.read(id);
  const n = list.value.find((x) => x.id === id);
  if (n) n.readAt = new Date().toISOString();
  msg.refresh();
}

async function readAll() {
  await messageApi.readAll();
  list.value.forEach((n) => (n.readAt = new Date().toISOString()));
  ElMessage.success("已全部已读");
  msg.refresh();
}

async function saveSettings() {
  saving.value = true;
  try {
    const { id, userId, ...payload } = settings.value;
    settings.value = await messageApi.updateSettings(payload);
    ElMessage.success("已保存");
  } finally { saving.value = false; }
}

async function openNotification(item: any) {
  activeNotice.value = item;
  reviewTarget.value = null;
  detailOpen.value = true;
  const target = getReviewTargetFromNotice(item);
  if (!target || !auth.isMod) return;
  reviewTargetLoading.value = true;
  try {
    reviewTarget.value = await adminApi.reviewTarget(target.kind, target.id);
  } catch {
    reviewTarget.value = null;
  } finally {
    reviewTargetLoading.value = false;
  }
}

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
  if (!activeNotice.value?.link) return;
  detailOpen.value = false;
  router.push(activeNotice.value.link);
}

async function approveFromNotice() {
  if (!reviewTarget.value?.reviewable) return;
  reviewing.value = true;
  try {
    if (reviewTarget.value.kind === "reply") {
      await adminApi.updateReply(reviewTarget.value.id, {
        aiReviewStatus: "approved_manual",
        manualReviewNote: "管理员通过消息中心审核通过",
      });
    } else {
      await adminApi.updateTopic(reviewTarget.value.id, {
        aiReviewStatus: "approved_manual",
        manualReviewNote: "管理员通过消息中心审核通过",
      });
    }
    ElMessage.success("已审核通过");
    detailOpen.value = false;
    [list.value, settings.value] = await Promise.all([messageApi.list(), messageApi.settings()]);
    msg.refresh();
  } finally {
    reviewing.value = false;
  }
}

async function rejectFromNotice() {
  if (!reviewTarget.value?.reviewable) return;
  const { value } = await ElMessageBox.prompt("填写驳回说明（选填）", "人工驳回", {
    inputPlaceholder: "例如：存在明显人身攻击 / 泄露隐私信息",
  }).catch(() => ({ value: "" }));
  reviewing.value = true;
  try {
    if (reviewTarget.value.kind === "reply") {
      await adminApi.updateReply(reviewTarget.value.id, {
        aiReviewStatus: "rejected_manual",
        manualReviewNote: value || "管理员通过消息中心人工驳回",
      });
    } else {
      await adminApi.updateTopic(reviewTarget.value.id, {
        aiReviewStatus: "rejected_manual",
        manualReviewNote: value || "管理员通过消息中心人工驳回",
      });
    }
    ElMessage.success("已驳回");
    detailOpen.value = false;
    [list.value, settings.value] = await Promise.all([messageApi.list(), messageApi.settings()]);
    msg.refresh();
  } finally {
    reviewing.value = false;
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

function formatNoticeTime(value?: string) {
  return fmtDate(value, "YYYY-MM-DD HH:mm");
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
.page-title { margin: 0; font-size: 22px; }
.page-sub {
  color: #6b7280;
  font-size: 13px;
}
.cpu-card { background: #fff; border-radius: 12px; padding: 16px 20px; box-shadow: 0 2px 12px rgba(0,0,0,0.04); }

.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 4px;
}
.bar-meta {
  color: #6b7280;
  font-size: 13px;
}
.notice-detail { display: flex; flex-direction: column; gap: 12px; }
.notice-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}
.notice-head h3 { margin: 0; font-size: 18px; color: #1f2937; }
.notice-head span { font-size: 12px; color: #94a3b8; line-height: 1.5; word-break: break-word; }
.notice-content { margin: 0; color: #374151; line-height: 1.75; white-space: pre-wrap; }
.review-state { font-size: 13px; color: #166534; background: #ecfdf5; border: 1px solid #bbf7d0; border-radius: 8px; padding: 10px 12px; }
.review-state.done { color: #6b7280; background: #f8fafc; border-color: #e2e8f0; }
.notice-risk { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: #92400e; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 10px 12px; }
.notice-draft { border: 1px solid #e5e7eb; border-radius: 8px; background: #f9fafb; padding: 12px; }
.draft-title { font-size: 14px; font-weight: 600; color: #111827; }
.draft-note { margin-top: 8px; font-size: 13px; color: #6b7280; }

.settings h4 { margin: 8px 0 6px; color: #1f2937; }
.hint { font-size: 12px; color: #6b7280; margin: 0 0 10px; }
.setting-block {
  display: flex;
  gap: 10px;
  align-items: center;
}
.switches { display: flex; flex-direction: column; gap: 12px; }
.switch-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid #eef0f4;
  border-radius: 12px;
  background: #fafbfc;
  color: #374151;
  font-size: 14px;
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
    gap: 4px;
  }

  .page-title {
    font-size: 20px;
  }

  .cpu-card {
    border-radius: 10px;
    padding: 12px;
  }

  .messages-tabs {
    margin: 0 -4px;
    padding: 10px 8px 12px;
  }

  .messages-tabs :deep(.el-tabs__header) {
    margin-bottom: 12px;
    overflow: visible;
  }

  .messages-tabs :deep(.el-tabs__nav-wrap) {
    padding: 0 4px 2px;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }

  .messages-tabs :deep(.el-tabs__nav-wrap::after),
  .messages-tabs :deep(.el-tabs__active-bar) {
    display: none;
  }

  .messages-tabs :deep(.el-tabs__nav-wrap::-webkit-scrollbar) {
    display: none;
  }

  .messages-tabs :deep(.el-tabs__nav-scroll) {
    padding: 0 0 2px;
  }

  .messages-tabs :deep(.el-tabs__nav) {
    float: none;
    width: max-content;
    min-width: max-content;
    white-space: nowrap;
    gap: 8px;
    padding-inline: 4px;
    padding-right: 4px;
  }

  .messages-tabs :deep(.el-tabs__item) {
    height: 34px;
    padding: 0 12px;
    font-size: 13px;
    border-radius: 999px;
    background: #f3f4f6;
    color: #4b5563;
  }

  .messages-tabs :deep(.el-tabs__item.is-active) {
    background: linear-gradient(135deg, var(--cpu-primary), var(--cpu-primary-dark));
    color: #fff;
  }

  .messages-tabs :deep(.el-tabs__content) {
    overflow: visible;
  }

  .time-row {
    align-items: stretch;
    flex-direction: column;
    gap: 8px;
  }

  .time-sep {
    align-self: center;
    color: #94a3b8;
    font-size: 12px;
  }

  .time-row :deep(.el-select),
  .time-row :deep(.el-input) {
    width: 100% !important;
  }

  .switch-item {
    padding: 12px;
  }

  .settings .el-button {
    width: 100%;
  }

  .bar {
    align-items: stretch;
    flex-direction: column;
    gap: 8px;
  }

  .bar .el-button {
    width: 100%;
  }

  .bar-meta {
    font-size: 12px;
  }

  :deep(.notice-dialog) {
    width: calc(100vw - 20px) !important;
    max-width: calc(100vw - 20px) !important;
    margin-top: 4vh;
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
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .notice-actions :deep(.el-button) {
    width: 100%;
    margin-left: 0;
  }
}

@media (max-width: 420px) {
  .switch-item {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
