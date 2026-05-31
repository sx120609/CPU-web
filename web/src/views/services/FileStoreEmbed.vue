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

    <section class="filestore-frame-shell">
      <iframe class="filestore-frame" src="/filestore/" title="文件收集系统"></iframe>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ArrowLeft, TopRight } from "@element-plus/icons-vue";

function openStandalone() {
  window.open("/filestore/", "_blank", "noopener");
}
</script>

<style scoped>
.filestore-page {
  min-height: calc(100vh - 64px);
  background: #f6f8fb;
  padding: 18px;
}
.filestore-head {
  max-width: 1180px;
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
  max-width: 1180px;
  height: calc(100vh - 152px);
  min-height: 680px;
  margin: 0 auto;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  overflow: hidden;
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
