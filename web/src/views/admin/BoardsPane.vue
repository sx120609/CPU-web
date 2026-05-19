<template>
  <div class="boards-pane">
    <div class="ctrl-bar">
      <el-button type="primary" @click="openCreate">新增板块</el-button>
      <el-button @click="reload">刷新</el-button>
    </div>

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
          <span class="topic-count">{{ row.topicCount }} 帖</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="220" fixed="right">
        <template #default="{ row }">
          <el-button text size="small" :disabled="row.readOnly || row.feedSourceId" @click="openEdit(row)">编辑</el-button>
          <el-button text type="danger" size="small" :disabled="row.readOnly || row.feedSourceId" @click="removeBoard(row)">删除</el-button>
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
        </div>
        <div class="board-actions">
          <el-button plain size="small" :disabled="row.readOnly || row.feedSourceId" @click="openEdit(row)">编辑</el-button>
          <el-button plain type="danger" size="small" :disabled="row.readOnly || row.feedSourceId" @click="removeBoard(row)">删除</el-button>
        </div>
      </article>
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
      </el-form>
      <template #footer>
        <el-button @click="dialogOpen = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitBoard">{{ editingId ? "保存" : "创建" }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { adminApi } from "@/api/admin";

const loading = ref(false);
const saving = ref(false);
const dialogOpen = ref(false);
const editingId = ref<number | null>(null);
const list = ref<any[]>([]);

const form = reactive({
  slug: "",
  name: "",
  description: "",
  icon: "",
  color: "",
  order: 0,
  type: "normal" as "normal" | "question" | "market" | "coursereview",
});

onMounted(reload);

async function reload() {
  loading.value = true;
  try {
    list.value = await adminApi.boards();
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editingId.value = null;
  Object.assign(form, {
    slug: "",
    name: "",
    description: "",
    icon: "",
    color: "",
    order: 0,
    type: "normal",
  });
  dialogOpen.value = true;
}

function openEdit(row: any) {
  editingId.value = row.id;
  Object.assign(form, {
    slug: row.slug,
    name: row.name,
    description: row.description || "",
    icon: row.icon || "",
    color: row.color || "",
    order: row.order ?? 0,
    type: row.type,
  });
  dialogOpen.value = true;
}

async function submitBoard() {
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
  await ElMessageBox.confirm(`确认删除板块「${row.name}」？仅空板块可删除。`, "删除板块", { type: "warning" });
  await adminApi.deleteBoard(row.id);
  ElMessage.success("已删除");
  await reload();
}
</script>

<style scoped>
.boards-pane { display: flex; flex-direction: column; gap: 12px; }
.ctrl-bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
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
.mobile-list { display: none; }
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

@media (max-width: 768px) {
  .admin-table { display: none; }
  .mobile-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .board-card {
    padding: 12px;
    border: 1px solid #eef0f4;
    border-radius: 10px;
    background: #fff;
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
    display: flex;
    gap: 8px;
    margin-top: 12px;
  }
  .board-actions :deep(.el-button) {
    flex: 1;
    margin-left: 0;
  }
  .row2 {
    grid-template-columns: 1fr;
    gap: 0;
  }
}
</style>
