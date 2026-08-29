<template>
  <div class="deployment-pane">
    <section class="deploy-hero">
      <div class="deploy-copy">
        <div class="eyebrow">主站运维</div>
        <h2>更新并部署</h2>
        <p>
          从 GitHub 拉取最新代码，按变更范围完成依赖、数据库、构建和 PM2 重载。
          页面会保留部署日志，服务重启后也能继续查看结果。
        </p>
      </div>
      <div class="deploy-action">
        <el-tag :type="phaseTagType" effect="light" round>{{ phaseLabel }}</el-tag>
        <el-button
          type="primary"
          size="large"
          :loading="starting"
          :disabled="!status?.available || status.phase === 'running' || initialLoading"
          @click="startDeployment"
        >
          <el-icon><Promotion /></el-icon>
          {{ status?.phase === "running" ? "部署进行中" : "更新并部署" }}
        </el-button>
      </div>
    </section>

    <el-alert
      v-if="status && !status.available"
      type="warning"
      :closable="false"
      show-icon
      :title="status.unavailableReason || '当前环境不能从后台部署'"
    />
    <el-alert
      v-else-if="status?.phase === 'running'"
      type="info"
      :closable="false"
      show-icon
      title="部署任务正在独立运行"
      description="PM2 重载期间接口可能短暂断开，页面会自动重连；请勿重复提交。"
    />
    <el-alert
      v-else-if="connectionInterrupted"
      type="warning"
      :closable="false"
      show-icon
      title="暂时无法读取部署状态，正在自动重连"
    />

    <div class="status-grid" v-loading="initialLoading">
      <div class="status-card">
        <span>任务状态</span>
        <strong :class="`phase-${status?.phase || 'idle'}`">{{ phaseLabel }}</strong>
        <small>{{ status?.message || "正在读取部署状态" }}</small>
      </div>
      <div class="status-card">
        <span>最近成功部署</span>
        <strong class="commit">{{ shortCommit(status?.successfulDeployCommit) }}</strong>
        <small>{{ status?.branch ? `分支 ${status.branch}` : "尚无部署基线" }}</small>
      </div>
      <div class="status-card">
        <span>当前代码目录</span>
        <strong class="commit">{{ shortCommit(status?.currentCommit) }}</strong>
        <small>部署执行期间可能先于服务重载更新</small>
      </div>
      <div class="status-card">
        <span>最近执行</span>
        <strong>{{ formatDate(status?.finishedAt || status?.startedAt) }}</strong>
        <small>{{ status?.operatorId ? `管理员 #${status.operatorId}` : "尚未从后台执行" }}</small>
      </div>
    </div>

    <section class="log-panel">
      <div class="log-head">
        <div>
          <h3>部署日志</h3>
          <p>仅展示最近一次任务的末尾日志，凭据类字段会在服务端脱敏。</p>
        </div>
        <el-button :loading="refreshing" @click="refreshNow">
          <el-icon><Refresh /></el-icon>
          刷新
        </el-button>
      </div>
      <pre ref="logElement" class="deploy-log" aria-live="polite">{{ logText }}</pre>
    </section>

    <div class="safety-note">
      <el-icon><Lock /></el-icon>
      <span>后台只允许站点超级管理员执行固定命令 <code>bash deploy.sh update</code>，不接受自定义命令或参数。</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Lock, Promotion, Refresh } from "@element-plus/icons-vue";
import { adminApi, type AdminDeploymentStatus } from "@/api/admin";

const status = ref<AdminDeploymentStatus | null>(null);
const initialLoading = ref(true);
const refreshing = ref(false);
const starting = ref(false);
const connectionInterrupted = ref(false);
const logElement = ref<HTMLElement | null>(null);
let disposed = false;
let pollTimer = 0;

const phaseLabel = computed(() => {
  if (!status.value) return "读取中";
  return {
    idle: "尚未执行",
    running: "部署中",
    success: "部署成功",
    failed: "部署失败",
  }[status.value.phase];
});

const phaseTagType = computed<"info" | "primary" | "success" | "danger">(() => ({
  idle: "info",
  running: "primary",
  success: "success",
  failed: "danger",
}[status.value?.phase || "idle"] as "info" | "primary" | "success" | "danger"));

const logText = computed(() => status.value?.logs.length
  ? status.value.logs.join("\n")
  : "尚无部署日志。首次使用前，需要先通过原有方式部署包含此功能的版本。\n");

function shortCommit(value?: string | null) {
  return value ? value.slice(0, 12) : "—";
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(parsed);
}

function requestMessage(error: unknown) {
  if (!error || typeof error !== "object") return "";
  const responseMessage = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message;
  if (typeof responseMessage === "string") return responseMessage;
  return error instanceof Error ? error.message : "";
}

async function scrollLogToBottom() {
  await nextTick();
  if (logElement.value) logElement.value.scrollTop = logElement.value.scrollHeight;
}

async function loadStatus(options: { silent?: boolean } = {}) {
  const previousPhase = status.value?.phase;
  if (!options.silent) refreshing.value = true;
  try {
    const next = await adminApi.deploymentStatus({ suppressErrorMessage: true });
    status.value = next;
    connectionInterrupted.value = false;
    await scrollLogToBottom();
    if (previousPhase === "running" && next.phase === "success") {
      ElMessage.success("更新部署已完成");
    } else if (previousPhase === "running" && next.phase === "failed") {
      ElMessage.error("更新部署失败，请查看日志");
    }
  } catch {
    connectionInterrupted.value = true;
  } finally {
    initialLoading.value = false;
    refreshing.value = false;
  }
}

function schedulePoll(delay?: number) {
  window.clearTimeout(pollTimer);
  if (disposed) return;
  pollTimer = window.setTimeout(async () => {
    await loadStatus({ silent: true });
    schedulePoll(status.value?.phase === "running" || connectionInterrupted.value ? 1_800 : 8_000);
  }, delay ?? 0);
}

async function refreshNow() {
  await loadStatus();
  schedulePoll(status.value?.phase === "running" ? 1_800 : 8_000);
}

async function startDeployment() {
  const confirmed = await ElMessageBox.confirm(
    "将立即拉取 origin/main，并按变更执行数据库迁移、构建和 PM2 重载。部署期间站点可能短暂断开，确认继续？",
    "更新并部署主站",
    {
      type: "warning",
      confirmButtonText: "确认更新部署",
      cancelButtonText: "取消",
      distinguishCancelAndClose: true,
    },
  ).then(() => true).catch(() => false);
  if (!confirmed) return;

  starting.value = true;
  try {
    status.value = await adminApi.startDeploymentUpdate();
    connectionInterrupted.value = false;
    ElMessage.success("部署任务已启动");
    schedulePoll(1_000);
  } catch (error) {
    ElMessage.error(requestMessage(error) || "部署任务启动失败");
    await loadStatus({ silent: true });
  } finally {
    starting.value = false;
  }
}

onMounted(async () => {
  await loadStatus({ silent: true });
  schedulePoll(status.value?.phase === "running" ? 1_800 : 8_000);
});

onBeforeUnmount(() => {
  disposed = true;
  window.clearTimeout(pollTimer);
});
</script>

<style scoped>
.deployment-pane {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 4px 0 8px;
}

.deploy-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 28px;
  padding: 24px;
  border: 1px solid color-mix(in srgb, var(--cpu-primary) 20%, var(--cpu-border-soft));
  border-radius: 16px;
  background:
    radial-gradient(circle at 92% 10%, color-mix(in srgb, var(--cpu-primary) 18%, transparent), transparent 30%),
    linear-gradient(135deg, color-mix(in srgb, var(--cpu-primary) 8%, var(--cpu-card)), var(--cpu-card));
}

.deploy-copy { max-width: 720px; }
.eyebrow {
  margin-bottom: 5px;
  color: var(--cpu-primary);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
}
.deploy-copy h2 { margin: 0; font-size: 24px; }
.deploy-copy p {
  margin: 10px 0 0;
  color: var(--cpu-text-secondary);
  font-size: 14px;
  line-height: 1.7;
}
.deploy-action {
  display: flex;
  flex: none;
  align-items: center;
  gap: 12px;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  min-height: 112px;
}
.status-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  background: var(--cpu-card);
}
.status-card span,
.status-card small { color: var(--cpu-text-secondary); }
.status-card span { font-size: 12px; }
.status-card strong {
  overflow: hidden;
  font-size: 17px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.status-card small { font-size: 11px; line-height: 1.5; }
.commit { font-family: var(--cpu-font-mono); }
.phase-running { color: #2563eb; }
.phase-success { color: #059669; }
.phase-failed { color: #dc2626; }

.log-panel {
  overflow: hidden;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 14px;
  background: var(--cpu-card);
}
.log-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 15px 17px;
  border-bottom: 1px solid var(--cpu-border-soft);
}
.log-head h3 { margin: 0; font-size: 16px; }
.log-head p {
  margin: 4px 0 0;
  color: var(--cpu-text-secondary);
  font-size: 12px;
}
.deploy-log {
  min-height: 260px;
  max-height: 460px;
  margin: 0;
  overflow: auto;
  padding: 18px;
  background: #0b1220;
  color: #d6e4ff;
  font: 12px/1.65 var(--cpu-font-mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.safety-note {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--cpu-text-secondary);
  font-size: 12px;
}
.safety-note code {
  padding: 2px 5px;
  border-radius: 5px;
  background: var(--cpu-surface-subtle);
  color: var(--cpu-text);
}

@media (max-width: 980px) {
  .status-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 640px) {
  .deploy-hero { align-items: stretch; flex-direction: column; padding: 18px; }
  .deploy-action { justify-content: space-between; }
  .deploy-action .el-button { flex: 1; }
  .status-grid { grid-template-columns: 1fr; }
  .log-head { align-items: flex-start; }
  .deploy-log { min-height: 220px; padding: 14px; }
}
</style>
