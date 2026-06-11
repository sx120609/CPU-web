<template>
  <div class="filestore-page">
    <section v-if="loading" class="filestore-state" v-loading="loading">
      <p>正在进入文件收集系统...</p>
    </section>

    <section v-else class="filestore-state">
      <el-empty description="你还没有文件收集管理权限">
        <el-button type="primary" @click="$router.push('/services/tools')">返回小工具</el-button>
      </el-empty>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { toolsApi } from "@/api/tools";

const loading = ref(true);

onMounted(loadPermission);

async function loadPermission() {
  loading.value = true;
  try {
    const perms = await toolsApi.myPermissions();
    const canAccess = perms.adminToolCodes.includes("file_collect") || perms.toolCodes.includes("file_collect");
    if (canAccess) {
      window.location.replace("/filestore/");
      return;
    }
    ElMessage.warning("没有文件收集管理权限");
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.filestore-page {
  min-height: calc(100dvh - 64px);
  background: #f6f8fb;
  padding: 22px;
}
.filestore-state {
  width: min(860px, 100%);
  min-height: 420px;
  margin: 0 auto;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  display: grid;
  place-items: center;
}
@media (max-width: 700px) {
  .filestore-page {
    padding: 12px;
  }
}
</style>
