<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed } from "vue";
import { useRouter, useRoute } from "vue-router";

const router = useRouter();
const route = useRoute();

const courseName = ref((route.query.courseName as string) || "");
const progress = ref(0);
const status = ref<"running" | "stopped" | "done">("running");
const logs = ref<{ time: string; type: string; message: string }[]>([]);
const currentChapter = ref("");

function pushLog(type: string, message: string) {
  const now = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  logs.value.unshift({ time: now, type, message });
  if (logs.value.length > 100) logs.value.pop();
}

const statusText = computed(() => {
  if (status.value === "done") return "已完成";
  if (status.value === "stopped") return "已停止";
  return "运行中";
});

const statusColor = computed(() => {
  if (status.value === "done") return "#00b42a";
  if (status.value === "stopped") return "#86909c";
  return "#165dff";
});

async function stop() {
  await window.courseBot.stopCourse();
  status.value = "stopped";
}

function backToCourses() {
  router.replace("/courses");
}

async function showWindow() {
  await window.courseBot.showChaoxingWindow();
}

let offProgress: (() => void) | null = null;
onMounted(() => {
  offProgress = window.courseBot.onProgress((e) => {
    pushLog(e.type, e.message);

    if (e.progress !== undefined) progress.value = e.progress;
    if (e.chapter) currentChapter.value = e.chapter;

    if (e.type === "done") status.value = "done";
    if (e.type === "stopped") status.value = "stopped";
    if (e.type === "error" && e.message.includes("已关闭")) status.value = "stopped";
  });

  pushLog("info", "刷课任务已启动");
});

onUnmounted(() => { offProgress?.(); });
</script>

<template>
  <div class="dashboard">
    <header class="header">
      <el-button link @click="backToCourses">&larr; 返回</el-button>
      <el-button link @click="showWindow">查看窗口</el-button>
    </header>

    <section class="status-card">
      <div class="course-title">{{ courseName || "刷课中" }}</div>
      <div class="status-row">
        <span class="status-dot" :style="{ background: statusColor }" />
        <span class="status-label">{{ statusText }}</span>
      </div>
      <div class="chapter-name" v-if="currentChapter">{{ currentChapter }}</div>
      <el-progress
        :percentage="progress"
        :stroke-width="10"
        :color="statusColor"
        class="progress-bar"
      />
    </section>

    <section class="action-row">
      <el-button
        v-if="status === 'running'"
        type="danger"
        class="action-btn"
        @click="stop"
      >
        停止刷课
      </el-button>
      <el-button
        v-else
        type="primary"
        class="action-btn"
        @click="backToCourses"
      >
        选择其他课程
      </el-button>
    </section>

    <section class="log-section">
      <div class="log-header">运行日志</div>
      <div class="log-list">
        <div v-if="logs.length === 0" class="log-empty">暂无日志</div>
        <div
          v-for="(l, i) in logs"
          :key="i"
          class="log-item"
          :class="'log-' + l.type"
        >
          <span class="log-time">{{ l.time }}</span>
          <span class="log-msg">{{ l.message }}</span>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.dashboard {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 16px;
  gap: 14px;
  background: #f7f8fa;
  overflow-y: auto;
}
.header { display: flex; justify-content: space-between; }
.status-card {
  background: #fff;
  border-radius: 12px;
  padding: 20px;
}
.course-title {
  font-size: 17px;
  font-weight: 600;
  color: #1d2129;
  margin-bottom: 8px;
}
.status-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.status-label { font-size: 13px; color: #4e5969; }
.chapter-name {
  font-size: 12px;
  color: #86909c;
  margin-bottom: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.progress-bar { margin-top: 4px; }
.action-row { display: flex; gap: 12px; }
.action-btn { flex: 1; }
.log-section {
  flex: 1;
  background: #fff;
  border-radius: 12px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  min-height: 180px;
}
.log-header { font-size: 13px; font-weight: 500; color: #4e5969; margin-bottom: 8px; }
.log-list { flex: 1; overflow-y: auto; font-size: 12px; }
.log-empty { color: #c9cdd4; text-align: center; padding: 20px; }
.log-item { padding: 4px 0; display: flex; gap: 8px; border-bottom: 1px solid #f7f8fa; }
.log-time { color: #c9cdd4; flex-shrink: 0; }
.log-msg { color: #4e5969; word-break: break-all; }
.log-error .log-msg { color: #f53f3f; }
.log-start .log-msg, .log-done .log-msg { color: #00b42a; }
.log-chapter .log-msg { color: #165dff; }
</style>
