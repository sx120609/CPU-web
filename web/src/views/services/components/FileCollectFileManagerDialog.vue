<template>
  <el-dialog v-model="dialogOpen" width="min(980px, 96dvw)" class="responsive-tool-dialog file-manager-dialog">
    <template #header>
      <div class="responses-title">
        <div>
          <b>{{ task?.title || "文件管理" }}</b>
          <span>{{ files.length }} 个文件</span>
        </div>
        <el-button v-if="task" size="small" plain :loading="zipDownloading" :disabled="zipDownloading" @click="emit('download-zip', task)">
          <el-icon><Download /></el-icon>
          下载 ZIP
        </el-button>
        <el-button v-if="task" size="small" plain :loading="fileNameRepairing" :disabled="fileNameRepairing" @click="emit('repair-names', task)">
          <el-icon><Refresh /></el-icon>
          修复乱码文件名
        </el-button>
      </div>
    </template>

    <div v-loading="loading">
      <div class="file-manager-toolbar">
        <el-input v-model="keyword" clearable placeholder="搜索文件名、提交人、学号或填写内容" />
      </div>
      <div class="file-manager-list">
        <article v-for="item in files" :key="item.id" class="file-manager-card">
          <div class="file-manager-main">
            <strong>{{ item.storedName }}</strong>
            <span>{{ item.folderPath }}</span>
            <small>{{ item.submission.identity || `提交 #${item.submission.id}` }} · {{ fmtDate(item.submission.createdAt) }} · {{ formatBytes(item.size) }}</small>
          </div>
          <div class="file-manager-actions">
            <button type="button" :disabled="isActionDisabled(item.id)" @click="emit('preview-file', item.id, item.storedName)">
              <el-icon><View /></el-icon>
              {{ previewingId === item.id ? "预览中" : "预览" }}
            </button>
            <button type="button" :disabled="isActionDisabled(item.id)" @click="emit('download-file', item.id, item.storedName)">
              <el-icon><Download /></el-icon>
              {{ downloadingId === item.id ? "下载中" : "下载" }}
            </button>
            <button type="button" :disabled="isActionDisabled(item.id)" @click="emit('delete-file', item.id)">
              <el-icon><Delete /></el-icon>
              删除
            </button>
          </div>
        </article>
        <el-empty v-if="!files.length" description="暂无匹配文件" />
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Delete, Download, Refresh, View } from "@element-plus/icons-vue";
import type { FileCollectSubmission, FileCollectTask } from "@/api/tools";
import { fmtDate } from "@/utils/format";
import { formatBytes, zipEntryPath } from "@/views/services/fileCollectExport";

const props = withDefaults(defineProps<{
  modelValue: boolean;
  task: FileCollectTask | null;
  submissions: FileCollectSubmission[];
  loading?: boolean;
  zipDownloading: boolean;
  fileNameRepairing: boolean;
  deletingId: number | null;
  downloadingId: number | null;
  previewingId: number | null;
}>(), {
  loading: false,
});

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  "download-zip": [task: FileCollectTask];
  "repair-names": [task: FileCollectTask];
  "preview-file": [id: number, filename: string];
  "download-file": [id: number, filename: string];
  "delete-file": [id: number];
}>();

type ManagedFile = FileCollectSubmission["files"][number] & {
  submission: FileCollectSubmission;
  folderPath: string;
};

const keyword = ref("");

const dialogOpen = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

const files = computed<ManagedFile[]>(() => {
  const query = keyword.value.trim().toLowerCase();
  const task = props.task;
  return props.submissions.flatMap((submission) => submission.files.map((file) => ({
    ...file,
    submission,
    folderPath: task ? zipEntryPath(task, submission, file) : file.storedName,
  }))).filter((item) => {
    if (!query) return true;
    const dataText = JSON.stringify(item.submission.data).toLowerCase();
    return `${item.storedName} ${item.originalName} ${item.submission.identity} ${dataText}`.toLowerCase().includes(query);
  });
});

watch(() => props.modelValue, (open) => {
  if (open) keyword.value = "";
});

function isTransferBusy(id: number) {
  return props.zipDownloading || props.downloadingId === id || props.previewingId === id;
}

function isActionDisabled(id: number) {
  return props.deletingId !== null || isTransferBusy(id);
}
</script>

<style scoped>
.responses-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.responses-title div {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.responses-title b {
  color: #111827;
  font-size: 16px;
}

.responses-title span {
  color: #6b7280;
  font-size: 12px;
}

.file-manager-toolbar { margin-bottom: 12px; }

.file-manager-list {
  display: grid;
  gap: 10px;
  max-height: min(62dvh, 620px);
  overflow: auto;
}

.file-manager-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 12px;
  border: 1px solid #eef0f4;
  border-radius: 8px;
  background: #fff;
  min-width: 0;
  overflow: hidden;
}

.file-manager-main {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.file-manager-main strong,
.file-manager-main span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.file-manager-main strong { color: #111827; }
.file-manager-main span { color: #2563eb; font-size: 13px; }
.file-manager-main small { color: #64748b; overflow-wrap: anywhere; min-width: 0; }

.file-manager-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}

.file-manager-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  min-height: 34px;
  padding: 6px 12px;
  background: #fff;
  color: #334155;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 650;
  min-width: 0;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}

.file-manager-actions button:hover {
  color: #1d4ed8;
  border-color: #bfdbfe;
  background: #eff6ff;
}

.file-manager-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.file-manager-actions button:last-child {
  color: #dc2626;
  border-color: #fecaca;
  background: #fef2f2;
}

.file-manager-actions button:last-child:hover {
  border-color: #fca5a5;
  background: #fee2e2;
}

@media (max-width: 700px) {
  .responses-title {
    align-items: stretch;
    flex-direction: column;
    padding-right: 26px;
  }

  .responses-title .el-button {
    width: 100%;
  }

  .file-manager-card {
    grid-template-columns: 1fr;
  }

  .file-manager-actions {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .file-manager-actions button {
    width: 100%;
    min-height: 40px;
  }
}
</style>
