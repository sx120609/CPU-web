<template>
  <div class="ann-pane">
    <el-card shadow="never" class="composer">
      <template #header><h3 style="margin:0;font-size:15px"><AppIcon :name="editingId ? 'edit' : 'announcement'" /> {{ editingId ? "编辑全站公告" : "发布全站公告" }}</h3></template>
      <el-form :model="form" label-position="top">
        <el-form-item label="标题">
          <el-input v-model="form.title" maxlength="120" placeholder="公告标题" show-word-limit />
        </el-form-item>
        <el-form-item label="内容">
          <el-input v-model="form.content" type="textarea" :rows="4" maxlength="2000" placeholder="公告内容，所有用户都会在消息中心看到" show-word-limit />
        </el-form-item>
        <el-form-item label="级别">
          <el-radio-group v-model="form.level">
            <el-radio-button value="weak">弱（资讯）</el-radio-button>
            <el-radio-button value="normal">普通</el-radio-button>
            <el-radio-button value="strong">强（强提醒，跳静默时段）</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="附带链接（选填）">
          <el-input v-model="form.link" placeholder="例如 /forum/topic/123 或 https://..." />
        </el-form-item>
        <el-form-item label="发布者（展示名）">
          <el-input v-model="form.source" maxlength="40" placeholder="默认显示为 站务组" />
        </el-form-item>
        <el-form-item label="投放平台">
          <div class="target-picker">
            <el-checkbox v-model="targetAll" border>全部</el-checkbox>
            <el-checkbox-group v-model="form.targetClients" class="target-options" :disabled="targetAll">
              <el-checkbox-button v-for="item in targetOptions" :key="item.value" :label="item.value">
                {{ item.label }}
              </el-checkbox-button>
            </el-checkbox-group>
          </div>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="publishing" :disabled="publishing || !form.title.trim() || !form.content.trim()" @click="publish">
            {{ editingId ? "保存修改" : "发布公告" }}
          </el-button>
          <el-button v-if="editingId" :disabled="publishing" @click="resetForm">取消编辑</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never">
      <template #header>
        <div class="hdr">
          <h3 style="margin:0;font-size:15px"><AppIcon name="document" /> 历史公告</h3>
          <el-button text :loading="loading" :disabled="loading" @click="reload">刷新</el-button>
        </div>
      </template>
      <el-alert
        v-if="loadError"
        type="error"
        :closable="false"
        show-icon
        class="pane-alert"
        :title="loadError"
      >
        <template #default>
          <el-button size="small" :loading="loading" @click="reload">重试</el-button>
        </template>
      </el-alert>
      <div v-loading="loading" class="ann-list">
        <el-empty v-if="!list.length" description="还没发布过公告" />
        <div v-for="a in list" :key="a.id" class="ann-row">
          <div class="ann-main">
            <div class="ann-title">
              <el-tag size="small" :type="a.level === 'strong' ? 'danger' : a.level === 'normal' ? 'primary' : 'info'" effect="plain">
                {{ a.level }}
              </el-tag>
              <el-tag v-if="targetLabel(a.targetClient) !== '全部'" size="small" effect="plain">
                {{ targetLabel(a.targetClient) }}
              </el-tag>
              {{ a.title }}
            </div>
            <div class="ann-content">{{ a.content }}</div>
            <div class="ann-meta">{{ fmtDate(a.createdAt) }} · {{ a.source || "站务组" }}</div>
          </div>
          <el-dropdown trigger="click" @command="handleAnnouncementCommand($event, a)">
            <el-button text size="small" class="action-trigger" :loading="isAnnouncementBusy(a)" :disabled="isAnnouncementBusy(a)">
              操作<el-icon class="more-icon"><MoreFilled /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="edit" :disabled="isAnnouncementBusy(a)">编辑</el-dropdown-item>
                <el-dropdown-item command="delete" divided :disabled="isAnnouncementBusy(a)">删除</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import AppIcon from "@/components/common/AppIcon.vue";
import { ref, reactive, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { MoreFilled } from "@element-plus/icons-vue";
import { adminApi } from "@/api/admin";
import { fmtDate } from "@/utils/format";

type AnnouncementTargetClient = "ios" | "android" | "harmony" | "web";

const targetOptions: Array<{ value: AnnouncementTargetClient; label: string }> = [
  { value: "ios", label: "iOS" },
  { value: "android", label: "安卓" },
  { value: "harmony", label: "鸿蒙" },
  { value: "web", label: "网页版" },
];
const targetLabelMap: Record<AnnouncementTargetClient, string> = {
  ios: "iOS",
  android: "安卓",
  harmony: "鸿蒙",
  web: "网页版",
};

const list = ref<any[]>([]);
const editingId = ref<number | null>(null);
const form = reactive({ title: "", content: "", level: "normal", link: "", source: "站务组", targetClients: [] as AnnouncementTargetClient[] });
const targetAll = ref(true);
const loading = ref(false);
const loadError = ref("");
const publishing = ref(false);
const announcementBusyId = ref<number | null>(null);
let announcementLoadSeq = 0;

onMounted(reload);
async function reload() {
  const seq = ++announcementLoadSeq;
  loading.value = true;
  loadError.value = "";
  try {
    const next = await adminApi.announcements({ suppressErrorMessage: true });
    if (seq === announcementLoadSeq) list.value = next;
  } catch (error) {
    if (seq === announcementLoadSeq) {
      list.value = [];
      loadError.value = requestMessage(error) || "历史公告加载失败，请稍后重试";
    }
  } finally {
    if (seq === announcementLoadSeq) loading.value = false;
  }
}

function requestMessage(error: unknown) {
  if (typeof error !== "object" || error === null) return "";
  const responseMessage = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message;
  if (typeof responseMessage === "string") return responseMessage;
  return error instanceof Error ? error.message : "";
}

function isAnnouncementTargetClient(value: string): value is AnnouncementTargetClient {
  return targetOptions.some((item) => item.value === value);
}

function parseTargetClients(value?: string | AnnouncementTargetClient[] | null): AnnouncementTargetClient[] {
  const raw = Array.isArray(value) ? value : String(value || "").split(",");
  const selected = new Set(
    raw
      .map((item) => item.trim().toLowerCase())
      .filter(isAnnouncementTargetClient),
  );
  return targetOptions.map((item) => item.value).filter((value) => selected.has(value));
}

function targetLabel(value?: string | AnnouncementTargetClient[] | null) {
  const clients = parseTargetClients(value);
  if (!clients.length || clients.length === targetOptions.length) return "全部";
  return clients.map((client) => targetLabelMap[client]).join("、");
}

function selectedTargetPayload(): "all" | AnnouncementTargetClient[] {
  if (targetAll.value) return "all";
  return parseTargetClients(form.targetClients);
}

function validateTargetSelection() {
  if (targetAll.value) return true;
  if (parseTargetClients(form.targetClients).length) return true;
  ElMessage.warning("请选择至少一个投放平台，或勾选全部");
  return false;
}

async function publish() {
  if (publishing.value) return;
  if (!form.title.trim() || !form.content.trim()) {
    ElMessage.warning("请填写公告标题和内容");
    return;
  }
  if (!validateTargetSelection()) return;
  publishing.value = true;
  try {
    const targetClient = selectedTargetPayload();
    if (editingId.value) {
      await adminApi.updateAnnouncement(editingId.value, {
        title: form.title.trim(),
        content: form.content.trim(),
        level: form.level,
        link: form.link.trim() || null,
        source: form.source.trim() || "站务组",
        targetClient,
      });
      ElMessage.success("公告已更新");
    } else {
      await adminApi.createAnnouncement({
        title: form.title.trim(),
        content: form.content.trim(),
        level: form.level,
        link: form.link.trim() || undefined,
        source: form.source.trim() || "站务组",
        targetClient,
      });
      ElMessage.success("公告已发布");
    }
    resetForm();
    await reload();
  } finally { publishing.value = false; }
}

function handleAnnouncementCommand(command: string, row: any) {
  if (announcementBusyId.value !== null) return;
  if (command === "edit") return startEdit(row);
  if (command === "delete") return removeAnn(row);
}

function isAnnouncementBusy(row: any) {
  return announcementBusyId.value === row.id;
}

function startEdit(row: any) {
  editingId.value = row.id;
  form.title = row.title || "";
  form.content = row.content || "";
  form.level = row.level || "normal";
  form.link = row.link || "";
  form.source = row.source || "站务组";
  form.targetClients = parseTargetClients(row.targetClient);
  targetAll.value = !form.targetClients.length;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetForm() {
  editingId.value = null;
  form.title = "";
  form.content = "";
  form.level = "normal";
  form.link = "";
  form.source = "站务组";
  form.targetClients = [];
  targetAll.value = true;
}

async function removeAnn(a: any) {
  if (announcementBusyId.value !== null) return;
  announcementBusyId.value = a.id;
  try {
    const confirmed = await ElMessageBox.confirm(`删除公告《${a.title}》？`, "确认", { type: "warning" })
      .then(() => true)
      .catch(() => false);
    if (!confirmed) return;
    await adminApi.deleteAnnouncement(a.id);
    ElMessage.success("已删除");
    if (editingId.value === a.id) resetForm();
    await reload();
  } finally {
    announcementBusyId.value = null;
  }
}
</script>

<style scoped>
.ann-pane { display: flex; flex-direction: column; gap: 14px; }
.composer .el-card__header { padding-bottom: 0; }
.hdr { display: flex; justify-content: space-between; align-items: center; }
.pane-alert {
  margin-bottom: 12px;
}
.pane-alert :deep(.el-alert__content) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}
.ann-list { min-height: 80px; }
.ann-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 10px 0;
  border-bottom: 1px dashed #f1f5f9;
}
.ann-row:last-child { border-bottom: none; }
.ann-main { flex: 1; min-width: 0; }
.ann-title { font-size: 14px; font-weight: 600; color: #1f2937; display: flex; gap: 6px; align-items: center; }
.ann-content { font-size: 13px; color: #4b5563; margin: 4px 0 4px; }
.ann-meta { font-size: 11px; color: #9ca3af; }
.action-trigger { justify-content: center; }
.more-icon { margin-left: 2px; transform: rotate(90deg); }
.target-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.target-options {
  display: flex;
  flex-wrap: wrap;
  gap: 0;
}

@media (max-width: 768px) {
  .ann-pane :deep(.el-card__body) {
    padding: 12px;
  }
  .ann-pane :deep(.el-radio-group),
  .target-picker,
  .target-options {
    display: grid;
    width: 100%;
    gap: 8px;
  }
  .ann-pane :deep(.el-radio-button__inner),
  .target-options :deep(.el-checkbox-button__inner),
  .target-picker :deep(.el-checkbox) {
    width: 100%;
    border-left: var(--el-border);
    border-radius: var(--el-border-radius-base);
  }
  .target-picker :deep(.el-checkbox) {
    margin-right: 0;
  }
  .ann-pane :deep(.el-form-item:last-child .el-button) {
    width: 100%;
  }
  .ann-row {
    gap: 10px;
    flex-direction: column;
  }
  .ann-title {
    align-items: flex-start;
    line-height: 1.5;
  }
  .ann-row :deep(.el-dropdown) {
    width: 100%;
  }
  .action-trigger {
    width: 100%;
  }
}
</style>
