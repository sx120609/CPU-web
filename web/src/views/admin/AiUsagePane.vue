<template>
  <div class="ai-usage-pane">
    <div class="usage-head">
      <div>
        <h2>统一 AI 使用日志</h2>
        <p>集中查看拾间 AI、学习通解题与内容审核调用，可按使用场景、状态、用户和时间筛选。</p>
      </div>
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>

    <div class="summary-grid">
      <div class="summary-card"><strong>{{ total }}</strong><span>筛选结果</span></div>
      <div class="summary-card"><strong>{{ summary.success }}</strong><span>成功</span></div>
      <div class="summary-card"><strong>{{ summary.error }}</strong><span>失败</span></div>
      <div class="summary-card"><strong>{{ formatDuration(summary.averageDurationMs) }}</strong><span>平均耗时</span></div>
      <div class="summary-card"><strong>{{ summary.pointCost }}</strong><span>消耗 AI 点数</span></div>
    </div>

    <div class="filter-bar">
      <el-select v-model="filters.kind" clearable placeholder="全部场景" @change="resetAndLoad">
        <el-option v-for="item in sceneOptions" :key="item.value" :label="item.label" :value="item.value" />
      </el-select>
      <el-select v-model="filters.status" clearable placeholder="全部状态" @change="resetAndLoad">
        <el-option label="成功" value="success" />
        <el-option label="失败" value="error" />
        <el-option label="进行中" value="started" />
      </el-select>
      <el-date-picker
        v-model="dateRange"
        type="datetimerange"
        value-format="YYYY-MM-DDTHH:mm:ss.SSSZ"
        start-placeholder="开始时间"
        end-placeholder="结束时间"
        @change="resetAndLoad"
      />
      <el-input v-model="filters.q" clearable placeholder="用户、模型、题目或摘要" @keyup.enter="resetAndLoad" @clear="resetAndLoad" />
      <el-button type="primary" @click="resetAndLoad">查询</el-button>
    </div>

    <el-alert v-if="errorMessage" type="error" :closable="false" show-icon :title="errorMessage" />

    <div class="table-wrap">
      <el-table :data="rows" v-loading="loading" row-key="id" empty-text="暂无符合条件的 AI 调用">
        <el-table-column type="expand">
          <template #default="{ row }">
            <div class="detail-grid">
              <div><span>请求摘要</span><pre>{{ row.requestSummary || "—" }}</pre></div>
              <div><span>返回摘要</span><pre>{{ row.responseSummary || "—" }}</pre></div>
              <div v-if="row.errorMessage" class="detail-error"><span>错误</span><pre>{{ row.errorMessage }}</pre></div>
              <div><span>接口</span><pre>{{ row.endpoint || "—" }}</pre></div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{ fmtDate(row.startedAt, "YYYY-MM-DD HH:mm:ss") }}</template>
        </el-table-column>
        <el-table-column label="场景" min-width="130">
          <template #default="{ row }"><el-tag effect="plain">{{ sceneLabel(row.kind) }}</el-tag></template>
        </el-table-column>
        <el-table-column label="用户" min-width="130">
          <template #default="{ row }">{{ row.createdBy?.nickname || row.createdBy?.username || "免登录 / 系统" }}</template>
        </el-table-column>
        <el-table-column label="状态" width="95">
          <template #default="{ row }">
            <el-tag :type="row.status === 'success' ? 'success' : row.status === 'error' ? 'danger' : 'warning'">
              {{ statusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="model" label="模型" min-width="145" show-overflow-tooltip />
        <el-table-column prop="targetLabel" label="目标" min-width="180" show-overflow-tooltip />
        <el-table-column label="耗时" width="100">
          <template #default="{ row }">{{ formatDuration(row.durationMs) }}</template>
        </el-table-column>
        <el-table-column label="点数" width="75">
          <template #default="{ row }">{{ row.pointCost || 0 }}</template>
        </el-table-column>
      </el-table>
    </div>

    <el-pagination
      v-model:current-page="filters.page"
      v-model:page-size="filters.size"
      class="pagination"
      layout="total, sizes, prev, pager, next"
      :total="total"
      :page-sizes="[20, 30, 50, 100]"
      @current-change="load"
      @size-change="resetAndLoad"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { adminApi, type AiReviewLogRow } from "@/api/admin";
import { fmtDate } from "@/utils/format";

const sceneOptions = [
  { label: "拾间 AI 对话", value: "campus-assistant" },
  { label: "学习通 AI 解题", value: "learning-answer" },
  { label: "帖子审核", value: "topic" },
  { label: "回复审核", value: "reply" },
  { label: "编辑相似度", value: "topic-edit" },
  { label: "图片审核", value: "image" },
  { label: "视频审核", value: "video" },
  { label: "QQ群广告过滤", value: "qqbot-group-ad" },
];
const filters = reactive({ kind: "", status: "", q: "", page: 1, size: 30 });
const dateRange = ref<string[]>([]);
const rows = ref<AiReviewLogRow[]>([]);
const total = ref(0);
const loading = ref(false);
const errorMessage = ref("");
const summary = reactive({ success: 0, error: 0, started: 0, averageDurationMs: 0, pointCost: 0 });
let requestSeq = 0;

function sceneLabel(kind: string) {
  return sceneOptions.find((item) => item.value === kind)?.label || kind || "未知场景";
}

function statusLabel(status: string) {
  return status === "success" ? "成功" : status === "error" ? "失败" : "进行中";
}

function formatDuration(value?: number | null) {
  const ms = Number(value || 0);
  if (!ms) return "—";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

function resetAndLoad() {
  filters.page = 1;
  load();
}

async function load() {
  const seq = ++requestSeq;
  loading.value = true;
  errorMessage.value = "";
  try {
    const result = await adminApi.aiUsageLogs({
      ...filters,
      from: dateRange.value?.[0] || undefined,
      to: dateRange.value?.[1] || undefined,
    }, { suppressErrorMessage: true });
    if (seq !== requestSeq) return;
    rows.value = result.list;
    total.value = result.total;
    Object.assign(summary, result.summary);
  } catch (error: any) {
    if (seq === requestSeq) errorMessage.value = error?.response?.data?.message || error?.message || "AI 使用日志加载失败";
  } finally {
    if (seq === requestSeq) loading.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.ai-usage-pane { display: grid; gap: 16px; color: var(--el-text-color-primary); }
.usage-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.usage-head h2 { margin: 0; font-size: 20px; }
.usage-head p { margin: 6px 0 0; color: var(--el-text-color-secondary); }
.summary-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
.summary-card { padding: 16px; border: 1px solid var(--el-border-color-light); border-radius: 12px; background: var(--el-bg-color); }
.summary-card strong, .summary-card span { display: block; }
.summary-card strong { font-size: 24px; line-height: 1.2; color: var(--el-color-primary); }
.summary-card span { margin-top: 5px; color: var(--el-text-color-secondary); font-size: 13px; }
.filter-bar { display: grid; grid-template-columns: 170px 140px minmax(300px, 1fr) minmax(220px, 1fr) auto; gap: 10px; }
.table-wrap { overflow-x: auto; border: 1px solid var(--el-border-color-light); border-radius: 12px; background: var(--el-bg-color); }
.detail-grid { display: grid; gap: 12px; padding: 8px 22px 18px; }
.detail-grid span { display: block; margin-bottom: 5px; color: var(--el-text-color-secondary); font-size: 12px; }
.detail-grid pre { max-height: 220px; margin: 0; overflow: auto; padding: 10px 12px; border-radius: 8px; background: var(--el-fill-color-light); color: var(--el-text-color-primary); white-space: pre-wrap; word-break: break-word; font: 12px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace; }
.detail-error pre { color: var(--el-color-danger); }
.pagination { justify-content: flex-end; }
@media (max-width: 1100px) {
  .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .filter-bar { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 640px) {
  .usage-head { align-items: stretch; flex-direction: column; }
  .summary-grid, .filter-bar { grid-template-columns: 1fr; }
}
</style>
