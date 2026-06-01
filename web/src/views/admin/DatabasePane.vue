<template>
  <section class="database-pane">
    <div class="hero">
      <div>
        <h2>数据库</h2>
        <p>这里统一管理主站 SQLite 主库的备份、恢复，以及迁移到 PostgreSQL 的试跑与正式执行。</p>
      </div>
      <el-button :loading="loading" @click="loadStatus">刷新状态</el-button>
    </div>

    <div class="section">
      <div class="section-head">
        <div>
          <h3>SQLite 备份与恢复</h3>
          <p>先把当前主站 SQLite 主库下载下来，再去做迁移或结构调整。恢复会直接覆盖当前主库。</p>
        </div>
      </div>

      <el-alert
        v-if="backupStatus && !backupStatus.supported"
        type="warning"
        :closable="false"
        :title="backupStatus.reason || '当前数据库暂不支持该备份方式'"
        show-icon
      />

      <el-alert
        v-else-if="backupStatus?.maintenanceActive"
        type="warning"
        :closable="false"
        :title="backupStatus.maintenanceMessage"
        show-icon
      />

      <div v-if="backupStatus" class="status-grid">
        <article class="status-card">
          <div class="label">备份方式</div>
          <div class="value">{{ backupStatus.provider === "sqlite-file" ? "SQLite 文件快照" : "暂不支持" }}</div>
          <div class="hint">当前版本只处理主站主库，不包含独立 Filestore 库。</div>
        </article>
        <article class="status-card">
          <div class="label">数据库位置</div>
          <div class="value path">{{ backupStatus.databasePathLabel || "未识别" }}</div>
          <div class="hint">{{ backupStatus.exists ? "文件存在，可直接备份" : "文件不存在" }}</div>
        </article>
        <article class="status-card">
          <div class="label">当前大小</div>
          <div class="value">{{ formatBytes(backupStatus.sizeBytes) }}</div>
          <div class="hint">修改前先下载一份，最稳。</div>
        </article>
        <article class="status-card">
          <div class="label">最后更新时间</div>
          <div class="value">{{ formatTime(backupStatus.updatedAt) }}</div>
          <div class="hint">可作为你判断最近是否有写入的参考。</div>
        </article>
      </div>

      <div v-if="backupStatus?.supported" class="action-panel">
        <article class="action-card">
          <div class="copy">
            <h4>下载备份</h4>
            <p>后台会先生成一份一致性 SQLite 快照，再把它下载成本地文件。</p>
          </div>
          <el-button type="primary" :loading="downloading" :disabled="backupBlocked" @click="downloadBackup">
            下载当前数据库
          </el-button>
        </article>

        <article class="action-card danger">
          <div class="copy">
            <h4>上传恢复</h4>
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
            <el-button :disabled="restoreBlocked" @click="pickFile">选择备份文件</el-button>
            <el-button type="danger" :disabled="!restoreFile || restoreBlocked" :loading="restoring" @click="restoreBackup">
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
    </div>

    <div class="section">
      <div class="section-head">
        <div>
          <h3>SQLite 迁移到 PostgreSQL</h3>
          <p>这里调用服务器上的迁移脚本，把主站 SQLite 数据复制到 PostgreSQL。它不会自动切换当前线上运行库。</p>
        </div>
      </div>

      <el-alert
        v-if="migrationStatus && !migrationStatus.supported"
        type="warning"
        :closable="false"
        :title="migrationStatus.reason || '当前数据库暂不支持迁移'"
        show-icon
      />

      <el-alert
        v-else-if="migrationStatus?.running"
        type="warning"
        :closable="false"
        title="数据库迁移正在进行中，执行期间其他请求会被临时拦截。请耐心等待本次任务完成。"
        show-icon
      />
      <el-alert
        v-else-if="migrationStatus?.reason"
        type="warning"
        :closable="false"
        :title="migrationStatus.reason"
        show-icon
      />

      <div v-if="migrationStatus" class="status-grid">
        <article class="status-card">
          <div class="label">迁移源</div>
          <div class="value">{{ migrationStatus.sourceProvider === "sqlite-file" ? "SQLite 文件主库" : "暂不支持" }}</div>
          <div class="hint">当前只迁主站主库，不动 Filestore。</div>
        </article>
        <article class="status-card">
          <div class="label">目标 PostgreSQL</div>
          <div class="value path">{{ migrationStatus.targetDisplay || "未配置" }}</div>
          <div class="hint">{{ migrationStatus.targetConfigured ? "服务器已配置 POSTGRES_DATABASE_URL" : "请先在服务器环境变量配置 POSTGRES_DATABASE_URL" }}</div>
        </article>
        <article class="status-card">
          <div class="label">迁移任务状态</div>
          <div class="value">{{ migrationStatus.running ? "运行中" : "空闲" }}</div>
          <div class="hint">{{ migrationStatus.lastRun ? `最近一次：${migrationStatus.lastRun.success ? "成功" : "失败"} · ${formatDuration(migrationStatus.lastRun.durationMs)}` : "还没有执行过迁移" }}</div>
        </article>
        <article class="status-card">
          <div class="label">最近执行时间</div>
          <div class="value">{{ formatTime(migrationStatus.lastRun?.finishedAt || null) }}</div>
          <div class="hint">建议先 dry-run，再做正式迁移。</div>
        </article>
      </div>

      <article v-if="migrationStatus?.supported" class="migration-card">
        <div class="migration-form">
          <label class="field">
            <span>批次大小</span>
            <el-input-number v-model="migrationForm.batchSize" :min="100" :max="10000" :step="100" :disabled="migrationBlocked" />
          </label>
          <label class="field checkbox-row">
            <el-checkbox v-model="migrationForm.clearTarget" :disabled="migrationBlocked">清空目标 PostgreSQL 现有数据后再导入</el-checkbox>
          </label>
        </div>

        <div class="button-row">
          <el-button :loading="dryRunning" :disabled="migrationBlocked" @click="runMigration(true)">
            先做 dry-run
          </el-button>
          <el-button type="danger" :loading="migrating" :disabled="migrationBlocked || !migrationStatus.targetConfigured" @click="runMigration(false)">
            开始正式迁移
          </el-button>
        </div>

        <el-alert
          type="info"
          :closable="false"
          show-icon
          title="正式迁移会临时进入维护态，阻止新请求写入 SQLite，以尽量保证迁移结果一致。迁移完成后仍需你手动切换线上 DATABASE_URL 到 PostgreSQL。"
        />
      </article>

      <article v-if="migrationResult" class="result-card">
        <div class="result-head">
          <div>
            <h4>最近一次迁移结果</h4>
            <p>{{ migrationResult.dryRun ? "dry-run" : "正式迁移" }} · {{ migrationResult.success ? "成功" : "失败" }} · {{ formatDuration(migrationResult.durationMs) }}</p>
          </div>
          <el-tag :type="migrationResult.success ? 'success' : 'danger'">
            {{ migrationResult.success ? "成功" : "失败" }}
          </el-tag>
        </div>
        <div class="result-meta">
          <span>开始：{{ formatTime(migrationResult.startedAt) }}</span>
          <span>结束：{{ formatTime(migrationResult.finishedAt) }}</span>
          <span>批次：{{ migrationResult.batchSize }}</span>
          <span v-if="migrationResult.clearTarget">已清空目标库</span>
        </div>
        <pre class="result-log">{{ migrationResult.output || "(无输出)" }}</pre>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  adminApi,
  type DatabaseBackupStatus,
  type DatabaseMigrationRunRecord,
  type DatabaseMigrationStatus,
} from "@/api/admin";

const loading = ref(false);
const downloading = ref(false);
const restoring = ref(false);
const dryRunning = ref(false);
const migrating = ref(false);
const backupStatus = ref<DatabaseBackupStatus | null>(null);
const migrationStatus = ref<DatabaseMigrationStatus | null>(null);
const migrationResult = ref<DatabaseMigrationRunRecord | null>(null);
const restoreFile = ref<File | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const migrationForm = reactive({
  batchSize: 1000,
  clearTarget: false,
});

onMounted(() => {
  void loadStatus();
});

async function loadStatus() {
  loading.value = true;
  try {
    const [backup, migration] = await Promise.all([
      adminApi.databaseStatus(),
      adminApi.databaseMigrationStatus(),
    ]);
    backupStatus.value = backup;
    migrationStatus.value = migration;
    migrationResult.value = migration.lastRun;
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

function formatDuration(value: number | null | undefined) {
  if (!value && value !== 0) return "未知";
  if (value < 1000) return `${value} ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)} s`;
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1000);
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
  return `cpu-web-db-backup-${yyyy}${mm}${dd}-${hh}${mi}${ss}.sqlite`;
}

const backupBlocked = computed(() =>
  !backupStatus.value?.exists ||
  Boolean(backupStatus.value?.maintenanceActive) ||
  Boolean(migrationStatus.value?.running) ||
  migrating.value ||
  dryRunning.value
);

const restoreBlocked = computed(() =>
  Boolean(backupStatus.value?.maintenanceActive) ||
  Boolean(migrationStatus.value?.running) ||
  migrating.value ||
  dryRunning.value
);

const migrationBlocked = computed(() =>
  Boolean(migrationStatus.value?.running) ||
  Boolean(backupStatus.value?.maintenanceActive) ||
  downloading.value ||
  restoring.value
);

async function downloadBackup() {
  if (!backupStatus.value?.supported || !backupStatus.value.exists) return;
  downloading.value = true;
  try {
    const blob = await adminApi.downloadDatabaseBackup();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = backupStatus.value.downloadFileName || buildFallbackFileName();
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

async function runMigration(dryRun: boolean) {
  if (!dryRun && !migrationStatus.value?.targetConfigured) {
    ElMessage.warning("服务器尚未配置 POSTGRES_DATABASE_URL");
    return;
  }

  if (!dryRun) {
    await ElMessageBox.confirm(
      "确认开始正式迁移？执行期间站点会进入临时维护态，用来减少 SQLite 新写入带来的数据偏差。迁移完成后仍需要你手动切换运行库到 PostgreSQL。",
      "正式迁移数据库",
      {
        type: "warning",
        confirmButtonText: "确认迁移",
        cancelButtonText: "取消",
      }
    );
  }

  if (dryRun) dryRunning.value = true;
  else migrating.value = true;

  try {
    const result = await adminApi.runDatabaseMigration({
      batchSize: migrationForm.batchSize,
      clearTarget: migrationForm.clearTarget,
      dryRun,
    });
    migrationResult.value = result;
    if (result.success) {
      ElMessage.success(dryRun ? "dry-run 已完成" : "数据库迁移已完成");
    } else {
      ElMessage.error(dryRun ? "dry-run 失败，请查看下方输出" : "数据库迁移失败，请查看下方输出");
    }
    await loadStatus();
  } finally {
    if (dryRun) dryRunning.value = false;
    else migrating.value = false;
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
.section-head,
.action-card,
.result-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.hero h2,
.section-head h3,
.action-card h4,
.result-head h4 {
  margin: 0 0 6px;
}

.hero h2 {
  font-size: 20px;
}

.hero p,
.section-head p,
.action-card p,
.result-head p {
  margin: 0;
  color: #5b6472;
  line-height: 1.6;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.status-card,
.action-card,
.migration-card,
.result-card {
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

.action-panel,
.migration-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.action-card {
  align-items: center;
  gap: 20px;
}

.action-card.danger {
  border-color: #f5d0d0;
  background: linear-gradient(180deg, #fffefe 0%, #fff7f7 100%);
}

.migration-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: #334155;
  font-size: 13px;
}

.checkbox-row {
  justify-content: flex-end;
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

.result-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 18px;
  margin-top: 10px;
  font-size: 12px;
  color: #64748b;
}

.result-log {
  margin: 12px 0 0;
  padding: 12px;
  border-radius: 12px;
  background: #0f172a;
  color: #e2e8f0;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 360px;
  overflow: auto;
}

.hidden-input {
  display: none;
}

@media (max-width: 860px) {
  .hero,
  .section-head,
  .action-card,
  .result-head {
    flex-direction: column;
    align-items: stretch;
  }

  .status-grid,
  .migration-form {
    grid-template-columns: 1fr;
  }

  .checkbox-row {
    justify-content: flex-start;
  }

  .button-row {
    justify-content: flex-start;
  }
}
</style>
