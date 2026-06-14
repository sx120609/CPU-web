<template>
  <section class="database-pane">
    <div class="hero">
      <div>
        <h2>数据管理</h2>
        <p>当前服务端已统一使用 PostgreSQL。这里可以查看主库状态、下载备份，也可以上传已有备份并直接恢复当前主库。</p>
      </div>
      <el-button :loading="loading" :disabled="loading || restoreBusy" @click="loadStatus">刷新状态</el-button>
    </div>

    <el-alert
      v-if="loadError"
      type="error"
      :closable="false"
      :title="loadError"
      show-icon
    >
      <template #default>
        <el-button size="small" :loading="loading" @click="loadStatus">重试</el-button>
      </template>
    </el-alert>

    <el-alert
      v-if="status?.maintenanceActive"
      type="warning"
      :closable="false"
      :title="status.maintenanceMessage"
      show-icon
    />

    <el-alert
      v-if="status && !status.supported"
      type="warning"
      :closable="false"
      :title="status.reason || '当前数据库暂不支持在线备份'"
      show-icon
    />

    <el-alert
      v-if="status && !status.restoreSupported"
      type="warning"
      :closable="false"
      :title="status.restoreReason || '当前数据库暂不支持在线恢复'"
      show-icon
    />

    <div v-if="status" class="status-grid">
      <article class="status-card">
        <div class="label">当前数据库</div>
        <div class="value">{{ providerLabel }}</div>
        <div class="hint">{{ providerHint }}</div>
      </article>
      <article class="status-card">
        <div class="label">数据库连接</div>
        <div class="value path">{{ status.databasePathLabel || "未识别" }}</div>
        <div class="hint">{{ status.exists ? "当前数据库连接可用" : "当前无法确认数据库可用性" }}</div>
      </article>
      <article class="status-card">
        <div class="label">备份方式</div>
        <div class="value">{{ backupMethodLabel }}</div>
        <div class="hint">{{ backupMethodHint }}</div>
      </article>
      <article class="status-card">
        <div class="label">恢复方式</div>
        <div class="value">{{ restoreMethodLabel }}</div>
        <div class="hint">{{ restoreMethodHint }}</div>
      </article>
      <article class="status-card">
        <div class="label">当前体积</div>
        <div class="value">{{ formatBytes(status.sizeBytes) }}</div>
        <div class="hint">这里展示的是当前 PostgreSQL 数据库体积。</div>
      </article>
      <article class="status-card">
        <div class="label">最近文件时间</div>
        <div class="value">{{ formatTime(status.updatedAt) }}</div>
        <div class="hint">PostgreSQL 直连运行，没有单独的本地数据库文件时间。</div>
      </article>
      <article class="status-card">
        <div class="label">建议文件名</div>
        <div class="value path">{{ status.downloadFileName || "暂无" }}</div>
        <div class="hint">下载时会直接使用这个文件名。</div>
      </article>
      <article class="status-card">
        <div class="label">恢复上传限制</div>
        <div class="value">{{ formatBytes(status.maxRestoreUploadBytes) }}</div>
        <div class="hint">仅建议上传从本页下载得到的 PostgreSQL 自定义备份文件。</div>
      </article>
    </div>

    <article v-if="status" class="action-card">
      <div class="copy">
        <h3>下载 PostgreSQL 备份</h3>
        <p>{{ downloadHint }}</p>
      </div>
      <el-button type="primary" :loading="downloading" :disabled="!canDownload || downloading || restoreBusy" @click="downloadBackup">
        下载数据库备份
      </el-button>
    </article>

    <article v-if="status" class="action-card danger-card">
      <div class="copy">
        <h3>上传并恢复 PostgreSQL 备份</h3>
        <p>{{ restoreHint }}</p>
        <div class="restore-meta">
          <div class="restore-file">{{ restoreFile ? restoreFile.name : "未选择备份文件" }}</div>
          <div class="restore-file-hint">
            {{ restoreFile ? `文件大小：${formatBytes(restoreFile.size)}` : `支持选择：${status.restoreUploadAccept || ".dump,.backup,.tar"}` }}
          </div>
        </div>
      </div>
      <div class="action-buttons">
        <input
          ref="restoreInput"
          class="hidden-file-input"
          type="file"
          :accept="status.restoreUploadAccept || '.dump,.backup,.tar'"
          :disabled="restoreBusy"
          @change="onRestoreFileChange"
        />
        <el-button :disabled="!canRestore || restoreBusy" @click="selectRestoreFile">选择备份文件</el-button>
        <el-button v-if="restoreFile" :disabled="restoreBusy" @click="clearRestoreFile()">清空</el-button>
        <el-button type="danger" :loading="restoreBusy" :disabled="!canRestore || !restoreFile || restoreBusy" @click="confirmRestore">
          上传并恢复
        </el-button>
      </div>
    </article>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { adminApi, type DatabaseBackupStatus, type DatabaseRestoreResult } from "@/api/admin";

const loading = ref(false);
const loadError = ref("");
const downloading = ref(false);
const restoring = ref(false);
const restoreConfirming = ref(false);
const status = ref<DatabaseBackupStatus | null>(null);
const restoreInput = ref<HTMLInputElement | null>(null);
const restoreFile = ref<File | null>(null);
const restoreBusy = computed(() => restoring.value || restoreConfirming.value);
let statusLoadSeq = 0;
let downloadSeq = 0;
let restoreSeq = 0;
let disposed = false;

onMounted(() => {
  disposed = false;
  void loadStatus();
});

onBeforeUnmount(() => {
  disposed = true;
  statusLoadSeq++;
  downloadSeq++;
  restoreSeq++;
  loading.value = false;
  downloading.value = false;
  restoring.value = false;
  restoreConfirming.value = false;
});

async function loadStatus() {
  if (disposed) return;
  const seq = ++statusLoadSeq;
  loading.value = true;
  loadError.value = "";
  try {
    const next = await adminApi.databaseStatus({ suppressErrorMessage: true });
    if (!disposed && seq === statusLoadSeq) status.value = next;
  } catch (error) {
    if (!disposed && seq === statusLoadSeq) {
      status.value = null;
      loadError.value = requestMessage(error) || "数据库状态加载失败，请稍后重试";
    }
  } finally {
    if (!disposed && seq === statusLoadSeq) loading.value = false;
  }
}

function requestMessage(error: unknown) {
  if (typeof error !== "object" || error === null) return "";
  const responseMessage = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message;
  if (typeof responseMessage === "string") return responseMessage;
  return error instanceof Error ? error.message : "";
}

function formatBytes(value: number | null | undefined) {
  if (!value && value !== 0) return "未知";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatTime(value: string | null | undefined) {
  if (!value) return "不适用";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatDuration(durationMs: number) {
  if (durationMs < 1000) return `${durationMs} ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)} 秒`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);
  return `${minutes} 分 ${seconds} 秒`;
}

function buildFallbackFileName() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `cpu-web-db-backup-${yyyy}${mm}${dd}-${hh}${mi}${ss}.dump`;
}

const providerLabel = computed(() => {
  if (status.value?.provider === "postgresql") return "PostgreSQL";
  return "暂不支持";
});

const providerHint = computed(() => {
  if (status.value?.provider === "postgresql") return "当前运行库已统一切到 PostgreSQL。";
  return status.value?.reason || "当前 DATABASE_URL 不是 PostgreSQL 连接串。";
});

const backupMethodLabel = computed(() => {
  if (status.value?.backupMethod === "pg-dump") return "pg_dump 自定义备份";
  return "不可用";
});

const backupMethodHint = computed(() => {
  if (status.value?.backupMethod === "pg-dump") return "服务端使用 pg_dump 导出 PostgreSQL 备份文件。";
  return status.value?.reason || "当前没有可用的在线备份方式。";
});

const restoreMethodLabel = computed(() => {
  if (status.value?.restoreMethod === "pg-restore") return "pg_restore 在线恢复";
  return "不可用";
});

const restoreMethodHint = computed(() => {
  if (status.value?.restoreMethod === "pg-restore") {
    return "服务端会先进入维护模式，再用 pg_restore 覆盖当前 PostgreSQL 主库。";
  }
  return status.value?.restoreReason || "当前没有可用的在线恢复方式。";
});

const canDownload = computed(() =>
  Boolean(status.value?.supported) &&
  Boolean(status.value?.exists) &&
  !Boolean(status.value?.maintenanceActive)
);

const canRestore = computed(() =>
  Boolean(status.value?.restoreSupported) &&
  Boolean(status.value?.exists) &&
  !Boolean(status.value?.maintenanceActive)
);

const downloadHint = computed(() => {
  if (status.value?.provider === "postgresql") {
    return "下载的是服务器当前 PostgreSQL 主库导出的备份文件。适合在做结构调整、升级或高风险操作前先留底。";
  }
  return status.value?.reason || "当前数据库暂不支持在线备份。";
});

const restoreHint = computed(() => {
  if (status.value?.provider === "postgresql") {
    return "恢复会覆盖当前 PostgreSQL 主库，并在恢复期间临时进入维护模式。建议只上传从本页下载得到的备份文件。";
  }
  return status.value?.restoreReason || "当前数据库暂不支持在线恢复。";
});

function selectRestoreFile() {
  if (disposed) return;
  if (restoreBusy.value || !canRestore.value) return;
  if (restoreInput.value) restoreInput.value.value = "";
  restoreInput.value?.click();
}

function clearRestoreFile(force = false) {
  if (disposed) return;
  if (restoreBusy.value && !force) return;
  restoreFile.value = null;
  if (restoreInput.value) restoreInput.value.value = "";
}

function onRestoreFileChange(event: Event) {
  if (disposed) return;
  if (restoreBusy.value) return;
  const input = event.target as HTMLInputElement | null;
  const file = input?.files?.[0] || null;
  const maxBytes = status.value?.maxRestoreUploadBytes;
  if (file && maxBytes && file.size > maxBytes) {
    ElMessage.warning(`备份文件超过上传限制：${formatBytes(maxBytes)}`);
    clearRestoreFile(true);
    return;
  }
  restoreFile.value = file;
}

async function downloadBackup() {
  const currentStatus = status.value;
  if (disposed || downloading.value || restoreBusy.value || !canDownload.value || !currentStatus) return;
  const seq = ++downloadSeq;
  downloading.value = true;
  try {
    const blob = await adminApi.downloadDatabaseBackup();
    if (disposed || seq !== downloadSeq) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = currentStatus.downloadFileName || buildFallbackFileName();
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    ElMessage.success("数据库备份已开始下载");
  } catch (error: any) {
    if (!disposed && seq === downloadSeq) ElMessage.error(error?.message || "数据库备份下载失败");
  } finally {
    if (!disposed && seq === downloadSeq) downloading.value = false;
  }
}

async function confirmRestore() {
  if (disposed || !restoreFile.value || !canRestore.value || restoreBusy.value) return;
  const seq = ++restoreSeq;
  restoreConfirming.value = true;
  const confirmed = await ElMessageBox.prompt(
    "这会覆盖当前 PostgreSQL 主库，恢复期间站点会进入维护模式。请输入 RESTORE 确认继续。",
    "确认恢复数据库",
    {
      confirmButtonText: "上传并恢复",
      cancelButtonText: "取消",
      inputPattern: /^RESTORE$/,
      inputErrorMessage: "请输入 RESTORE",
      type: "warning",
    },
  ).then(() => true).catch(() => false);
  if (disposed || seq !== restoreSeq) return;
  restoreConfirming.value = false;
  if (!confirmed) {
    return;
  }
  await uploadAndRestore(seq);
}

async function uploadAndRestore(seq = ++restoreSeq) {
  const file = restoreFile.value;
  if (disposed || !file || restoring.value) return;
  restoring.value = true;
  try {
    const formData = new FormData();
    formData.append("file", file);
    const result = await adminApi.restoreDatabaseBackup(formData, {
      timeout: 10 * 60 * 1000,
      suppressErrorMessage: true,
    });
    if (disposed || seq !== restoreSeq) return;
    handleRestoreSuccess(result);
    clearRestoreFile(true);
    await loadStatus();
  } catch (error: any) {
    if (!disposed && seq === restoreSeq) {
      ElMessage.error(error?.response?.data?.message || error?.message || "数据库恢复失败");
      await loadStatus().catch(() => undefined);
    }
  } finally {
    if (!disposed && seq === restoreSeq) restoring.value = false;
  }
}

function handleRestoreSuccess(result: DatabaseRestoreResult) {
  ElMessage.success(`数据库已恢复完成，耗时 ${formatDuration(result.durationMs)}`);
}
</script>

<style scoped>
.database-pane {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.hero,
.action-card {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.hero h2,
.action-card h3 {
  margin: 0 0 6px;
}

.hero h2 {
  font-size: 20px;
}

.hero p,
.action-card p {
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

.danger-card {
  border-color: #f7d8d8;
  background: linear-gradient(180deg, #fffefe 0%, #fff7f7 100%);
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

.action-card {
  align-items: center;
  gap: 20px;
}

.action-buttons {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.restore-meta {
  margin-top: 10px;
}

.restore-file {
  font-size: 14px;
  font-weight: 600;
  color: #12314f;
  word-break: break-all;
}

.restore-file-hint {
  margin-top: 4px;
  font-size: 12px;
  color: #6b7280;
}

.hidden-file-input {
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

  .action-buttons {
    justify-content: flex-start;
  }
}
</style>
