<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed } from "vue";
import { useRouter, useRoute } from "vue-router";
import { ElMessage } from "element-plus";

const router = useRouter();
const route = useRoute();
const courseName = ref(String(route.query.courseName || "刷课中"));
const progress = ref(0);
const currentChapter = ref("");
const totalChapters = ref(0);
const currentIdx = ref(0);
const status = ref<"waiting" | "running" | "done" | "error" | "stopped">("waiting");
const logs = ref<{ time: string; text: string; type: string }[]>([]);
const showWindow = ref(true);

let removeListener: (() => void) | null = null;

function formatTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function addLog(text: string, type: string = "info") {
  logs.value.unshift({ time: formatTime(), text, type });
  if (logs.value.length > 200) logs.value.length = 200;
}

onMounted(() => {
  removeListener = window.courseBot.onProgress((e) => {
    if (e.progress !== undefined) progress.value = e.progress;
    if (e.chapter) currentChapter.value = e.chapter;
    if ((e as any).total) totalChapters.value = (e as any).total;
    if ((e as any).current) currentIdx.value = (e as any).current;

    switch (e.type) {
      case "start":
        status.value = "running";
        addLog(e.message, "info");
        break;
      case "chapter":
        addLog(e.message, "chapter");
        break;
      case "task":
        addLog(e.message, "task");
        break;
      case "tick":
        break;
      case "done":
        status.value = "done";
        addLog(e.message, "success");
        break;
      case "error":
        status.value = "error";
        addLog(e.message, "error");
        break;
      case "stopped":
        status.value = "stopped";
        addLog(e.message, "warn");
        break;
    }
  });
});

onUnmounted(() => {
  removeListener?.();
});

async function beginEngine() {
  const r = await window.courseBot.startCourse();
  if (!r.ok) {
    ElMessage.warning(r.message);
  }
}

async function stop() {
  await window.courseBot.stopCourse();
}

function toggleWindow() {
  showWindow.value = !showWindow.value;
  if (showWindow.value) window.courseBot.showChaoxingWindow();
}

function goBack() {
  router.replace("/courses");
}

const statusText = computed(() => {
  switch (status.value) {
    case "waiting": return "等待开始";
    case "running": return "刷课中";
    case "done": return "已完成";
    case "error": return "出错了";
    case "stopped": return "已停止";
  }
});

const statusColor = computed(() => {
  switch (status.value) {
    case "waiting": return "#3b82f6";
    case "running": return "#148f7b";
    case "done": return "#10b981";
    case "error": return "#ef4444";
    case "stopped": return "#f59e0b";
  }
});
</script>

<template>
  <div class="page">
    <header class="topbar">
      <div class="topbar-brand">
        <div class="mini-logo">药</div>
        <span>{{ courseName }}</span>
      </div>
      <button class="link-btn" @click="toggleWindow">
        {{ showWindow ? '隐藏窗口' : '查看窗口' }}
      </button>
    </header>

    <!-- 等待开始 -->
    <div v-if="status === 'waiting'" class="waiting-section">
      <div class="waiting-card">
        <div class="waiting-icon">📖</div>
        <h3>请在学习通窗口中操作</h3>
        <p class="waiting-hint">
          在弹出的学习通窗口中打开要刷的课程，<br/>
          确认页面<b>左侧能看到章节列表</b>后，<br/>
          点击下方「开始刷课」按钮。
        </p>
      </div>
      <div class="waiting-actions">
        <button class="action-btn action-btn-start" @click="beginEngine">
          开始刷课
        </button>
        <button class="action-btn action-btn-secondary" @click="goBack">
          返回课程列表
        </button>
      </div>
    </div>

    <!-- 运行中 / 完成 / 错误 / 停止 -->
    <template v-else>
      <div class="status-card">
        <div class="status-header">
          <div class="status-dot" :style="{ background: statusColor }">
            <div v-if="status === 'running'" class="dot-pulse"></div>
          </div>
          <span class="status-label" :style="{ color: statusColor }">{{ statusText }}</span>
          <span class="status-progress" v-if="totalChapters > 0">
            {{ currentIdx }} / {{ totalChapters }}
          </span>
        </div>

        <div class="progress-bar-wrap">
          <div class="progress-bar" :style="{ width: progress + '%' }"></div>
        </div>
        <div class="progress-text">
          <span>{{ progress }}%</span>
          <span v-if="currentChapter" class="current-chapter">{{ currentChapter }}</span>
        </div>
      </div>

      <div class="log-section">
        <div class="log-header">运行日志</div>
        <div class="log-list">
          <div v-if="logs.length === 0" class="log-empty">等待任务开始...</div>
          <div v-for="(log, i) in logs" :key="i" class="log-item" :class="'log-' + log.type">
            <span class="log-time">{{ log.time }}</span>
            <span class="log-text">{{ log.text }}</span>
          </div>
        </div>
      </div>

      <div class="actions">
        <button v-if="status === 'running'" class="action-btn action-btn-stop" @click="stop">
          停止刷课
        </button>
        <button v-else class="action-btn action-btn-back" @click="goBack">
          返回课程列表
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.page { height: 100%; display: flex; flex-direction: column; background: #f5f7f9; }

.topbar {
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 18px; background: #fff;
  box-shadow: 0 1px 0 rgba(0,0,0,0.05); flex-shrink: 0;
}
.topbar-brand {
  display: flex; align-items: center; gap: 10px;
  font-size: 15px; font-weight: 600; color: #1e293b; min-width: 0;
}
.topbar-brand span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mini-logo {
  width: 28px; height: 28px; border-radius: 8px;
  background: linear-gradient(135deg, #168776, #0f6557);
  color: #e8a317; display: grid; place-items: center;
  font-family: serif; font-size: 15px; font-weight: 700; flex-shrink: 0;
}
.link-btn {
  border: none; background: none; font: inherit;
  font-size: 13px; color: #148f7b; cursor: pointer;
  padding: 4px 10px; border-radius: 6px; white-space: nowrap; flex-shrink: 0;
}
.link-btn:hover { background: rgba(20,143,123,0.08); }

/* 等待开始 */
.waiting-section {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center; padding: 24px 20px; gap: 28px;
}
.waiting-card {
  text-align: center; padding: 32px 24px;
  background: #fff; border-radius: 16px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.04);
  width: 100%;
}
.waiting-icon { font-size: 48px; margin-bottom: 12px; }
.waiting-card h3 { font-size: 17px; font-weight: 600; color: #1e293b; margin: 0 0 12px; }
.waiting-hint { font-size: 13px; color: #64748b; line-height: 2; margin: 0; }
.waiting-hint b { color: #148f7b; }
.waiting-actions { width: 100%; display: flex; flex-direction: column; gap: 10px; }

.action-btn {
  width: 100%; height: 46px; border: none; border-radius: 12px;
  font: inherit; font-size: 15px; font-weight: 600;
  cursor: pointer; transition: opacity 0.15s;
}
.action-btn:hover { opacity: 0.9; }
.action-btn-start {
  background: linear-gradient(135deg, #148f7b, #0d6e5e); color: #fff;
  box-shadow: 0 4px 14px rgba(20,143,123,0.3);
}
.action-btn-secondary { background: #f1f5f9; color: #64748b; }
.action-btn-stop { background: #fee2e2; color: #dc2626; }
.action-btn-back { background: linear-gradient(135deg, #148f7b, #0d6e5e); color: #fff; }

/* 运行状态 */
.status-card {
  margin: 12px 14px 0; padding: 18px 18px 14px;
  background: #fff; border-radius: 14px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.04);
}
.status-header { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
.status-dot { width: 10px; height: 10px; border-radius: 50%; position: relative; }
.dot-pulse {
  position: absolute; inset: -3px; border-radius: 50%;
  background: inherit; opacity: 0.3;
  animation: pulse-ring 1.5s ease-in-out infinite;
}
@keyframes pulse-ring {
  0% { transform: scale(1); opacity: 0.3; }
  50% { transform: scale(1.8); opacity: 0; }
  100% { transform: scale(1); opacity: 0.3; }
}
.status-label { font-size: 15px; font-weight: 600; }
.status-progress { margin-left: auto; font-size: 13px; color: #94a3b8; }

.progress-bar-wrap { height: 6px; background: #f1f5f9; border-radius: 3px; overflow: hidden; }
.progress-bar {
  height: 100%; background: linear-gradient(90deg, #148f7b, #34b39e);
  border-radius: 3px; transition: width 0.5s ease; min-width: 2px;
}
.progress-text {
  display: flex; justify-content: space-between;
  margin-top: 8px; font-size: 12px; color: #94a3b8;
}
.current-chapter {
  max-width: 200px; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
}

.log-section {
  flex: 1; margin: 10px 14px 0; background: #fff;
  border-radius: 14px; display: flex; flex-direction: column;
  overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.04);
}
.log-header {
  padding: 12px 16px; font-size: 13px; font-weight: 600;
  color: #64748b; border-bottom: 1px solid #f1f5f9; flex-shrink: 0;
}
.log-list { flex: 1; overflow-y: auto; padding: 8px 0; }
.log-empty { padding: 20px; text-align: center; color: #cbd5e1; font-size: 13px; }
.log-item { padding: 5px 16px; font-size: 12px; display: flex; gap: 8px; line-height: 1.5; }
.log-time { color: #cbd5e1; font-variant-numeric: tabular-nums; flex-shrink: 0; }
.log-text { color: #475569; word-break: break-all; }
.log-chapter .log-text { color: #148f7b; font-weight: 500; }
.log-success .log-text { color: #10b981; font-weight: 600; }
.log-error .log-text { color: #ef4444; }
.log-warn .log-text { color: #f59e0b; }

.actions { padding: 12px 14px; flex-shrink: 0; }
</style>
