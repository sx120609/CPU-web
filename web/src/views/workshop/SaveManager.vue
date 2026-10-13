<template>
  <el-dialog :model-value="true" title="我的云端存档" width="min(640px, 92vw)" @close="emit('close')">
    <p class="pk-muted">账号最多保存 2 MiB。已下架或停用的作品也可清理；删除后无法恢复。</p>
    <p v-if="loading" role="status">正在读取存档…</p>
    <p v-else-if="error" role="alert">{{ error }} <el-button @click="load">重试</el-button></p>
    <p v-else-if="!saves.length" class="pk-muted">没有云端存档</p>
    <div v-for="save in saves" :key="save.workId" class="ws-version">
      <div class="ws-version-copy"><b>{{ save.name }}</b><p class="pk-muted">{{ (save.bytes / 1024).toFixed(1) }} KiB · {{ workshopDate(save.updatedAt) }}</p></div>
      <el-button type="danger" plain :loading="busy === save.workId" :disabled="Boolean(busy)" @click="remove(save)">删除存档</el-button>
    </div>
    <el-pagination v-if="total > pageSize" v-model:current-page="page" :page-size="pageSize" :total="total" layout="prev, pager, next" @current-change="load" />
  </el-dialog>
</template>
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { workshopApi, type WorkshopSaveSummary } from "@/api/workshop";
import { useAuthStore } from "@/stores/auth";
import { workshopDate, workshopError } from "./shared";
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
