<template>
  <div class="msg-page">
    <h2 class="page-title">消息中心</h2>
    <el-tabs v-model="tab" class="cpu-card">
      <el-tab-pane label="全部" name="all">
        <MessageList :list="filtered('')" @read="onRead" />
      </el-tab-pane>
      <el-tab-pane label="回复 / 提及" name="reply">
        <MessageList :list="filtered('reply')" @read="onRead" />
      </el-tab-pane>
      <el-tab-pane label="点赞" name="like">
        <MessageList :list="filtered('like')" @read="onRead" />
      </el-tab-pane>
      <el-tab-pane label="系统 / 站务" name="system">
        <MessageList :list="filtered('system')" @read="onRead" />
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
            <div><el-switch v-model="settings.subscribeSchool" /> 学校公告新条目</div>
            <div><el-switch v-model="settings.subscribeSystem" /> 系统 / 站务通知</div>
          </div>
          <el-button type="primary" :loading="saving" @click="saveSettings" style="margin-top:14px">保存设置</el-button>
        </div>
      </el-tab-pane>
    </el-tabs>

    <div class="bar" v-if="tab !== 'settings'">
      <el-button text @click="readAll">全部标为已读</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRoute } from "vue-router";
import { ElMessage } from "element-plus";
import MessageList from "@/components/messages/MessageList.vue";
import { messageApi } from "@/api/message";
import { useMessageStore } from "@/stores/message";

const route = useRoute();
const msg = useMessageStore();

const tab = ref(route.query.tab === "settings" ? "settings" : "all");
const list = ref<any[]>([]);
const settings = ref<any>(null);
const saving = ref(false);

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
</script>

<style scoped>
.msg-page { display: flex; flex-direction: column; gap: 8px; }
.page-title { margin: 0; font-size: 22px; }
.cpu-card { background: #fff; border-radius: 12px; padding: 16px 20px; box-shadow: 0 2px 12px rgba(0,0,0,0.04); }

.bar { display: flex; justify-content: flex-end; margin-top: 8px; }

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
