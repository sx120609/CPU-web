<template>
  <div class="boards-pane">
    <div class="ctrl-bar">
      <el-button type="primary" :disabled="saving || loading" @click="openCreate">新增板块</el-button>
      <el-button :loading="loading" :disabled="loading" @click="reload">刷新</el-button>
    </div>

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

    <el-table :data="list" v-loading="loading" stripe class="admin-table">
      <el-table-column prop="order" label="排序" width="80" />
      <el-table-column prop="slug" label="Slug" width="150" />
      <el-table-column label="板块" min-width="220">
        <template #default="{ row }">
          <div class="board-main">
            <span class="icon" :style="{ background: row.color || '#168776' }">{{ row.icon || "💬" }}</span>
            <div>
              <div class="name">{{ row.name }}</div>
              <div class="desc">{{ row.description || "暂无描述" }}</div>
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="type" label="类型" width="120" />
      <el-table-column label="状态" width="180">
        <template #default="{ row }">
          <el-tag v-if="row.readOnly || row.feedSourceId" type="warning" size="small">公告同步</el-tag>
          <el-tag v-else type="success" size="small">可维护</el-tag>
          <el-tag v-if="row.anonymousEnabled" type="info" size="small" effect="plain">支持匿名</el-tag>
          <span class="topic-count">{{ row.topicCount }} 帖</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="108" fixed="right" align="center">
        <template #default="{ row }">
          <el-dropdown trigger="click" @command="handleBoardCommand($event, row)">
            <el-button text size="small" class="action-trigger" :loading="isBoardBusy(row)" :disabled="row.readOnly || row.feedSourceId || isBoardBusy(row)">
              操作<el-icon class="more-icon"><MoreFilled /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="edit" :disabled="isBoardBusy(row)">编辑</el-dropdown-item>
                <el-dropdown-item command="delete" divided :disabled="isBoardBusy(row)">删除</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </template>
      </el-table-column>
    </el-table>

    <div class="mobile-list" v-loading="loading">
      <article v-for="row in list" :key="row.id" class="board-card">
        <div class="board-main">
          <span class="icon" :style="{ background: row.color || '#168776' }">{{ row.icon || "💬" }}</span>
          <div>
            <div class="name">{{ row.name }}</div>
            <div class="desc">{{ row.description || "暂无描述" }}</div>
          </div>
        </div>
        <div class="board-meta">
          <span>#{{ row.order }} · {{ row.slug }}</span>
          <span>{{ row.type }}</span>
          <span>{{ row.topicCount }} 帖</span>
          <span v-if="row.anonymousEnabled">支持匿名</span>
        </div>
        <div class="board-actions">
          <el-dropdown trigger="click" @command="handleBoardCommand($event, row)">
            <el-button plain size="small" class="mobile-action-trigger" :loading="isBoardBusy(row)" :disabled="row.readOnly || row.feedSourceId || isBoardBusy(row)">
              操作<el-icon class="more-icon"><MoreFilled /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="edit" :disabled="isBoardBusy(row)">编辑</el-dropdown-item>
                <el-dropdown-item command="delete" divided :disabled="isBoardBusy(row)">删除</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </article>
      <el-empty v-if="!loading && !list.length" description="暂无板块" />
    </div>

    <el-dialog v-model="dialogOpen" :title="editingId ? '编辑板块' : '新增板块'" width="480px" append-to-body>
      <el-form :model="form" label-position="top">
        <el-form-item label="Slug" required>
          <el-input v-model="form.slug" maxlength="40" placeholder="例如 study-share" />
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="form.name" maxlength="40" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" maxlength="140" />
        </el-form-item>
        <div class="row2">
          <el-form-item label="图标">
            <el-input v-model="form.icon" maxlength="8" placeholder="📚" />
          </el-form-item>
          <el-form-item label="颜色">
            <el-input v-model="form.color" maxlength="20" placeholder="#168776" />
          </el-form-item>
        </div>
        <div class="row2">
          <el-form-item label="排序">
            <el-input-number v-model="form.order" :min="0" :max="9999" />
          </el-form-item>
          <el-form-item label="类型" required>
            <el-select v-model="form.type">
              <el-option label="normal" value="normal" />
              <el-option label="question" value="question" />
              <el-option label="market" value="market" />
              <el-option label="coursereview" value="coursereview" />
            </el-select>
          </el-form-item>
        </div>
        <el-form-item label="匿名机制">
          <el-switch v-model="form.anonymousEnabled" />
          <span class="anonymous-switch-note">开启后，该板块可消耗用户每周匿名积分进行匿名发帖 / 回复。</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="saving" @click="dialogOpen = false">取消</el-button>
        <el-button type="primary" :loading="saving" :disabled="saving" @click="submitBoard">{{ editingId ? "保存" : "创建" }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { MoreFilled } from "@element-plus/icons-vue";
import { adminApi } from "@/api/admin";

const loading = ref(false);
const loadError = ref("");
const saving = ref(false);
const boardBusyId = ref<number | null>(null);
const dialogOpen = ref(false);
const editingId = ref<number | null>(null);
const list = ref<any[]>([]);
let boardLoadSeq = 0;

const form = reactive({
  slug: "",
  name: "",
  description: "",
  icon: "",
  color: "",
  order: 0,
  type: "normal" as "normal" | "question" | "market" | "coursereview",
  anonymousEnabled: false,
});

onMounted(reload);

async function reload() {
  const seq = ++boardLoadSeq;
  loading.value = true;
  loadError.value = "";
  try {
    const next = await adminApi.boards({ suppressErrorMessage: true });
    if (seq === boardLoadSeq) list.value = next;
  } catch (error) {
    if (seq === boardLoadSeq) {
      list.value = [];
      loadError.value = requestMessage(error) || "板块列表加载失败，请稍后重试";
    }
  } finally {
    if (seq === boardLoadSeq) loading.value = false;
  }
}

function requestMessage(error: unknown) {
  if (typeof error !== "object" || error === null) return "";
  const responseMessage = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message;
  if (typeof responseMessage === "string") return responseMessage;
  return error instanceof Error ? error.message : "";
}

function handleBoardCommand(command: string, row: any) {
  if (boardBusyId.value !== null) return;
  if (command === "edit") return openEdit(row);
  if (command === "delete") return removeBoard(row);
}

function isBoardBusy(row: any) {
  return boardBusyId.value === row.id;
}

function openCreate() {
  if (saving.value) return;
  editingId.value = null;
  Object.assign(form, {
    slug: "",
    name: "",
    description: "",
    icon: "",
    color: "",
    order: 0,
    type: "normal",
    anonymousEnabled: false,
  });
  dialogOpen.value = true;
}

function openEdit(row: any) {
  if (saving.value || boardBusyId.value !== null) return;
  editingId.value = row.id;
  Object.assign(form, {
    slug: row.slug,
    name: row.name,
    description: row.description || "",
    icon: row.icon || "",
    color: row.color || "",
    order: row.order ?? 0,
    type: row.type,
    anonymousEnabled: Boolean(row.anonymousEnabled),
  });
  dialogOpen.value = true;
}

async function submitBoard() {
  if (saving.value) return;
  if (!/^[a-z0-9-]{2,40}$/.test(form.slug.trim())) { ElMessage.warning("Slug 仅支持小写字母、数字和中划线"); return; }
  if (!form.name.trim()) { ElMessage.warning("请填写板块名称"); return; }
  saving.value = true;
  try {
    const payload = {
      slug: form.slug.trim(),
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      icon: form.icon.trim() || undefined,
      color: form.color.trim() || undefined,
      order: Number(form.order || 0),
      type: form.type,
      anonymousEnabled: form.anonymousEnabled,
    };
    if (editingId.value) await adminApi.updateBoard(editingId.value, payload);
    else await adminApi.createBoard(payload);
    ElMessage.success(editingId.value ? "已保存板块" : "已创建板块");
    dialogOpen.value = false;
    await reload();
  } finally {
    saving.value = false;
  }
}

async function removeBoard(row: any) {
  if (boardBusyId.value !== null) return;
  boardBusyId.value = row.id;
  try {
    const confirmed = await ElMessageBox.confirm(`确认删除板块「${row.name}」？仅空板块可删除。`, "删除板块", { type: "warning" })
      .then(() => true)
      .catch(() => false);
    if (!confirmed) return;
    await adminApi.deleteBoard(row.id);
    ElMessage.success("已删除");
    await reload();
  } finally {
    boardBusyId.value = null;
  }
}
</script>

<style scoped>
.boards-pane { display: flex; flex-direction: column; gap: 12px; }
.ctrl-bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.pane-alert :deep(.el-alert__content) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}
.board-main { display: flex; gap: 12px; align-items: flex-start; }
.icon {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  color: #fff;
  flex-shrink: 0;
}
.name { font-size: 14px; font-weight: 600; color: #111827; }
.desc { margin-top: 2px; font-size: 12px; color: #6b7280; line-height: 1.55; }
.topic-count { margin-left: 8px; font-size: 12px; color: #9ca3af; }
.admin-table { display: block; }
.mobile-list {
  display: none;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
  gap: 12px;
}
.board-card {
  padding: 14px;
  border: 1px solid #e7edf5;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}
.board-meta {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 8px;
  font-size: 12px;
  color: #6b7280;
}
.board-actions {
  margin-top: 12px;
}
.board-actions :deep(.el-dropdown) {
  width: 100%;
}
.mobile-action-trigger {
  width: 100%;
}
.mobile-list :deep(.el-empty) {
  grid-column: 1 / -1;
}
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.anonymous-switch-note { margin-left: 10px; color: #6b7280; font-size: 12px; }
.action-trigger { justify-content: center; }
.more-icon { margin-left: 2px; transform: rotate(90deg); }

@media (max-width: 768px) {
  .admin-table { display: none; }
  .mobile-list {
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
  }
  .row2 {
    grid-template-columns: 1fr;
    gap: 0;
  }
}
</style>
