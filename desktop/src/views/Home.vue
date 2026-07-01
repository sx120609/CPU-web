<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";

const router = useRouter();
const quota = ref({ aiBalance: 0, totalConsumed: 0, totalGranted: 0, videoFree: true });
const playing = ref(false);
const logs = ref<{ time: string; type: string; message: string }[]>([]);
const chaoxingOpened = ref(false);

function pushLog(type: string, message: string) {
  const now = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  logs.value.unshift({ time: now, type, message });
  if (logs.value.length > 50) logs.value.pop();
}

async function refreshQuota() {
  try {
    quota.value = await window.courseBot.getQuota();
  } catch (e) {
    // token 可能失效
    ElMessage.error("登录态失效，请重新登录");
    router.replace("/login");
  }
}

async function openChaoxing() {
  await window.courseBot.openChaoxing();
  chaoxingOpened.value = true;
  pushLog("info", "已打开学习通窗口，请在其中登录学习通并进入课程视频页");
}

async function startPlay() {
  if (!chaoxingOpened.value) {
    ElMessage.warning("请先打开学习通窗口");
    return;
  }
  const r = await window.courseBot.startAutoPlay();
  if (r.ok) {
    playing.value = true;
    pushLog("start", r.message);
  } else {
    ElMessage.warning(r.message);
  }
}

async function stopPlay() {
  await window.courseBot.stopAutoPlay();
  playing.value = false;
  pushLog("stopped", "已停止");
}

async function logout() {
  await ElMessageBox.confirm("确定退出登录？", "提示", { type: "warning" });
  await window.courseBot.clearToken();
  router.replace("/login");
}

let offProgress: (() => void) | null = null;
onMounted(async () => {
  offProgress = window.courseBot.onProgress((e) => {
    pushLog(e.type, e.message);
    if (e.type === "error" || e.type === "stopped") playing.value = false;
  });
  await refreshQuota();
});
onUnmounted(() => { offProgress?.(); });
</script>

<template>
  <div class="home-page">
    <header class="header">
      <div>
        <h2 class="app-name">药大刷课助手</h2>
        <span class="badge badge-free">视频刷课免费</span>
      </div>
      <el-button link type="danger" @click="logout">退出登录</el-button>
    </header>

    <section class="quota-card">
      <div class="quota-row">
        <div class="quota-item">
          <div class="quota-num">{{ quota.aiBalance }}</div>
          <div class="quota-label">AI 答题额度</div>
        </div>
        <div class="quota-item">
          <div class="quota-num">{{ quota.totalConsumed }}</div>
          <div class="quota-label">累计使用</div>
        </div>
      </div>
      <el-button link @click="refreshQuota">刷新</el-button>
    </section>

    <section class="actions">
      <el-button type="primary" size="large" class="action-btn" @click="openChaoxing">
        打开学习通
      </el-button>
      <el-button
        :type="playing ? 'danger' : 'success'"
        size="large"
        class="action-btn"
        :disabled="!chaoxingOpened"
        @click="playing ? stopPlay() : startPlay()"
      >
        {{ playing ? '停止刷课' : '开始刷课' }}
      </el-button>
    </section>

    <section class="tips" v-if="!chaoxingOpened">
      <el-alert type="info" :closable="false" show-icon>
        <template #title>使用步骤</template>
        1. 点击「打开学习通」在新窗口登录学习通<br/>
        2. 进入要刷的课程视频页<br/>
        3. 回到本窗口点击「开始刷课」
      </el-alert>
    </section>

    <section class="log-section">
      <div class="log-header">运行日志</div>
      <div class="log-list">
        <div v-if="logs.length === 0" class="log-empty">暂无日志</div>
        <div v-for="(l, i) in logs" :key="i" class="log-item" :class="'log-' + l.type">
          <span class="log-time">{{ l.time }}</span>
          <span class="log-msg">{{ l.message }}</span>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.home-page { height: 100%; display: flex; flex-direction: column; padding: 16px; gap: 14px; background: #f7f8fa; overflow-y: auto; }
.header { display: flex; justify-content: space-between; align-items: center; }
.app-name { font-size: 18px; font-weight: 600; color: #1d2129; }
.badge { font-size: 11px; padding: 2px 8px; border-radius: 10px; margin-left: 8px; }
.badge-free { background: #e8ffea; color: #00b42a; }
.quota-card { background: #fff; border-radius: 12px; padding: 16px; display: flex; justify-content: space-between; align-items: center; }
.quota-row { display: flex; gap: 32px; }
.quota-item { text-align: center; }
.quota-num { font-size: 28px; font-weight: 600; color: #165dff; }
.quota-label { font-size: 12px; color: #86909c; margin-top: 2px; }
.actions { display: flex; gap: 12px; }
.action-btn { flex: 1; }
.tips { }
.log-section { flex: 1; background: #fff; border-radius: 12px; padding: 12px; display: flex; flex-direction: column; min-height: 180px; }
.log-header { font-size: 13px; font-weight: 500; color: #4e5969; margin-bottom: 8px; }
.log-list { flex: 1; overflow-y: auto; font-size: 12px; }
.log-empty { color: #c9cdd4; text-align: center; padding: 20px; }
.log-item { padding: 4px 0; display: flex; gap: 8px; border-bottom: 1px solid #f7f8fa; }
.log-time { color: #c9cdd4; flex-shrink: 0; }
.log-msg { color: #4e5969; }
.log-error .log-msg { color: #f53f3f; }
.log-start .log-msg { color: #00b42a; }
</style>
