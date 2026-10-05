<template>
  <el-dialog
    v-model="fileManagerVisible"
    :fullscreen="isMobileLayout"
    width="760px"
    class="fs-files-dialog"
    append-to-body
    :align-center="!isMobileLayout"
  >
    <template #header>
      <div class="fs-files-head">
        <b>文件管理</b>
        <span>{{ detail?.title }} · 共 {{ allFiles.length }} 个文件</span>
      </div>
    </template>

    <div class="fs-files-tools">
      <el-input v-model="fileQuery" :prefix-icon="Search" clearable placeholder="搜索文件名、姓名、编号" />
      <el-dropdown trigger="click" @command="onRepair">
        <el-button :loading="repairing" :icon="Tools">修复文件名</el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="local">修复乱码文件名</el-dropdown-item>
            <el-dropdown-item command="remote">修复云端文件名</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <div class="fs-files-list">
      <div v-if="!filteredFiles.length" class="fs-files-empty">
        <b>{{ allFiles.length ? "没有匹配文件" : "暂无文件" }}</b>
        <span>{{ allFiles.length ? "换个关键词再试。" : "提交者上传后会显示在这里。" }}</span>
      </div>
      <article v-for="item in filteredFiles" :key="item.file.id" class="fs-files-row">
        <FileBadge :name="item.file.storedName" :size="38" />
        <div class="fs-files-copy">
          <b :title="item.file.storedName">{{ item.file.storedName }}</b>
          <span>{{ item.owner }}<template v-if="item.identifier"> · {{ item.identifier }}</template> · {{ formatBytes(item.file.size) }}</span>
        </div>
        <div class="fs-files-actions">
          <el-tooltip content="查看" placement="top" :disabled="isMobileLayout">
            <el-button text :icon="View" aria-label="查看" @click="previewFile(item.file)" />
          </el-tooltip>
          <el-tooltip content="下载" placement="top" :disabled="isMobileLayout">
            <el-button text :icon="Download" aria-label="下载" @click="downloadFile(item.file)" />
          </el-tooltip>
          <el-tooltip content="删除" placement="top" :disabled="isMobileLayout">
            <el-button text type="danger" :icon="Delete" aria-label="删除" @click="deleteFile(item.file)" />
          </el-tooltip>
        </div>
      </article>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { Delete, Download, Search, Tools, View } from "@element-plus/icons-vue";
import { formatBytes } from "@/views/services/fileCollectExport";
import { useMobileLayout } from "@/utils/mobileLayout";
import { useInjectedFilestoreWorkspace } from "../workspace";
import FileBadge from "./FileBadge.vue";

const isMobileLayout = useMobileLayout();
const {
  fileManagerVisible,
  fileQuery,
  detail,
  allFiles,
  filteredFiles,
  repairing,
  previewFile,
  downloadFile,
  deleteFile,
  repairFilenames,
  repairRemoteFilenames,
} = useInjectedFilestoreWorkspace();

function onRepair(command: "local" | "remote") {
  if (command === "remote") void repairRemoteFilenames();
  else void repairFilenames();
}
</script>

<style scoped>
.fs-files-head { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
.fs-files-head b { font-size: 17px; font-weight: 700; }
.fs-files-head span { overflow: hidden; color: var(--cpu-text-secondary); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.fs-files-tools { display: flex; gap: 8px; margin-bottom: 12px; }
.fs-files-tools .el-input { flex: 1; }
.fs-files-list {
  max-height: min(60vh, 560px);
  overflow-y: auto;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
}
.fs-files-row { display: flex; align-items: center; gap: 11px; padding: 10px 8px 10px 12px; border-bottom: 1px solid var(--cpu-border-soft); }
.fs-files-row:last-child { border-bottom: 0; }
.fs-files-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 2px; }
.fs-files-copy b { overflow: hidden; font-size: 14px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.fs-files-copy span { overflow: hidden; color: var(--cpu-text-muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.fs-files-actions { display: flex; flex: 0 0 auto; gap: 2px; }
.fs-files-actions .el-button { width: 34px; min-width: 34px; margin: 0; padding: 0; }
.fs-files-empty { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 36px 16px; color: var(--cpu-text-muted); font-size: 12px; }
.fs-files-empty b { color: var(--cpu-text); font-size: 14px; }
:global(.fs-files-dialog.is-fullscreen .fs-files-list) { max-height: none; }
:global(.fs-files-dialog.is-fullscreen .el-dialog__body) { padding-bottom: calc(16px + env(safe-area-inset-bottom)); }

@media (max-width: 768px) {
  .fs-files-tools .el-button { padding-inline: 10px; }
}
</style>
