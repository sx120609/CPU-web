<template>
  <section class="database-pane">
    <div class="hero">
      <div>
        <h2>数据库备份</h2>
        <p>先把当前主站 SQLite 主库下载下来，再去做迁移或结构调整。恢复会直接覆盖当前主库。</p>
      </div>
      <el-button :loading="loading" @click="loadStatus">刷新状态</el-button>
    </div>

    <el-alert
      v-if="status && !status.supported"
      type="warning"
      :closable="false"
      :title="status.reason || '当前数据库暂不支持该备份方式'"
      show-icon
    />

    <el-alert
      v-else-if="status?.maintenanceActive"
      type="warning"
      :closable="false"
      :title="status.maintenanceMessage"
      show-icon
    />

    <div v-if="status" class="status-grid">
      <article class="status-card">
        <div class="label">备份方式</div>
        <div class="value">{{ status.provider === "sqlite-file" ? "SQLite 文件快照" : "暂不支持" }}</div>
        <div class="hint">当前版本只处理主站主库，不包含独立 Filestore 库。</div>
      </article>
      <article class="status-card">
        <div class="label">数据库位置</div>
        <div class="value path">{{ status.databasePathLabel || "未识别" }}</div>
        <div class="hint">{{ status.exists ? "文件存在，可直接备份" : "文件不存在" }}</div>
      </article>
      <article class="status-card">
        <div class="label">当前大小</div>
        <div class="value">{{ formatBytes(status.sizeBytes) }}</div>
        <div class="hint">修改前先下载一份，最稳。</div>
      </article>
      <article class="status-card">
        <div class="label">最后更新时间</div>
        <div class="value">{{ formatTime(status.updatedAt) }}</div>
        <div class="hint">可作为你判断最近是否有写入的参考。</div>
      </article>
    </div>

    <div v-if="status?.supported" class="action-panel">
      <article class="action-card">
        <div class="copy">
          <h3>下载备份</h3>
          <p>后台会先生成一份一致性 SQLite 快照，再把它下载成本地文件。</p>
        </div>
        <el-button type="primary" :loading="downloading" :disabled="!status.exists || status.maintenanceActive" @click="downloadBackup">
          下载当前数据库
        </el-button>
      </article>

      <article class="action-card danger">
        <div class="copy">
          <h3>上传恢复</h3>
          <p>上传此前下载的 `.sqlite/.db` 备份文件后，会立即覆盖当前主库。恢复前请确认没有人正在关键操作。</p>
          <div class="picked" v-if="restoreFile">
            已选择：{{ restoreFile.name }} · {{ formatBytes(restoreFile.size) }}
          </div>
        </div>
        <div class="button-row">
          <input
            ref="fileInputRef"
            class="hidden-input"
            type="file"
            accept=".sqlite,.sqlite3,.db,application/vnd.sqlite3,application/x-sqlite3"
            @change="onFileChange"
          />
          <el-button :disabled="restoring || status.maintenanceActive" @click="pickFile">选择备份文件</el-button>
          <el-button type="danger" :disabled="!restoreFile || status.maintenanceActive" :loading="restoring" @click="restoreBackup">
            上传并恢复
          </el-button>
        </div>
      </article>

      <el-alert
        type="warning"
        :closable="false"
        show-icon
        title="恢复会直接覆盖当前主库。建议先再下载一份最新备份，并确认当前没有人在发帖、改配置或做其他写操作。"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { adminApi, type DatabaseBackupStatus } from "@/api/admin";

const loading = ref(false);
const downloading = ref(false);
const restoring = ref(false);
const status = ref<DatabaseBackupStatus | null>(null);
const restoreFile = ref<File | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);

onMounted(() => {
  void loadStatus();
});

async function loadStatus() {
  loading.value = true;
  try {
    status.value = await adminApi.databaseStatus();
  } finally {
    loading.value = false;
  }
}

function formatBytes(value: number | null | undefined) {
  if (!value && value !== 0) return "未知";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatTime(value: string | null | undefined) {
  if (!value) return "未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function buildFallbackFileName() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `cpu-web-db-backup-${yyyy}${mm}${dd}-${hh}${mi}${ss}.sqlite`;
}

async function downloadBackup() {
  if (!status.value?.supported || !status.value.exists) return;
  downloading.value = true;
  try {
    const blob = await adminApi.downloadDatabaseBackup();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = status.value.downloadFileName || buildFallbackFileName();
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    ElMessage.success("数据库备份已开始下载");
  } catch (error: any) {
    ElMessage.error(error?.message || "数据库备份下载失败");
  } finally {
    downloading.value = false;
  }
}

function pickFile() {
  fileInputRef.value?.click();
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement | null;
  restoreFile.value = input?.files?.[0] ?? null;
}

async function restoreBackup() {
  if (!restoreFile.value) {
    ElMessage.warning("请先选择备份文件");
    return;
  }

  await ElMessageBox.confirm(
    `确认用 ${restoreFile.value.name} 覆盖当前数据库？恢复后当前主库会立刻被替换，建议先下载一份最新备份。`,
    "恢复数据库",
    {
      type: "warning",
      confirmButtonText: "确认恢复",
      cancelButtonText: "取消",
    }
  );

  restoring.value = true;
  try {
    const result = await adminApi.restoreDatabase(restoreFile.value);
    const extra = result.safetyCopyPathLabel ? ` 已在服务器保留恢复前副本：${result.safetyCopyPathLabel}` : "";
    ElMessage.success(`数据库已恢复。${extra}`.trim());
    restoreFile.value = null;
    if (fileInputRef.value) fileInputRef.value.value = "";
    await loadStatus();
  } finally {
    restoring.value = false;
  }
}
</script>

<style scoped>
.database-pane {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.hero {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.hero h2 {
  margin: 0 0 6px;
  font-size: 20px;
}

.hero p {
  margin: 0;
  color: #5b6472;
  line-height: 1.6;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.status-card,
.action-card {
  border: 1px solid #e5edf7;
  border-radius: 14px;
  background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
  padding: 16px 18px;
}

.label {
  font-size: 12px;
  color: #6b7280;
}

.value {
  margin-top: 6px;
  font-size: 18px;
  font-weight: 700;
  color: #12314f;
  line-height: 1.35;
}

.value.path {
  word-break: break-all;
}

.hint {
  margin-top: 6px;
  font-size: 12px;
  color: #6b7280;
  line-height: 1.5;
}

.action-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.action-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
}

.action-card h3 {
  margin: 0 0 6px;
  font-size: 17px;
  color: #10253e;
}

.action-card p {
  margin: 0;
  color: #58667a;
  line-height: 1.6;
}

.action-card.danger {
  border-color: #f5d0d0;
  background: linear-gradient(180deg, #fffefe 0%, #fff7f7 100%);
}

.button-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.picked {
  margin-top: 10px;
  font-size: 13px;
  color: #9a3412;
}

.hidden-input {
  display: none;
}

@media (max-width: 860px) {
  .hero,
  .action-card {
    flex-direction: column;
    align-items: stretch;
  }

  .status-grid {
    grid-template-columns: 1fr;
  }

  .button-row {
    justify-content: flex-start;
  }
}
</style>
