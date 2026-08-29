<template>
  <div class="review-pane">
    <div class="review-head">
      <div>
        <div class="review-title">待人工审核 {{ total }}</div>
        <div class="review-summary">帖子 {{ topicCount }} · 回复 {{ replyCount }}</div>
      </div>
      <el-button :loading="loading" @click="reload">刷新</el-button>
    </div>

    <el-alert v-if="loadError" type="error" :closable="false" show-icon :title="loadError" />

    <el-table :data="items" v-loading="loading" stripe class="review-table">
      <el-table-column label="类型" width="76">
        <template #default="{ row }">
          <el-tag :type="row.kind === 'topic' ? 'primary' : 'success'" effect="plain" size="small">
            {{ row.kind === "topic" ? "帖子" : "回复" }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="内容" min-width="300">
        <template #default="{ row }">
          <button type="button" class="content-link" @click="openTarget(row)">{{ row.title }}</button>
          <div v-if="row.kind === 'reply'" class="topic-name">所属帖子：{{ row.topicTitle }}</div>
        </template>
      </el-table-column>
      <el-table-column label="作者" width="130">
        <template #default="{ row }">{{ row.author?.nickname || "未知用户" }}</template>
      </el-table-column>
      <el-table-column label="板块" width="120">
        <template #default="{ row }">{{ row.board?.name || "-" }}</template>
      </el-table-column>
      <el-table-column label="审核原因" min-width="220">
        <template #default="{ row }">
          <div>{{ reviewLabel(row.aiReviewStatus) }}<template v-if="row.aiRiskScore !== null && row.aiRiskScore !== undefined"> · {{ row.aiRiskScore }} 分</template></div>
          <div class="review-reason">{{ row.aiReviewReason || "用户申请人工复核" }}</div>
        </template>
      </el-table-column>
      <el-table-column label="时间" width="155">
        <template #default="{ row }">{{ fmtDate(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="190" fixed="right">
        <template #default="{ row }">
          <el-button size="small" text @click="openTarget(row)">查看</el-button>
          <el-button size="small" type="success" plain :loading="isBusy(row)" :disabled="isBusy(row)" @click="approve(row)">通过</el-button>
          <el-button size="small" type="danger" plain :loading="isBusy(row)" :disabled="isBusy(row)" @click="reject(row)">驳回</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="review-cards" v-loading="loading">
      <article v-for="row in items" :key="`${row.kind}-${row.id}`" class="review-card">
        <div class="card-top">
          <el-tag :type="row.kind === 'topic' ? 'primary' : 'success'" effect="plain" size="small">
            {{ row.kind === "topic" ? "帖子" : "回复" }}
          </el-tag>
          <span>{{ reviewLabel(row.aiReviewStatus) }}</span>
          <span v-if="row.aiRiskScore !== null && row.aiRiskScore !== undefined">{{ row.aiRiskScore }} 分</span>
        </div>
        <button type="button" class="content-link card-title" @click="openTarget(row)">{{ row.title }}</button>
        <div v-if="row.kind === 'reply'" class="topic-name">所属帖子：{{ row.topicTitle }}</div>
        <div class="card-meta">
          <span>{{ row.board?.name || "-" }}</span>
          <span>{{ row.author?.nickname || "未知用户" }}</span>
          <span>{{ fmtDate(row.createdAt) }}</span>
        </div>
        <div class="review-reason">{{ row.aiReviewReason || "用户申请人工复核" }}</div>
        <div class="card-actions">
          <el-button size="small" plain @click="openTarget(row)">查看</el-button>
          <el-button size="small" type="success" plain :loading="isBusy(row)" :disabled="isBusy(row)" @click="approve(row)">通过</el-button>
          <el-button size="small" type="danger" plain :loading="isBusy(row)" :disabled="isBusy(row)" @click="reject(row)">驳回</el-button>
        </div>
      </article>
      <el-empty v-if="!loading && !items.length" description="当前没有待人工审核内容" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { adminApi } from "@/api/admin";
import { fmtDate } from "@/utils/format";

type ReviewItem = {
  kind: "topic" | "reply";
  id: number;
  topicId: number;
  topicTitle: string;
  title: string;
  content?: string;
  author?: { nickname?: string } | null;
  board?: { name?: string } | null;
  aiReviewStatus?: string;
  aiRiskScore?: number | null;
  aiReviewReason?: string | null;
  createdAt: string;
};

const topics = ref<any[]>([]);
const replies = ref<any[]>([]);
const total = ref(0);
const topicCount = ref(0);
const replyCount = ref(0);
const loading = ref(false);
const loadError = ref("");
const busyKey = ref("");

const items = computed<ReviewItem[]>(() => [
  ...topics.value.map((row) => ({
    ...row,
    kind: "topic" as const,
    topicId: row.id,
    topicTitle: row.title,
    title: row.title,
    board: row.board,
  })),
  ...replies.value.map((row) => ({
    ...row,
    kind: "reply" as const,
    topicId: row.topicId,
    topicTitle: row.topic?.title || "",
    title: plainText(row.content) || "空回复",
    board: row.topic?.board,
  })),
].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()));

onMounted(reload);

async function reload() {
  loading.value = true;
  loadError.value = "";
  try {
    const result = await adminApi.manualReviews({ suppressErrorMessage: true });
    topics.value = result.topics;
    replies.value = result.replies;
    total.value = result.total;
    topicCount.value = result.topicCount;
    replyCount.value = result.replyCount;
  } catch (error) {
    topics.value = [];
    replies.value = [];
    total.value = 0;
    topicCount.value = 0;
    replyCount.value = 0;
    loadError.value = requestMessage(error) || "人工审核队列加载失败，请稍后重试";
  } finally {
    loading.value = false;
  }
}

function openTarget(row: ReviewItem) {
  const anchor = row.kind === "reply" ? `#reply-${row.id}` : "";
  window.open(`/forum/topic/${row.topicId}${anchor}`, "_blank", "noopener,noreferrer");
}

function itemKey(row: ReviewItem) {
  return `${row.kind}-${row.id}`;
}

function isBusy(row: ReviewItem) {
  return busyKey.value === itemKey(row);
}

async function approve(row: ReviewItem) {
  if (busyKey.value) return;
  busyKey.value = itemKey(row);
  try {
    if (row.kind === "reply") {
      await adminApi.updateReply(row.id, { aiReviewStatus: "approved_manual", manualReviewNote: "管理员人工审核通过" });
    } else {
      await adminApi.updateTopic(row.id, { aiReviewStatus: "approved_manual", manualReviewNote: "管理员人工审核通过" });
    }
    ElMessage.success("已审核通过");
    await reload();
  } finally {
    busyKey.value = "";
  }
}

async function reject(row: ReviewItem) {
  if (busyKey.value) return;
  let value = "";
  try {
    ({ value } = await ElMessageBox.prompt("填写驳回说明（选填）", "人工驳回", {
      inputPlaceholder: "例如：泄露他人隐私 / 诈骗 / 批量营销",
    }));
  } catch {
    return;
  }
  busyKey.value = itemKey(row);
  try {
    if (row.kind === "reply") {
      await adminApi.updateReply(row.id, { aiReviewStatus: "rejected_manual", manualReviewNote: value || "管理员人工驳回" });
    } else {
      await adminApi.updateTopic(row.id, { aiReviewStatus: "rejected_manual", manualReviewNote: value || "管理员人工驳回" });
    }
    ElMessage.success("已驳回");
    await reload();
  } finally {
    busyKey.value = "";
  }
}

function reviewLabel(status?: string) {
  return status === "manual_reviewing" ? "人工审核中" : "申请人工审核";
}

function plainText(value: unknown) {
  return String(value || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function requestMessage(error: unknown) {
  if (typeof error !== "object" || error === null) return "";
  const responseMessage = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message;
  if (typeof responseMessage === "string") return responseMessage;
  return error instanceof Error ? error.message : "";
}
</script>

<style scoped>
.review-pane { display: flex; flex-direction: column; gap: 14px; }
.review-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.review-title { color: var(--cpu-text); font-size: 18px; font-weight: 700; }
.review-summary { margin-top: 3px; color: var(--cpu-text-secondary); font-size: 12px; }
.content-link { padding: 0; border: 0; background: transparent; color: var(--cpu-primary); font: inherit; font-weight: 600; text-align: left; cursor: pointer; }
.content-link:hover { text-decoration: underline; }
.topic-name, .review-reason { margin-top: 4px; color: var(--cpu-text-secondary); font-size: 12px; line-height: 1.5; }
.review-reason { overflow-wrap: anywhere; }
.review-cards { display: none; min-height: 120px; }

@media (max-width: 720px) {
  .review-table { display: none; }
  .review-cards { display: grid; gap: 12px; }
  .review-card { padding: 14px; border: 1px solid var(--cpu-border-soft); border-radius: 12px; background: var(--cpu-card); }
  .card-top, .card-meta, .card-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
  .card-top, .card-meta { color: var(--cpu-text-secondary); font-size: 12px; }
  .card-title { display: block; margin-top: 10px; font-size: 15px; line-height: 1.55; }
  .card-meta { margin-top: 10px; }
  .card-actions { margin-top: 12px; }
}
</style>
