<template>
  <div class="fs-d">
    <header class="fs-d-head">
      <div>
        <router-link class="fs-d-back" to="/services/tools/file_collect"><el-icon aria-hidden="true"><ArrowLeft /></el-icon>文件收集</router-link>
        <h1>文件收集工作台</h1>
        <p>创建收集任务、分享提交链接，并在这里核对名单、下载文件。</p>
      </div>
      <el-button type="primary" size="large" :icon="Plus" :disabled="loading || denied" @click="openEditor()">新建收集任务</el-button>
    </header>

    <section v-if="denied" class="fs-d-card fs-d-state">
      <span class="fs-d-state-icon is-warn" aria-hidden="true"><el-icon><Lock /></el-icon></span>
      <b>暂时不能进入工作台</b>
      <p>当前账号没有文件收集管理权限。公开提交链接仍可正常访问。</p>
      <el-button type="primary" @click="router.push('/services/tools')">返回小工具</el-button>
    </section>

    <section v-else-if="loadError" class="fs-d-card fs-d-state">
      <span class="fs-d-state-icon is-warn" aria-hidden="true"><el-icon><WarningFilled /></el-icon></span>
      <b>{{ loadError }}</b>
      <p>请检查网络后重试。</p>
      <el-button type="primary" :loading="loading" @click="load">重试</el-button>
    </section>

    <div v-else class="fs-d-grid">
      <aside class="fs-d-side" aria-label="收集任务">
        <div class="fs-d-side-head">
          <b>收集任务</b>
          <span>{{ tasks.length }}</span>
        </div>
        <el-input v-model="taskQuery" :prefix-icon="Search" clearable placeholder="搜索任务" />
        <div class="fs-d-task-list">
          <el-skeleton v-if="loading && !tasks.length" :rows="4" animated />
          <button
            v-for="task in filteredTasks"
            :key="task.id"
            data-cpu-button="surface"
            type="button"
            class="fs-d-task"
            :class="{ active: detail?.id === task.id }"
            :aria-current="detail?.id === task.id ? 'true' : undefined"
            @click="openTask(task.id, { replace: true })"
          >
            <span class="fs-dot" :class="task.status" aria-hidden="true" />
            <span class="fs-d-task-copy">
              <b>{{ task.title }}</b>
              <small>{{ statusText(task.status) }} · {{ task.deadline ? `截止 ${formatDateOnly(task.deadline)}` : "无截止时间" }}</small>
              <small v-if="viewer?.isSuperAdmin && task.createdBy">{{ formatCreator(task.createdBy) }}</small>
            </span>
          </button>
          <p v-if="!loading && !filteredTasks.length" class="fs-d-task-empty">{{ tasks.length ? "没有匹配的任务，换个关键词试试。" : "还没有收集任务。" }}</p>
        </div>
      </aside>

      <main class="fs-d-main">
        <div v-if="(loading || detailLoading) && !detail" class="fs-d-card fs-d-skeleton"><el-skeleton :rows="7" animated /></div>

        <section v-else-if="!detail" class="fs-d-card fs-d-state">
          <span class="fs-d-state-icon" aria-hidden="true"><el-icon><FolderAdd /></el-icon></span>
          <b>{{ tasks.length ? "选择左侧的任务查看详情" : "创建第一个收集任务" }}</b>
          <p>创建任务后会生成提交链接。提交者无需登录，填写信息并上传文件即可，文件会按规则自动命名。</p>
          <el-button type="primary" :icon="Plus" @click="openEditor()">新建收集任务</el-button>
        </section>

        <template v-else>
          <section class="fs-d-card fs-d-hero" v-loading="detailLoading">
            <div class="fs-d-hero-copy">
              <span class="fs-status" :class="detail.status"><span class="fs-dot" :class="detail.status" aria-hidden="true" />{{ statusText(detail.status) }}</span>
              <h2>{{ detail.title }}</h2>
              <p v-if="detail.description">{{ detail.description }}</p>
              <ul class="fs-d-meta">
                <li><el-icon aria-hidden="true"><Clock /></el-icon>{{ detail.deadline ? `截止 ${formatDateTime(detail.deadline)}` : "未设置截止时间" }}</li>
                <li><el-icon aria-hidden="true"><Document /></el-icon>{{ detail.stats?.submitted || 0 }} 份提交</li>
                <li v-if="viewer?.isSuperAdmin"><el-icon aria-hidden="true"><User /></el-icon>{{ formatCreator(detail.createdBy) }}</li>
              </ul>
            </div>
            <div class="fs-d-hero-actions">
              <el-button :icon="Edit" @click="openEditor(detail)">编辑任务</el-button>
              <el-button :icon="Grid" @click="qrVisible = true">二维码</el-button>
              <el-button :icon="FolderOpened" @click="openFileManager">文件管理</el-button>
              <el-dropdown trigger="click" placement="bottom-end" @command="onMore">
                <el-button :icon="MoreFilled" aria-label="更多操作" />
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item v-if="viewer?.isSuperAdmin" command="owner" :icon="User">绑定创建者</el-dropdown-item>
                    <el-dropdown-item command="repair" :icon="Tools" :disabled="repairing">修复乱码文件名</el-dropdown-item>
                    <el-dropdown-item command="repair-remote" :icon="Tools" :disabled="repairing">修复云端文件名</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </section>

          <TaskMetrics />
          <TaskShareLinks />

          <section class="fs-d-card fs-d-panel">
            <header class="fs-d-panel-head">
              <nav class="fs-tabs" role="tablist" aria-label="任务详情">
                <button
                  v-for="item in tabs"
                  :key="item.key"
                  data-cpu-button="option"
                  type="button"
                  role="tab"
                  :class="{ active: tab === item.key }"
                  :aria-selected="tab === item.key"
                  @click="tab = item.key"
                >
                  {{ item.label }}<em v-if="item.count">{{ item.count }}</em>
                </button>
              </nav>
              <div v-if="tab === 'records'" class="fs-d-panel-tools">
                <el-input v-model="submissionQuery" :prefix-icon="Search" clearable placeholder="搜索姓名、编号或文件名" />
                <el-button :icon="Document" @click="exportCsv">导出 CSV</el-button>
                <el-button :icon="Download" :loading="zipDownloading" :disabled="zipDownloading" @click="downloadZip">下载 ZIP</el-button>
              </div>
            </header>

            <template v-if="tab === 'records'">
              <div v-if="!filteredSubmissions.length" class="fs-d-records-empty">
                <b>{{ detail.submissions?.length ? "没有匹配的提交" : "还没有人提交" }}</b>
                <span>{{ detail.submissions?.length ? "换个关键词再试。" : "把提交链接或二维码发给大家，提交后会显示在这里。" }}</span>
              </div>
              <div v-else class="fs-d-table-wrap">
                <table class="fs-d-table">
                  <thead>
                    <tr>
                      <th>提交人</th>
                      <th v-for="field in identityColumns" :key="field.key">{{ field.label }}</th>
                      <th v-for="field in detail.surveyFields || []" :key="field.id">{{ field.label }}</th>
                      <th>文件</th>
                      <th>提交时间</th>
                      <th><span class="fs-sr">操作</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="submission in filteredSubmissions" :key="submission.id">
                      <td>
                        <div class="fs-d-person">
                          <span class="fs-d-avatar" aria-hidden="true">{{ submissionOwner(detail, submission).slice(0, 1) }}</span>
                          <div>
                            <b>{{ submissionOwner(detail, submission) }}</b>
                            <small>IP {{ submission.ip || "-" }}</small>
                          </div>
                        </div>
                      </td>
                      <td v-for="field in identityColumns" :key="field.key" class="fs-d-mono">{{ submission.data[field.key] || "" }}</td>
                      <td v-for="field in detail.surveyFields || []" :key="field.id">{{ formatSurveyAnswer(submission.answers?.[field.id]) }}</td>
                      <td class="fs-d-files">
                        <div v-for="file in submission.files" :key="file.id" class="fs-d-file">
                          <FileBadge :name="file.storedName" :size="30" />
                          <div class="fs-d-file-copy">
                            <b :title="file.storedName">{{ file.storedName }}</b>
                            <small :title="file.originalName">{{ file.originalName }} · {{ formatBytes(file.size) }}</small>
                          </div>
                          <div class="fs-d-file-actions">
                            <el-tooltip content="查看" placement="top"><el-button text :icon="View" aria-label="查看" @click="previewFile(file)" /></el-tooltip>
                            <el-tooltip content="下载" placement="top"><el-button text :icon="Download" aria-label="下载" @click="downloadFile(file)" /></el-tooltip>
                            <el-tooltip content="删除文件" placement="top"><el-button text type="danger" :icon="Delete" aria-label="删除文件" @click="deleteFile(file)" /></el-tooltip>
                          </div>
                        </div>
                      </td>
                      <td class="fs-d-time">{{ formatDateTime(submission.createdAt) }}</td>
                      <td>
                        <el-tooltip content="删除提交" placement="top">
                          <el-button text type="danger" :icon="CircleClose" aria-label="删除提交" @click="deleteSubmission(submission)" />
                        </el-tooltip>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>
            <TaskChecklist v-else-if="tab === 'check'" />
            <TaskRules v-else />
          </section>
        </template>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  ArrowLeft,
  CircleClose,
  Clock,
  Delete,
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
  View,
  WarningFilled,
} from "@element-plus/icons-vue";
import { formatBytes } from "@/views/services/fileCollectExport";
import FileBadge from "./components/FileBadge.vue";
import TaskChecklist from "./components/TaskChecklist.vue";
import TaskMetrics from "./components/TaskMetrics.vue";
import TaskRules from "./components/TaskRules.vue";
import TaskShareLinks from "./components/TaskShareLinks.vue";
import { formatCreator, formatDateOnly, formatDateTime, formatSurveyAnswer, statusText, submissionOwner } from "./shared";
import { useInjectedFilestoreWorkspace } from "./workspace";

type PanelTab = "records" | "check" | "rules";

const router = useRouter();
const {
  loading,
  denied,
  loadError,
  detailLoading,
  repairing,
  zipDownloading,
  viewer,
  tasks,
  detail,
  taskQuery,
  submissionQuery,
  filteredTasks,
  filteredSubmissions,
  qrVisible,
  load,
  openTask,
  openEditor,
  openFileManager,
  exportCsv,
  downloadZip,
  repairFilenames,
  repairRemoteFilenames,
  previewFile,
  downloadFile,
  deleteFile,
  deleteSubmission,
  bindTaskOwner,
} = useInjectedFilestoreWorkspace();

const tab = ref<PanelTab>("records");
const identityColumns = computed(() => (detail.value?.fields || []).filter((field) => field.key !== "name"));
const tabs = computed(() => [
  { key: "records" as const, label: "提交记录", count: detail.value?.submissions?.length || 0 },
  { key: "check" as const, label: "名单核对", count: detail.value?.stats?.missing?.length || 0 },
  { key: "rules" as const, label: "任务规则", count: 0 },
]);

watch(() => detail.value?.id, () => {
  tab.value = "records";
});

function onMore(command: "owner" | "repair" | "repair-remote") {
  if (command === "owner") void bindTaskOwner();
  else if (command === "repair") void repairFilenames();
  else void repairRemoteFilenames();
}
</script>

<style scoped>
.fs-d { display: flex; min-width: 0; flex-direction: column; gap: 18px; color: var(--cpu-text); }
.fs-d-card { border: 1px solid var(--cpu-border-soft); border-radius: var(--cpu-radius-l); background: var(--cpu-card); box-shadow: var(--cpu-shadow-sm); }
.fs-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

.fs-d-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; }
.fs-d-back { display: inline-flex; min-height: 26px; align-items: center; gap: 3px; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); text-decoration: none; }
.fs-d-back:hover { color: var(--cpu-primary); }
.fs-d-head h1 { margin: 2px 0 0; font-size: 26px; font-weight: 700; letter-spacing: -.01em; }
.fs-d-head p { margin: 4px 0 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-m); }
.fs-d-head .el-button { flex: 0 0 auto; }

.fs-d-state { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 56px 24px; text-align: center; }
.fs-d-state-icon { display: grid; width: 56px; height: 56px; margin-bottom: 6px; place-items: center; border-radius: var(--cpu-radius-l); background: var(--cpu-primary-soft); color: var(--cpu-primary); font-size: 26px; }
.fs-d-state-icon.is-warn { background: var(--cpu-accent-soft); color: var(--cpu-warn); }
.fs-d-state b { font-size: var(--cpu-fs-l); font-weight: 700; }
.fs-d-state p { max-width: 460px; margin: 0 0 8px; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); line-height: 1.7; }

.fs-d-grid { display: grid; grid-template-columns: 272px minmax(0, 1fr); align-items: start; gap: 18px; }
.fs-d-side {
  position: sticky;
  top: 84px;
  display: flex;
  max-height: calc(100vh - 108px);
  flex-direction: column;
  gap: 10px;
  padding: 14px 10px 10px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-card);
  box-shadow: var(--cpu-shadow-sm);
}
.fs-d-side-head { display: flex; align-items: center; justify-content: space-between; padding: 0 4px; }
.fs-d-side-head b { font-size: var(--cpu-fs-m); font-weight: 700; }
.fs-d-side-head span { padding: 0 8px; border-radius: var(--cpu-radius-pill); background: var(--cpu-surface-subtle); color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); line-height: 20px; }
.fs-d-task-list { display: flex; min-height: 0; flex-direction: column; gap: 2px; margin: 0 -2px; padding: 0 2px; overflow-y: auto; }
.fs-d-task {
  display: flex;
  width: 100%;
  align-items: flex-start;
  gap: 10px;
  padding: 10px;
  border: 0;
  border-radius: var(--cpu-radius-m);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.fs-d-task:hover { background: var(--cpu-surface-soft); }
.fs-d-task.active { background: var(--cpu-primary-soft); }
.fs-d-task.active b { color: var(--cpu-primary); }
.fs-d-task .fs-dot { margin-top: 6px; }
.fs-d-task-copy { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
.fs-d-task-copy b { display: -webkit-box; overflow: hidden; font-size: var(--cpu-fs-m); font-weight: 500; line-height: 1.45; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.fs-d-task-copy small { overflow: hidden; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); text-overflow: ellipsis; white-space: nowrap; }
.fs-d-task-empty { margin: 0; padding: 18px 8px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); text-align: center; }

.fs-dot { display: inline-block; width: 8px; height: 8px; flex: 0 0 auto; border-radius: 50%; background: var(--cpu-success); box-shadow: 0 0 0 3px var(--cpu-primary-soft); }
.fs-dot.closed { background: var(--cpu-text-muted); box-shadow: 0 0 0 3px color-mix(in srgb, var(--cpu-text-muted) 18%, transparent); }

.fs-d-main { display: flex; min-width: 0; flex-direction: column; gap: 14px; }
.fs-d-skeleton { padding: 24px; }
.fs-d-hero { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; padding: 18px 20px; }
.fs-d-hero-copy { min-width: 0; }
.fs-status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 2px 10px 2px 8px;
  border-radius: var(--cpu-radius-pill);
  background: var(--cpu-primary-soft);
  color: var(--cpu-primary);
  font-size: var(--cpu-fs-xs);
  font-weight: 500;
  line-height: 22px;
}
.fs-status.closed { background: var(--cpu-surface-subtle); color: var(--cpu-text-secondary); }
.fs-status .fs-dot { width: 6px; height: 6px; box-shadow: none; }
.fs-d-hero h2 { margin: 8px 0 0; font-size: var(--cpu-fs-xl); font-weight: 700; line-height: 1.35; overflow-wrap: anywhere; }
.fs-d-hero-copy > p { margin: 6px 0 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); line-height: 1.7; white-space: pre-line; }
.fs-d-meta { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 10px 0 0; padding: 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); list-style: none; }
.fs-d-meta li { display: inline-flex; align-items: center; gap: 5px; }
.fs-d-meta .el-icon { color: var(--cpu-text-muted); }
.fs-d-hero-actions { display: flex; flex: 0 0 auto; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.fs-d-hero-actions .el-button { margin: 0; }

.fs-d-panel { overflow: hidden; }
.fs-d-panel-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border-bottom: 1px solid var(--cpu-border-soft); }
.fs-tabs { display: flex; gap: 4px; padding: 3px; border-radius: var(--cpu-radius-l); background: var(--cpu-surface-soft); }
.fs-tabs button { --cpu-button-radius: 9px; display: inline-flex; min-height: 34px; align-items: center; gap: 6px; padding: 0 14px; font: inherit; font-size: var(--cpu-fs-s); cursor: pointer; }
.fs-tabs button.active { --cpu-button-fill: var(--cpu-card); font-weight: 500; }
.fs-tabs em { min-width: 18px; padding: 0 5px; border-radius: var(--cpu-radius-pill); background: var(--cpu-surface-subtle); color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); font-style: normal; font-weight: 500; line-height: 18px; text-align: center; }
.fs-tabs button.active em { background: var(--cpu-primary-soft); color: var(--cpu-primary); }
.fs-d-panel-tools { display: flex; align-items: center; gap: 8px; }
.fs-d-panel-tools .el-input { width: 240px; }
.fs-d-panel-tools .el-button { margin: 0; }
.fs-d-panel > .fs-check,
.fs-d-panel > .fs-rules { padding: 16px; }

.fs-d-records-empty { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 48px 16px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); }
.fs-d-records-empty b { color: var(--cpu-text); font-size: var(--cpu-fs-m); }
.fs-d-table-wrap { overflow-x: auto; }
.fs-d-table { width: 100%; border-collapse: collapse; font-size: var(--cpu-fs-s); }
.fs-d-table th {
  padding: 10px 14px;
  border-bottom: 1px solid var(--cpu-border-soft);
  background: var(--cpu-surface-soft);
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-xs);
  font-weight: 500;
  text-align: left;
  white-space: nowrap;
}
.fs-d-table td { padding: 12px 14px; border-bottom: 1px solid var(--cpu-border-soft); vertical-align: top; }
.fs-d-table tbody tr:last-child td { border-bottom: 0; }
.fs-d-table tbody tr:hover td { background: color-mix(in srgb, var(--cpu-surface-soft) 60%, transparent); }
.fs-d-person { display: flex; align-items: center; gap: 9px; white-space: nowrap; }
.fs-d-avatar { display: grid; width: 30px; height: 30px; flex: 0 0 auto; place-items: center; border-radius: 50%; background: var(--cpu-primary-soft); color: var(--cpu-primary); font-size: var(--cpu-fs-s); font-weight: 700; }
.fs-d-person b { display: block; font-weight: 500; }
.fs-d-person small { color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
.fs-d-mono { font-family: var(--cpu-font-mono); font-size: var(--cpu-fs-xs); white-space: nowrap; }
.fs-d-time { color: var(--cpu-text-secondary); white-space: nowrap; }
.fs-d-files { min-width: 300px; }
.fs-d-file { display: flex; align-items: center; gap: 9px; }
.fs-d-file + .fs-d-file { margin-top: 8px; }
.fs-d-file-copy { display: flex; min-width: 0; max-width: 300px; flex: 1; flex-direction: column; }
.fs-d-file-copy b { overflow: hidden; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.fs-d-file-copy small { overflow: hidden; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); text-overflow: ellipsis; white-space: nowrap; }
.fs-d-file-actions { display: flex; flex: 0 0 auto; }
.fs-d-file-actions .el-button,
.fs-d-table td > .el-button { width: 30px; min-width: 30px; min-height: 30px; margin: 0; padding: 0; }

@media (max-width: 1100px) {
  .fs-d-grid { grid-template-columns: 236px minmax(0, 1fr); }
  .fs-d-hero { flex-direction: column; }
  .fs-d-hero-actions { justify-content: flex-start; }
  .fs-d-panel-tools .el-input { width: 200px; }
}
</style>
