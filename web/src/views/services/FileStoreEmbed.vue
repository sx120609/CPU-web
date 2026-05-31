<template>
  <div class="filestore-page">
    <section class="filestore-head">
      <div>
        <div class="kicker">FILESTORE</div>
        <h2>文件收集</h2>
      </div>
      <div class="filestore-actions">
        <el-button plain @click="$router.push('/services/tools')">
          <el-icon><ArrowLeft /></el-icon>
          返回
        </el-button>
        <el-button type="primary" @click="openStandalone">
          <el-icon><TopRight /></el-icon>
          新窗口
        </el-button>
      </div>
    </section>

    <section v-if="loading" class="filestore-state" v-loading="loading"></section>

    <section v-else-if="!canAccess" class="filestore-state">
      <el-empty description="你还没有文件收集管理权限">
        <el-button type="primary" @click="$router.push('/services/tools')">返回小工具</el-button>
      </el-empty>
    </section>

    <section v-else class="filestore-frame-shell">
      <iframe class="filestore-frame" src="/filestore/" title="文件收集系统"></iframe>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ArrowLeft, TopRight } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { toolsApi } from "@/api/tools";

const loading = ref(true);
const canAccess = ref(false);

onMounted(loadPermission);

async function loadPermission() {
  loading.value = true;
  try {
    const perms = await toolsApi.myPermissions();
    canAccess.value = perms.adminToolCodes.includes("file_collect") || perms.toolCodes.includes("file_collect");
    if (!canAccess.value) ElMessage.warning("没有文件收集管理权限");
  } finally {
    loading.value = false;
  }
}

function openStandalone() {
  window.open("/filestore/", "_blank", "noopener");
}
</script>

<style scoped>
.filestore-page {
  min-height: calc(100vh - 64px);
  background: #f6f8fb;
  padding: 14px 22px 22px;
}
.filestore-head {
  width: min(1680px, 100%);
  margin: 0 auto 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.kicker {
  color: #0f766e;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0;
}
.filestore-head h2 {
  margin: 4px 0 0;
  color: #111827;
}
.filestore-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.filestore-frame-shell {
  width: min(1680px, 100%);
  height: calc(100vh - 126px);
  min-height: 760px;
  margin: 0 auto;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  overflow: hidden;
}
.filestore-state {
  width: min(1680px, 100%);
  min-height: 420px;
  margin: 0 auto;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  display: grid;
  place-items: center;
}
.filestore-frame {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
}
@media (max-width: 700px) {
  .filestore-page {
    padding: 12px;
  }
  .filestore-head {
    align-items: flex-start;
    flex-direction: column;
  }
  .filestore-actions,
  .filestore-actions :deep(.el-button) {
    width: 100%;
  }
  .filestore-frame-shell {
    height: calc(100vh - 178px);
    min-height: 620px;
  }
}
</style>
