<template>
  <el-dialog :model-value="true" class="wk-dialog" title="云端存档" width="min(560px, 92vw)" @close="emit('close')">
    <p class="wk-sub wk-saves-hint">每个作品一份存档，账号合计最多 2 MB。删除后不能恢复。</p>
    <p v-if="loading" class="wk-empty" role="status">正在读取存档…</p>
    <div v-else-if="error" class="wk-empty" role="alert">
      <p>{{ error }}</p>
      <el-button @click="load">重试</el-button>
    </div>
    <p v-else-if="!saves.length" class="wk-empty">还没有云端存档</p>
    <div v-else class="wk-rows wk-saves">
      <div v-for="save in saves" :key="save.workId" class="wk-row">
        <div class="wk-row-copy">
          <div class="wk-row-title">{{ save.name }}</div>
          <p class="wk-meta">
            <span>{{ (save.bytes / 1024).toFixed(1) }} KB</span>
            <span>{{ workshopAgo(save.updatedAt) }}保存</span>
          </p>
        </div>
        <el-button type="danger" plain :loading="busy === save.workId" :disabled="Boolean(busy)" @click="remove(save)">删除</el-button>
      </div>
    </div>
    <div v-if="total > pageSize" class="wk-pagination">
      <el-pagination v-model:current-page="page" :page-size="pageSize" :total="total" layout="prev, pager, next" @current-change="load" />
    </div>
  </el-dialog>
</template>
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { workshopApi, type WorkshopSaveSummary } from "@/api/workshop";
import { useAuthStore } from "@/stores/auth";
import { workshopAgo, workshopError } from "./shared";
import "./workshop.css";
const emit = defineEmits<{ close: [] }>();
const auth = useAuthStore();
const saves = ref<WorkshopSaveSummary[]>([]), loading = ref(false), error = ref(""), busy = ref("");
const page = ref(1), total = ref(0), pageSize = 12;
let generation = 0, alive = true;
async function load() {
  const seq = ++generation;
  loading.value = true;
  error.value = "";
  try {
    const result = await workshopApi.savedWorks({ page: page.value, pageSize });
    if (!alive || seq !== generation) return;
    if (page.value > Math.max(1, result.pagination.totalPages)) {
      page.value = Math.max(1, result.pagination.totalPages);
      await load();
      return;
    }
    saves.value = result.items;
    total.value = result.pagination.total;
  } catch (cause) {
    if (alive && seq === generation) error.value = workshopError(cause, "存档加载失败");
  } finally {
    if (alive && seq === generation) loading.value = false;
  }
}
async function remove(save: WorkshopSaveSummary) {
  if (busy.value) return;
  const session = auth.sessionVersion;
  busy.value = save.workId;
  try {
    await ElMessageBox.confirm(`确认删除「${save.name}」的云端存档？进度和设置无法恢复。`, "删除存档", { type: "warning" });
    if (!alive || session !== auth.sessionVersion) return;
    await workshopApi.deleteStorage(save.workId);
    if (!alive || session !== auth.sessionVersion) return;
    ElMessage.success("存档已删除");
    await load();
  } catch (cause) {
    if (alive && cause !== "cancel" && cause !== "close") ElMessage.error(workshopError(cause));
  } finally {
    busy.value = "";
  }
}
watch(() => auth.sessionVersion, () => { generation++; saves.value = []; emit("close"); });
onMounted(load);
onBeforeUnmount(() => { alive = false; generation++; });
</script>

<style scoped>
.wk-saves-hint { margin: 0 0 8px; }
.wk-saves .wk-row { padding-right: 0; padding-left: 0; }
</style>
