<template>
  <div class="fs-m">
    <section v-if="denied" class="fs-m-card fs-m-state">
      <span class="fs-m-tile is-warn" aria-hidden="true"><el-icon><Lock /></el-icon></span>
      <b>暂时不能进入工作台</b>
      <p>当前账号没有文件收集管理权限。公开提交链接仍可正常访问。</p>
      <el-button type="primary" @click="router.push('/services/tools')">返回小工具</el-button>
    </section>

    <section v-else-if="loadError" class="fs-m-card fs-m-state">
      <span class="fs-m-tile is-warn" aria-hidden="true"><el-icon><WarningFilled /></el-icon></span>
      <b>{{ loadError }}</b>
      <p>请检查网络后重试。</p>
      <el-button type="primary" :loading="loading" @click="load">重试</el-button>
    </section>

    <template v-else-if="!selectedTaskId">
      <header class="fs-m-head">
        <router-link class="fs-m-back" to="/services/tools/file_collect"><el-icon aria-hidden="true"><ArrowLeft /></el-icon>文件收集</router-link>
        <div class="fs-m-title">
          <div>
            <h1>收集任务</h1>
            <p>{{ loading ? "正在加载任务…" : `共 ${tasks.length} 个任务` }}</p>
          </div>
          <button data-cpu-button="surface" type="button" class="fs-m-new" :disabled="loading" @click="openEditor()">
            <el-icon aria-hidden="true"><Plus /></el-icon>新建
          </button>
        </div>
      </header>

      <div v-if="tasks.length > 3" class="fs-m-search" role="search">
        <el-icon aria-hidden="true"><Search /></el-icon>
        <input v-model="taskQuery" type="search" enterkeyhint="search" autocomplete="off" aria-label="搜索任务" placeholder="搜索任务" @keydown.enter="($event.target as HTMLInputElement).blur()">
      </div>

      <div v-if="loading && !tasks.length" class="fs-m-card fs-m-pad"><el-skeleton :rows="4" animated /></div>
      <div v-else-if="filteredTasks.length" class="fs-m-card fs-m-list">
        <button
          v-for="task in filteredTasks"
          :key="task.id"
          data-cpu-button="surface"
          type="button"
          class="fs-m-task"
          @click="openTask(task.id)"
        >
          <span class="fs-m-tile" :class="{ 'is-closed': task.status === 'closed' }" aria-hidden="true"><el-icon><FolderOpened /></el-icon></span>
          <span class="fs-m-task-copy">
            <b>{{ task.title }}</b>
            <small>
              <i class="fs-dot" :class="task.status" aria-hidden="true" />{{ statusText(task.status) }} · {{ task.deadline ? `截止 ${formatDateOnly(task.deadline)}` : "无截止时间" }}
            </small>
            <small v-if="viewer?.isSuperAdmin && task.createdBy">{{ formatCreator(task.createdBy) }}</small>
          </span>
          <el-icon class="fs-m-arrow" aria-hidden="true"><ArrowRight /></el-icon>
        </button>
      </div>
      <section v-else class="fs-m-card fs-m-state">
        <span class="fs-m-tile" aria-hidden="true"><el-icon><FolderAdd /></el-icon></span>
        <b>{{ tasks.length ? "没有匹配的任务" : "创建第一个收集任务" }}</b>
        <p>{{ tasks.length ? "换个关键词再试。" : "创建后会生成提交链接，提交者无需登录即可上传文件。" }}</p>
        <el-button v-if="!tasks.length" type="primary" :icon="Plus" @click="openEditor()">新建收集任务</el-button>
      </section>
    </template>

    <template v-else>
      <header class="fs-m-head">
        <button data-cpu-button="surface" type="button" class="fs-m-back" @click="backToList"><el-icon aria-hidden="true"><ArrowLeft /></el-icon>全部任务</button>
        <div v-if="detail" class="fs-m-detail-title">
          <span class="fs-m-status" :class="detail.status"><i class="fs-dot" :class="detail.status" aria-hidden="true" />{{ statusText(detail.status) }}</span>
          <h1>{{ detail.title }}</h1>
          <p>{{ detail.deadline ? `截止 ${formatDateTime(detail.deadline)}` : "未设置截止时间" }}<template v-if="viewer?.isSuperAdmin"> · {{ formatCreator(detail.createdBy) }}</template></p>
        </div>
      </header>

      <div v-if="!detail" class="fs-m-card fs-m-pad"><el-skeleton :rows="6" animated /></div>

      <template v-else>
        <p v-if="detail.description" class="fs-m-desc">{{ detail.description }}</p>

        <nav class="fs-m-card fs-m-actions" aria-label="任务操作">
          <button v-for="action in actions" :key="action.key" data-cpu-button="surface" type="button" @click="action.run()">
            <span class="fs-m-tile" :style="{ '--tone': action.tone }" aria-hidden="true"><el-icon><component :is="action.icon" /></el-icon></span>
            <span>{{ action.label }}</span>
          </button>
        </nav>

        <TaskMetrics />
        <TaskShareLinks compact />

        <nav class="fs-m-tabs" role="tablist" aria-label="任务详情">
          <button
            v-for="item in tabs"
            :key="item.key"
            data-cpu-button="option"
            type="button"
            role="tab"
            :class="{ active: tab === item.key }"
            :aria-selected="tab === item.key"
            @click="tab = item.key"
          >{{ item.label }}<em v-if="item.count">{{ item.count }}</em></button>
        </nav>

        <section v-if="tab === 'records'" class="fs-m-records" aria-label="提交记录">
          <div v-if="detail.submissions?.length" class="fs-m-search" role="search">
            <el-icon aria-hidden="true"><Search /></el-icon>
            <input v-model="submissionQuery" type="search" enterkeyhint="search" autocomplete="off" aria-label="搜索提交记录" placeholder="搜索姓名、编号或文件名" @keydown.enter="($event.target as HTMLInputElement).blur()">
          </div>
          <SubmissionCard v-for="submission in filteredSubmissions" :key="submission.id" :submission="submission" />
          <div v-if="!filteredSubmissions.length" class="fs-m-card fs-m-state is-compact">
            <b>{{ detail.submissions?.length ? "没有匹配的提交" : "还没有人提交" }}</b>
            <p>{{ detail.submissions?.length ? "换个关键词再试。" : "把提交链接或二维码发给大家，提交后会显示在这里。" }}</p>
          </div>
        </section>
        <TaskChecklist v-else-if="tab === 'check'" />
        <div v-else class="fs-m-card fs-m-pad"><TaskRules /></div>
      </template>
    </template>

    <el-drawer v-model="moreOpen" direction="btt" size="auto" title="更多操作" class="fs-m-sheet cpu-sheet-above-native-bar" append-to-body>
      <div class="fs-m-sheet-list">
        <button v-for="item in moreActions" :key="item.key" data-cpu-button="surface" type="button" :disabled="item.disabled" @click="runMore(item.run)">
          <el-icon aria-hidden="true"><component :is="item.icon" /></el-icon>
          <span><b>{{ item.label }}</b><small>{{ item.hint }}</small></span>
        </button>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, type Component } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  ArrowLeft,
  ArrowRight,
  Document,
  Download,
  Edit,
  FolderAdd,
  FolderOpened,
  Grid,
  Lock,
  MoreFilled,
  Plus,
  Search,
  Tools,
  User,
  WarningFilled,
} from "@element-plus/icons-vue";
import SubmissionCard from "./components/SubmissionCard.vue";
import TaskChecklist from "./components/TaskChecklist.vue";
import TaskMetrics from "./components/TaskMetrics.vue";
import TaskRules from "./components/TaskRules.vue";
import TaskShareLinks from "./components/TaskShareLinks.vue";
import { formatCreator, formatDateOnly, formatDateTime, statusText } from "./shared";
import { useInjectedFilestoreWorkspace } from "./workspace";

type PanelTab = "records" | "check" | "rules";

const route = useRoute();
const router = useRouter();
const {
  loading,
  denied,
  loadError,
  repairing,
  zipDownloading,
  viewer,
  tasks,
  detail,
  selectedTaskId,
  taskQuery,
  submissionQuery,
  filteredTasks,
  filteredSubmissions,
  qrVisible,
  load,
  openTask,
  clearTaskQuery,
  openEditor,
  openFileManager,
  exportCsv,
  downloadZip,
  repairFilenames,
  repairRemoteFilenames,
  bindTaskOwner,
} = useInjectedFilestoreWorkspace();

const tab = ref<PanelTab>("records");
const moreOpen = ref(false);
const tabs = computed(() => [
  { key: "records" as const, label: "提交", count: detail.value?.submissions?.length || 0 },
  { key: "check" as const, label: "名单核对", count: detail.value?.stats?.missing?.length || 0 },
  { key: "rules" as const, label: "规则", count: 0 },
]);
const actions: Array<{ key: string; label: string; icon: Component; tone: string; run: () => void }> = [
  { key: "edit", label: "编辑", icon: Edit, tone: "#0f766e", run: () => openEditor(detail.value) },
  { key: "qr", label: "二维码", icon: Grid, tone: "#2563eb", run: () => { qrVisible.value = true; } },
  { key: "files", label: "文件", icon: FolderOpened, tone: "#d97706", run: openFileManager },
  { key: "more", label: "更多", icon: MoreFilled, tone: "#64748b", run: () => { moreOpen.value = true; } },
];
const moreActions = computed(() => [
  { key: "csv", label: "导出 CSV", hint: "提交记录和问卷答案表格", icon: Document, disabled: false, run: exportCsv },
  { key: "zip", label: "下载 ZIP", hint: "在浏览器里打包全部文件，文件多时较慢", icon: Download, disabled: zipDownloading.value, run: downloadZip },
  { key: "repair", label: "修复乱码文件名", hint: "按数据库编码信息修复历史文件名", icon: Tools, disabled: repairing.value, run: repairFilenames },
  { key: "repair-remote", label: "修复云端文件名", hint: "检查世纪互联中的文件路径和文件名", icon: Tools, disabled: repairing.value, run: repairRemoteFilenames },
  ...(viewer.value?.isSuperAdmin ? [{ key: "owner", label: "绑定创建者", hint: "把任务转给其他文件收集管理员", icon: User, disabled: false, run: bindTaskOwner }] : []),
]);

watch(() => detail.value?.id, () => {
  tab.value = "records";
});

// 从列表点进来的详情直接后退；分享出去的详情链接没有上一页，就原地回到任务列表。
function backToList() {
  const back = (window.history.state as { back?: string | null } | null)?.back;
  if (back && back.split("?")[0] === route.path) router.back();
  else clearTaskQuery();
}

function runMore(run: () => unknown) {
  moreOpen.value = false;
  void run();
}
</script>

<style scoped>
.fs-m {
  --fs-m-tile-fill: 11%;
  --fs-m-tile-ink: 100%;
  display: flex;
  min-width: 0;
  max-width: 720px;
  margin: 0 auto;
  flex-direction: column;
  gap: 12px;
  color: var(--cpu-text);
}
.fs-m button,
.fs-m a { -webkit-tap-highlight-color: transparent; }
.fs-m :is(button, a):focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: 2px; }
.fs-m-card { border: 1px solid var(--cpu-border-soft); border-radius: 16px; background: var(--cpu-card); box-shadow: var(--cpu-shadow-sm); }
.fs-m-pad { padding: 14px; }
.fs-m-tile {
  display: grid;
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 12px;
  background: color-mix(in srgb, var(--tone, var(--cpu-primary)) var(--fs-m-tile-fill), var(--cpu-card));
  color: color-mix(in srgb, var(--tone, var(--cpu-primary)) var(--fs-m-tile-ink), var(--cpu-text));
  font-size: 20px;
}
.fs-m-tile.is-warn { --tone: var(--cpu-warn); }
.fs-m-tile.is-closed { --tone: #64748b; }
.fs-dot { display: inline-block; width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: var(--cpu-success); }
.fs-dot.closed { background: var(--cpu-text-muted); }

.fs-m-head { display: flex; flex-direction: column; gap: 2px; padding: 0 2px; }
.fs-m-back {
  display: inline-flex;
  min-height: 30px;
  align-self: flex-start;
  align-items: center;
  gap: 3px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--cpu-text-secondary);
  font: inherit;
  font-size: 12px;
  text-decoration: none;
  cursor: pointer;
}
.fs-m-title { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.fs-m-title h1,
.fs-m-detail-title h1 { margin: 0; font-size: 22px; font-weight: 700; line-height: 1.3; letter-spacing: -.01em; overflow-wrap: anywhere; }
.fs-m-title p,
.fs-m-detail-title p { margin: 3px 0 0; color: var(--cpu-text-muted); font-size: 12px; }
.fs-m-new {
  display: inline-flex;
  min-height: 36px;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background: var(--cpu-button-primary);
  color: var(--cpu-button-on-primary);
  font: inherit;
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
}
.fs-m-new:disabled { opacity: .6; }
.fs-m-detail-title { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
.fs-m-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 9px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--cpu-success) 12%, var(--cpu-card));
  color: color-mix(in srgb, var(--cpu-success) 75%, var(--cpu-text));
  font-size: 11px;
  font-weight: 600;
  line-height: 22px;
}
.fs-m-status.closed { background: var(--cpu-surface-subtle); color: var(--cpu-text-secondary); }
.fs-m-detail-title p { margin-top: 0; }
.fs-m-desc { margin: -4px 2px 0; color: var(--cpu-text-secondary); font-size: 13px; line-height: 1.65; white-space: pre-line; }

.fs-m-search {
  display: flex;
  height: 42px;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 13px;
  background: var(--cpu-card);
  box-shadow: var(--cpu-shadow-sm);
}
.fs-m-search:focus-within { border-color: var(--cpu-primary); }
.fs-m-search > .el-icon { flex: 0 0 auto; color: var(--cpu-text-muted); font-size: 16px; }
.fs-m-search input {
  min-width: 0;
  height: 100%;
  flex: 1;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--cpu-text);
  font: inherit;
  /* 16px 以下 iOS 会在聚焦时放大页面 */
  font-size: 16px;
  appearance: none;
}
.fs-m-search input::placeholder { color: var(--cpu-text-muted); }

.fs-m-list { overflow: hidden; }
.fs-m-task {
  display: flex;
  width: 100%;
  min-height: 64px;
  align-items: center;
  gap: 11px;
  padding: 11px 12px;
  border: 0;
  border-bottom: 1px solid var(--cpu-border-soft);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.fs-m-task:last-child { border-bottom: 0; }
.fs-m-task:active { background: var(--cpu-surface-soft); }
.fs-m-task-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 3px; }
.fs-m-task-copy b { display: -webkit-box; overflow: hidden; font-size: 15px; font-weight: 600; line-height: 1.4; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.fs-m-task-copy small { display: flex; align-items: center; gap: 5px; overflow: hidden; color: var(--cpu-text-muted); font-size: 12px; white-space: nowrap; }
.fs-m-arrow { flex: 0 0 auto; color: var(--cpu-text-muted); font-size: 13px; }

.fs-m-state { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 28px 18px 22px; text-align: center; }
.fs-m-state .fs-m-tile { margin-bottom: 4px; }
.fs-m-state b { font-size: 15px; font-weight: 650; }
.fs-m-state p { margin: 0; color: var(--cpu-text-secondary); font-size: 12px; line-height: 1.65; }
.fs-m-state .el-button { margin-top: 10px; }
.fs-m-state.is-compact { padding: 22px 16px; }

.fs-m-actions { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); padding: 8px 4px; }
.fs-m-actions button {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 6px 2px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: var(--cpu-text);
  font: inherit;
  font-size: 12px;
  font-weight: 550;
  cursor: pointer;
}
.fs-m-actions button:active { transform: scale(.96); }

.fs-m-tabs { display: grid; grid-auto-columns: minmax(0, 1fr); grid-auto-flow: column; gap: 4px; padding: 4px; border: 1px solid var(--cpu-border-soft); border-radius: 14px; background: var(--cpu-card); box-shadow: var(--cpu-shadow-sm); }
.fs-m-tabs button { --cpu-button-radius: 10px; display: inline-flex; min-width: 0; min-height: 38px; align-items: center; justify-content: center; gap: 5px; font: inherit; font-size: 14px; white-space: nowrap; cursor: pointer; }
.fs-m-tabs button.active { font-weight: 650; }
.fs-m-tabs em { min-width: 18px; padding: 0 5px; border-radius: 999px; background: var(--cpu-surface-subtle); color: var(--cpu-text-secondary); font-size: 11px; font-style: normal; font-weight: 600; line-height: 18px; text-align: center; }
.fs-m-tabs button.active em { background: var(--cpu-card); color: var(--cpu-primary); }

.fs-m-records { display: flex; flex-direction: column; gap: 10px; }

.fs-m-sheet-list { display: flex; flex-direction: column; gap: 2px; padding-bottom: 8px; }
.fs-m-sheet-list button {
  display: flex;
  min-height: 56px;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: var(--cpu-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.fs-m-sheet-list button:active { background: var(--cpu-surface-soft); }
.fs-m-sheet-list button:disabled { opacity: .5; }
.fs-m-sheet-list .el-icon { flex: 0 0 auto; color: var(--cpu-primary); font-size: 20px; }
.fs-m-sheet-list span { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
.fs-m-sheet-list b { font-size: 14px; font-weight: 600; }
.fs-m-sheet-list small { color: var(--cpu-text-muted); font-size: 12px; }
:global(.fs-m-sheet.el-drawer) { height: auto !important; max-height: min(92dvh, 640px); border-radius: 18px 18px 0 0; padding-bottom: env(safe-area-inset-bottom); }
:global(.fs-m-sheet .el-drawer__header) { margin-bottom: 0; }
:global(.fs-m-sheet .el-drawer__body) { padding-top: 8px; }

:global(html[data-theme="dark"] .fs-m) {
  --fs-m-tile-fill: 20%;
  --fs-m-tile-ink: 46%;
}
@media (prefers-reduced-motion: reduce) {
  .fs-m-actions button:active { transform: none; }
}
</style>
