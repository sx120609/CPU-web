<template>
  <section class="database-pane">
    <div class="hero">
      <div>
        <h2>数据管理</h2>
        <p>自动识别当前主站数据库类型，并提供对应的在线备份下载能力。SQLite 走一致性快照，PostgreSQL 走 `pg_dump`。</p>
      </div>
      <el-button :loading="loading" @click="loadStatus">刷新状态</el-button>
    </div>

    <el-alert
      v-if="status && !status.supported"
      type="warning"
      :closable="false"
      :title="status.reason || '当前数据库暂不支持在线备份'"
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
        <div class="label">当前数据库</div>
        <div class="value">{{ providerLabel }}</div>
        <div class="hint">{{ providerHint }}</div>
      </article>
      <article class="status-card">
        <div class="label">数据库位置 / 连接</div>
        <div class="value path">{{ status.databasePathLabel || "未识别" }}</div>
        <div class="hint">{{ status.exists ? "数据库当前可访问" : "当前无法确认数据库是否存在" }}</div>
      </article>
      <article class="status-card">
        <div class="label">备份方式</div>
        <div class="value">{{ backupMethodLabel }}</div>
        <div class="hint">{{ backupMethodHint }}</div>
      </article>
      <article class="status-card">
        <div class="label">当前体积</div>
        <div class="value">{{ formatBytes(status.sizeBytes) }}</div>
        <div class="hint">{{ sizeHint }}</div>
      </article>
      <article class="status-card">
        <div class="label">最近文件时间</div>
        <div class="value">{{ formatTime(status.updatedAt) }}</div>
        <div class="hint">{{ updateHint }}</div>
      </article>
      <article class="status-card">
        <div class="label">建议文件名</div>
        <div class="value path">{{ status.downloadFileName || "暂无" }}</div>
        <div class="hint">下载时会直接使用这个文件名。</div>
      </article>
    </div>

    <article v-if="status" class="action-card">
      <div class="copy">
        <h3>下载数据库备份</h3>
        <p>{{ downloadHint }}</p>
      </div>
      <el-button type="primary" :loading="downloading" :disabled="!canDownload" @click="downloadBackup">
        {{ downloadButtonLabel }}
      </el-button>
    </article>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { adminApi, type DatabaseBackupStatus } from "@/api/admin";

const loading = ref(false);
const downloading = ref(false);
const status = ref<DatabaseBackupStatus | null>(null);

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
  if (!value) return "不适用";
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
  return `cpu-web-db-backup-${yyyy}${mm}${dd}-${hh}${mi}${ss}.dump`;
}

const providerLabel = computed(() => {
  if (status.value?.provider === "sqlite-file") return "SQLite 文件主库";
  if (status.value?.provider === "postgresql") return "PostgreSQL";
  return "暂不支持";
});

const providerHint = computed(() => {
  if (status.value?.provider === "sqlite-file") return "当前运行库仍是本地 SQLite 文件。";
  if (status.value?.provider === "postgresql") return "当前运行库已切到 PostgreSQL。";
  return "当前 DATABASE_URL 不是 SQLite / PostgreSQL。";
});

const backupMethodLabel = computed(() => {
  if (status.value?.backupMethod === "sqlite-vacuum-into") return "SQLite 一致性快照";
  if (status.value?.backupMethod === "pg-dump") return "pg_dump 自定义备份";
  return "不可用";
});

const backupMethodHint = computed(() => {
  if (status.value?.backupMethod === "sqlite-vacuum-into") return "服务端使用 VACUUM INTO 导出一致性备份。";
  if (status.value?.backupMethod === "pg-dump") return "服务端使用 pg_dump 导出 PostgreSQL 备份文件。";
  return status.value?.reason || "当前没有可用的在线备份方式。";
});

const sizeHint = computed(() => {
  if (status.value?.provider === "postgresql") return "这里展示的是当前 PostgreSQL 数据库体积。";
  if (status.value?.provider === "sqlite-file") return "这里展示的是 SQLite 数据库文件大小。";
  return "暂无可展示的体积信息。";
});

const updateHint = computed(() => {
  if (status.value?.provider === "postgresql") return "PostgreSQL 是实时连接库，没有单独的本地文件修改时间。";
  if (status.value?.provider === "sqlite-file") return "这里展示的是 SQLite 文件最近修改时间。";
  return "暂无可展示的时间信息。";
});

const canDownload = computed(() =>
  Boolean(status.value?.supported) &&
  Boolean(status.value?.exists) &&
  !Boolean(status.value?.maintenanceActive)
);

const downloadButtonLabel = computed(() => {
  if (status.value?.provider === "postgresql") return "下载 PostgreSQL 备份";
  if (status.value?.provider === "sqlite-file") return "下载 SQLite 备份";
  return "下载备份";
});

const downloadHint = computed(() => {
  if (status.value?.provider === "postgresql") {
    return "下载的是服务器当前 PostgreSQL 主库导出的备份文件。适合在做结构调整、升级或高风险操作前先留底。";
  }
  if (status.value?.provider === "sqlite-file") {
    return "下载的是服务器当前 SQLite 主库的一致性快照。适合在迁移或高风险改动前先留底。";
  }
  return status.value?.reason || "当前数据库暂不支持在线备份。";
});

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

@media (max-width: 860px) {
  .hero,
  .action-card {
    flex-direction: column;
    align-items: stretch;
  }

  .status-grid {
    grid-template-columns: 1fr;
  }
}
</style>
