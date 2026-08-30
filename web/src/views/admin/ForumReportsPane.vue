<template>
  <div class="reports-pane">
    <div class="reports-head">
      <div>
        <div class="reports-title">内容举报</div>
        <div class="reports-summary">待处理 {{ counts.pending || 0 }} · 已处理 {{ counts.resolved || 0 }} · 未采纳 {{ counts.rejected || 0 }}</div>
      </div>
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>

    <div class="filters">
      <el-select v-model="status" aria-label="处理状态" @change="changeFilter">
        <el-option label="待处理" value="pending" />
        <el-option label="已处理" value="resolved" />
        <el-option label="未采纳" value="rejected" />
        <el-option label="全部" value="all" />
      </el-select>
      <el-select v-model="targetType" aria-label="内容类型" @change="changeFilter">
        <el-option label="全部类型" value="all" />
        <el-option label="帖子" value="topic" />
        <el-option label="评论" value="reply" />
        <el-option label="私聊" value="direct_message" />
      </el-select>
    </div>

    <el-alert v-if="loadError" type="error" :closable="false" show-icon :title="loadError" />
    <el-alert type="info" :closable="false" show-icon title="私聊举报仅展示用户主动举报的单条消息快照；管理员不会获得整段私聊会话访问权限。" />

    <div class="report-list" v-loading="loading">
      <article v-for="row in rows" :key="row.id" class="report-card">
        <div class="card-head">
          <div class="card-tags">
            <el-tag :type="targetTagType(row.targetType)" size="small" effect="plain">{{ targetTypeLabel(row.targetType) }}</el-tag>
            <el-tag :type="statusTagType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
          </div>
          <span>{{ fmtDate(row.createdAt) }}</span>
        </div>
        <div class="target-line">
          <button v-if="row.targetUrl" type="button" class="target-link" @click="openTarget(row)">{{ row.targetLabel }}</button>
          <b v-else>{{ row.targetLabel }}</b>
        </div>
        <div class="people-line">
          <span>举报人：{{ displayUser(row.reporter) }}</span>
          <span>被举报人：{{ displayUser(row.targetAuthor) }}</span>
          <span>累计 {{ row.targetReportCount }} 人举报 · 有效 {{ row.activeTargetReportCount }} 人</span>
          <span>该举报人历史提交 {{ row.reporterReportCount }} 次 · 未采纳 {{ row.reporterRejectedCount }} 次</span>
        </div>
        <el-alert
          v-if="row.activeTargetReportCount >= 3 && row.targetType !== 'direct_message'"
          class="threshold-alert"
          type="warning"
          :closable="false"
          show-icon
          title="已达到 3 人阈值，公开内容已暂时隐藏"
        />
        <div class="reason-line"><b>{{ row.reasonLabel }}</b><span v-if="row.detail">{{ row.detail }}</span></div>
        <pre class="content-snapshot">{{ row.contentSnapshot }}</pre>
        <div v-if="row.handledAt" class="handled-line">
          {{ displayUser(row.handledBy) }} 于 {{ fmtDate(row.handledAt) }} 处理
          <template v-if="row.handledNote">：{{ row.handledNote }}</template>
        </div>
        <div class="card-actions">
          <el-button v-if="row.targetUrl" size="small" plain @click="openTarget(row)">查看原内容</el-button>
          <template v-if="row.status === 'pending'">
            <el-button size="small" type="success" plain :loading="busyId === row.id" :disabled="busyId !== null" @click="handle(row, 'resolved')">处理完成</el-button>
            <el-button size="small" type="danger" plain :loading="busyId === row.id" :disabled="busyId !== null" @click="handle(row, 'rejected')">不予采纳</el-button>
          </template>
        </div>
      </article>
      <el-empty v-if="!loading && !rows.length" description="当前没有符合条件的举报" />
    </div>

    <el-pagination
      v-if="total > size"
      v-model:current-page="page"
      :page-size="size"
      :total="total"
      layout="prev, pager, next"
      @current-change="load"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { adminApi, type ForumReportAdminRow } from "@/api/admin";
import { fmtDate } from "@/utils/format";

type ReportStatus = "pending" | "resolved" | "rejected" | "all";
type ReportTargetType = "topic" | "reply" | "direct_message" | "all";

const rows = ref<ForumReportAdminRow[]>([]);
const counts = ref<Record<string, number>>({});
const status = ref<ReportStatus>("pending");
const targetType = ref<ReportTargetType>("all");
const page = ref(1);
const size = 30;
const total = ref(0);
const loading = ref(false);
const loadError = ref("");
const busyId = ref<number | null>(null);

onMounted(load);

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    const result = await adminApi.forumReports({
      status: status.value,
      targetType: targetType.value,
      page: page.value,
      size,
    }, { suppressErrorMessage: true });
    rows.value = result.list;
    total.value = result.total;
    counts.value = result.counts;
  } catch (error) {
    rows.value = [];
    total.value = 0;
    loadError.value = requestMessage(error) || "举报列表加载失败，请稍后重试";
  } finally {
    loading.value = false;
  }
}

function changeFilter() {
  page.value = 1;
  void load();
}

async function handle(row: ForumReportAdminRow, nextStatus: "resolved" | "rejected") {
  if (busyId.value !== null) return;
  let note = "";
  try {
    ({ value: note } = await ElMessageBox.prompt(
      nextStatus === "resolved" ? "填写处理说明（选填，会反馈给举报人）" : "填写不予采纳原因（选填，会反馈给举报人）",
      nextStatus === "resolved" ? "处理举报" : "不予采纳",
      { inputPlaceholder: nextStatus === "resolved" ? "例如：已隐藏相关内容并处理账号" : "例如：复核后未发现违规" },
    ));
  } catch {
    return;
  }
  busyId.value = row.id;
  try {
    await adminApi.handleForumReport(row.id, { status: nextStatus, note: note.trim() });
    ElMessage.success(nextStatus === "resolved" ? "举报已处理并反馈用户" : "已记录为不予采纳并反馈用户");
    await load();
  } finally {
    busyId.value = null;
  }
}

function openTarget(row: ForumReportAdminRow) {
  if (row.targetUrl) window.open(row.targetUrl, "_blank", "noopener,noreferrer");
}

function displayUser(user?: { nickname?: string; username?: string } | null) {
  if (!user) return "账号已不存在";
  return `${user.nickname || "未命名"}${user.username ? ` @${user.username}` : ""}`;
}

function targetTypeLabel(value: ForumReportAdminRow["targetType"]) {
  return value === "topic" ? "帖子" : value === "reply" ? "评论" : "私聊";
}

function targetTagType(value: ForumReportAdminRow["targetType"]) {
  return value === "topic" ? "primary" : value === "reply" ? "success" : "warning";
}

function statusLabel(value: ForumReportAdminRow["status"]) {
  return value === "pending" ? "待处理" : value === "resolved" ? "已处理" : "未采纳";
}

function statusTagType(value: ForumReportAdminRow["status"]) {
  return value === "pending" ? "danger" : value === "resolved" ? "success" : "info";
}

function requestMessage(error: unknown) {
  if (typeof error !== "object" || error === null) return "";
  const responseMessage = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message;
  if (typeof responseMessage === "string") return responseMessage;
  return error instanceof Error ? error.message : "";
}
</script>

<style scoped>
.reports-pane { display: flex; flex-direction: column; gap: 14px; }
.reports-head, .card-head, .people-line, .card-actions, .card-tags, .filters { display: flex; align-items: center; gap: 10px; }
.reports-head, .card-head { justify-content: space-between; }
.reports-title { color: var(--cpu-text); font-size: 18px; font-weight: 700; }
.reports-summary, .card-head, .people-line, .handled-line { color: var(--cpu-text-secondary); font-size: 12px; }
.reports-summary { margin-top: 3px; }
.filters { flex-wrap: wrap; }
.filters .el-select { width: 180px; }
.report-list { display: grid; gap: 12px; min-height: 120px; }
.report-card { padding: 16px; border: 1px solid var(--cpu-border-soft); border-radius: 14px; background: var(--cpu-card); }
.target-line { margin-top: 12px; }
.target-link { padding: 0; border: 0; background: transparent; color: var(--cpu-primary); font: inherit; font-weight: 700; text-align: left; cursor: pointer; }
.target-link:hover { text-decoration: underline; }
.people-line { margin-top: 8px; flex-wrap: wrap; }
.reason-line { display: flex; align-items: baseline; gap: 10px; margin-top: 12px; line-height: 1.6; }
.threshold-alert { margin-top: 12px; }
.reason-line span { color: var(--cpu-text-secondary); overflow-wrap: anywhere; }
.content-snapshot { max-height: 220px; margin: 12px 0 0; padding: 12px; overflow: auto; border-radius: 10px; background: var(--cpu-surface-soft); color: var(--cpu-text); font: inherit; font-size: 13px; line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
.handled-line { margin-top: 10px; }
.card-actions { margin-top: 12px; flex-wrap: wrap; }

@media (max-width: 720px) {
  .reports-head { align-items: flex-start; }
  .filters .el-select { width: calc(50% - 5px); }
  .report-card { padding: 14px; }
  .card-head { align-items: flex-start; }
  .reason-line { display: block; }
  .reason-line span { display: block; margin-top: 4px; }
}
</style>
