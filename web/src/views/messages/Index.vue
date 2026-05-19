<template>
  <div class="msg-page">
    <h2 class="page-title">消息中心</h2>
    <el-tabs v-model="tab" class="cpu-card">
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
          <div class="row">
            <el-time-select v-model="settings.quietStart" start="00:00" step="00:30" end="23:30" />
            <span>至</span>
            <el-time-select v-model="settings.quietEnd" start="00:00" step="00:30" end="23:30" />
          </div>
          <el-divider />
          <h4>订阅偏好</h4>
          <div class="switches">
            <div><el-switch v-model="settings.subscribeReply" /> 收到回复时</div>
            <div><el-switch v-model="settings.subscribeLike" /> 收到点赞时</div>
            <div><el-switch v-model="settings.subscribeSchool" /> 校园公告更新</div>
            <div><el-switch v-model="settings.subscribeSystem" /> 系统 / 站务通知</div>
          </div>
          <el-button type="primary" :loading="saving" @click="saveSettings" style="margin-top:14px">保存设置</el-button>
        </div>
      </el-tab-pane>
    </el-tabs>

    <div class="bar" v-if="tab !== 'settings'">
      <el-button text @click="readAll">全部标为已读</el-button>
    </div>

    <el-dialog v-model="detailOpen" title="通知详情" width="620px" append-to-body>
      <div v-if="activeNotice" class="notice-detail">
        <div class="notice-head">
          <h3>{{ activeNotice.title }}</h3>
          <span>{{ activeNotice.source || "校内" }} · {{ activeNotice.createdAt }}</span>
        </div>
        <p class="notice-content">{{ activeNotice.content }}</p>

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
        <el-button v-if="activeNotice?.link" @click="goNoticeLink">前往查看</el-button>
        <el-button
          v-if="canReviewActiveNotice && activeNotice?.payload?.topicId"
          type="success"
          :loading="reviewing"
          @click="approveFromNotice"
        >
          审核通过
        </el-button>
        <el-button
          v-if="canReviewActiveNotice && activeNotice?.payload?.topicId"
          type="warning"
          :loading="reviewing"
          @click="rejectFromNotice"
        >
          驳回
        </el-button>
        <el-button @click="detailOpen = false">关闭</el-button>
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

function openNotification(item: any) {
  activeNotice.value = item;
  detailOpen.value = true;
}

const canReviewActiveNotice = computed(() => {
  if (!auth.isMod || !activeNotice.value?.payload?.type) return false;
  return activeNotice.value.payload.type === "topic-manual-review-admin";
});

function goNoticeLink() {
  if (!activeNotice.value?.link) return;
  detailOpen.value = false;
  router.push(activeNotice.value.link);
}

async function approveFromNotice() {
  if (!activeNotice.value?.payload?.topicId) return;
  reviewing.value = true;
  try {
    await adminApi.updateTopic(activeNotice.value.payload.topicId, {
      aiReviewStatus: "approved_manual",
      manualReviewNote: "管理员通过消息中心审核通过",
    });
    ElMessage.success("已审核通过");
    detailOpen.value = false;
    [list.value, settings.value] = await Promise.all([messageApi.list(), messageApi.settings()]);
    msg.refresh();
  } finally {
    reviewing.value = false;
  }
}

async function rejectFromNotice() {
  if (!activeNotice.value?.payload?.topicId) return;
  const { value } = await ElMessageBox.prompt("填写驳回说明（选填）", "人工驳回", {
    inputPlaceholder: "例如：存在明显人身攻击 / 泄露隐私信息",
  }).catch(() => ({ value: "" }));
  reviewing.value = true;
  try {
    await adminApi.updateTopic(activeNotice.value.payload.topicId, {
      aiReviewStatus: "rejected_manual",
      manualReviewNote: value || "管理员通过消息中心人工驳回",
    });
    ElMessage.success("已驳回");
    detailOpen.value = false;
    [list.value, settings.value] = await Promise.all([messageApi.list(), messageApi.settings()]);
    msg.refresh();
  } finally {
    reviewing.value = false;
  }
}
</script>

<style scoped>
.msg-page { display: flex; flex-direction: column; gap: 8px; }
.page-title { margin: 0; font-size: 22px; }
.cpu-card { background: #fff; border-radius: 12px; padding: 16px 20px; box-shadow: 0 2px 12px rgba(0,0,0,0.04); }

.bar { display: flex; justify-content: flex-end; margin-top: 8px; }
.notice-detail { display: flex; flex-direction: column; gap: 12px; }
.notice-head h3 { margin: 0; font-size: 18px; color: #1f2937; }
.notice-head span { font-size: 12px; color: #94a3b8; }
.notice-content { margin: 0; color: #374151; line-height: 1.75; white-space: pre-wrap; }
.notice-risk { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: #92400e; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 10px 12px; }
.notice-draft { border: 1px solid #e5e7eb; border-radius: 8px; background: #f9fafb; padding: 12px; }
.draft-title { font-size: 14px; font-weight: 600; color: #111827; }
.draft-note { margin-top: 8px; font-size: 13px; color: #6b7280; }

.settings h4 { margin: 8px 0 6px; color: #1f2937; }
.hint { font-size: 12px; color: #6b7280; margin: 0 0 10px; }
.row { display: flex; gap: 10px; align-items: center; }
.switches { display: flex; flex-direction: column; gap: 12px; }

@media (max-width: 640px) {
  .page-title {
    font-size: 20px;
  }

  .cpu-card {
    border-radius: 10px;
    padding: 12px;
  }

  .row {
    align-items: stretch;
    flex-direction: column;
    gap: 8px;
  }

  .row > span {
    align-self: center;
  }

  .row :deep(.el-select),
  .row :deep(.el-input) {
    width: 100% !important;
  }

  .settings .el-button {
    width: 100%;
  }

  .bar {
    justify-content: stretch;
  }

  .bar .el-button {
    width: 100%;
  }
}
</style>
