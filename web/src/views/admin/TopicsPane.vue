<template>
  <div class="topics-pane">
    <div class="ctrl-bar">
      <el-input v-model="q" placeholder="搜标题 / 正文" clearable style="width:280px" @keyup.enter="reload">
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select v-model="boardSlug" clearable placeholder="所有板块" style="width:160px" :disabled="Boolean(boardLoadError)" @change="reload">
        <el-option v-for="b in boards" :key="b.slug" :value="b.slug" :label="b.name" />
      </el-select>
      <el-select v-model="reviewStatus" clearable placeholder="审核状态" style="width:180px" @change="reload">
        <el-option label="全部状态" value="" />
        <el-option label="自动通过" value="auto_passed" />
        <el-option label="AI 拦截" value="blocked_ai" />
        <el-option label="申请人工审核" value="manual_requested" />
        <el-option label="人工审核中" value="manual_reviewing" />
        <el-option label="人工已通过" value="approved_manual" />
        <el-option label="人工已驳回" value="rejected_manual" />
      </el-select>
      <el-radio-group v-model="hidden" size="default" @change="reload">
        <el-radio-button value="">全部</el-radio-button>
        <el-radio-button value="0">正常</el-radio-button>
        <el-radio-button value="1">已隐</el-radio-button>
      </el-radio-group>
      <el-button :loading="loading" @click="reload">刷新</el-button>
    </div>

    <el-alert
      v-if="boardLoadError"
      type="warning"
      :closable="false"
      show-icon
      class="pane-alert"
      :title="boardLoadError"
    />
    <el-alert
      v-if="loadError"
      type="error"
      :closable="false"
      show-icon
      class="pane-alert"
      :title="loadError"
    >
      <template #default>
        <el-button size="small" :loading="loading" @click="reload">重试</el-button>
      </template>
    </el-alert>

    <el-table :data="list" v-loading="loading" stripe size="default" class="admin-table">
      <el-table-column prop="id" label="ID" width="60" />
      <el-table-column label="板块" width="120">
        <template #default="{ row }">{{ row.board?.name || "-" }}</template>
      </el-table-column>
      <el-table-column label="标题" min-width="280">
        <template #default="{ row }">
          <span v-if="row.globalPinned" style="color:#b45309;margin-right:4px">📍</span>
          <span v-if="row.pinned" style="color:#dc2626;margin-right:4px">📌</span>
          <span v-if="row.locked" style="margin-right:4px">🔒</span>
          <span v-if="row.hidden" style="color:#9ca3af;text-decoration:line-through">{{ row.title }}</span>
          <a v-else :href="`/forum/topic/${row.id}`" target="_blank" rel="noopener noreferrer">{{ row.title }}</a>
        </template>
      </el-table-column>
      <el-table-column label="作者" width="120">
        <template #default="{ row }">
          <div class="author-cell">
            <span>{{ row.author?.nickname || "未知用户" }}</span>
            <span v-if="row.isAnonymous && row.realAuthor" class="author-real">
              {{ row.realAuthor.nickname }}<template v-if="row.realAuthor.username"> @{{ row.realAuthor.username }}</template>
            </span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="审核" width="160">
        <template #default="{ row }">
          <span>{{ reviewLabel(row.aiReviewStatus) }}</span>
          <div v-if="row.aiRiskScore !== null && row.aiRiskScore !== undefined" class="risk-note">
            {{ row.aiRiskScore }} 分
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="replyCount" label="回" width="60" align="right" />
      <el-table-column prop="likeCount" label="赞" width="60" align="right" />
      <el-table-column label="时间" width="160">
        <template #default="{ row }">{{ fmtDate(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="108" fixed="right" align="center">
        <template #default="{ row }">
          <el-dropdown trigger="click" @command="handleTopicCommand($event, row)">
            <el-button text size="small" class="action-trigger" :loading="isTopicBusy(row)" :disabled="isTopicBusy(row)">
              操作<el-icon class="more-icon"><MoreFilled /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="open">查看原帖</el-dropdown-item>
                <el-dropdown-item command="pin" :disabled="isTopicBusy(row)">{{ row.pinned ? "取消板块置顶" : "板块置顶" }}</el-dropdown-item>
                <el-dropdown-item command="globalPin" :disabled="isTopicBusy(row)">{{ row.globalPinned ? "取消全局置顶" : "全局置顶" }}</el-dropdown-item>
                <el-dropdown-item command="lock" :disabled="isTopicBusy(row)">{{ row.locked ? "解锁" : "锁定" }}</el-dropdown-item>
                <el-dropdown-item
                  v-if="row.aiReviewStatus === 'manual_requested' || row.aiReviewStatus === 'manual_reviewing'"
                  command="approve"
                  :disabled="isTopicBusy(row)"
                >
                  审核通过
                </el-dropdown-item>
                <el-dropdown-item
                  v-if="row.aiReviewStatus === 'manual_requested' || row.aiReviewStatus === 'manual_reviewing'"
                  command="reject"
                  :disabled="isTopicBusy(row)"
                >
                  驳回
                </el-dropdown-item>
                <el-dropdown-item :command="row.hidden ? 'unhide' : 'hide'" :disabled="isTopicBusy(row)">
                  {{ row.hidden ? "恢复" : "隐藏" }}
                </el-dropdown-item>
                <el-dropdown-item command="move" :disabled="isTopicBusy(row)">转版</el-dropdown-item>
                <el-dropdown-item command="destroy" divided :disabled="isTopicBusy(row)">删除</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </template>
      </el-table-column>
    </el-table>

    <div class="mobile-list" v-loading="loading">
      <article v-for="row in list" :key="row.id" class="topic-card">
        <div class="topic-title">
          <span v-if="row.globalPinned" class="state warning">全局置顶</span>
          <span v-if="row.pinned" class="state danger">板块置顶</span>
          <span v-if="row.locked" class="state">锁定</span>
          <span v-if="row.hidden" class="state muted-state">已隐</span>
          <a :class="{ hidden: row.hidden }" :href="`/forum/topic/${row.id}`" target="_blank" rel="noopener noreferrer">{{ row.title }}</a>
        </div>
        <div class="topic-meta">
          <span>{{ row.board?.name || "-" }}</span>
          <span>
            {{ row.author?.nickname || "未知用户" }}
            <template v-if="row.isAnonymous && row.realAuthor">
              · 真实作者 {{ row.realAuthor.nickname }}<template v-if="row.realAuthor.username"> @{{ row.realAuthor.username }}</template>
            </template>
          </span>
          <span>{{ reviewLabel(row.aiReviewStatus) }}<template v-if="row.aiRiskScore !== null && row.aiRiskScore !== undefined"> · {{ row.aiRiskScore }} 分</template></span>
          <span>{{ row.replyCount }} 回 / {{ row.likeCount }} 赞</span>
          <span>{{ fmtDate(row.createdAt) }}</span>
        </div>
        <div class="mobile-actions">
          <el-dropdown trigger="click" @command="handleTopicCommand($event, row)">
            <el-button plain size="small" class="mobile-action-trigger" :loading="isTopicBusy(row)" :disabled="isTopicBusy(row)">
              操作<el-icon class="more-icon"><MoreFilled /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="open">查看原帖</el-dropdown-item>
                <el-dropdown-item command="pin" :disabled="isTopicBusy(row)">{{ row.pinned ? "取消板块置顶" : "板块置顶" }}</el-dropdown-item>
                <el-dropdown-item command="globalPin" :disabled="isTopicBusy(row)">{{ row.globalPinned ? "取消全局置顶" : "全局置顶" }}</el-dropdown-item>
                <el-dropdown-item command="lock" :disabled="isTopicBusy(row)">{{ row.locked ? "解锁" : "锁定" }}</el-dropdown-item>
                <el-dropdown-item
                  v-if="row.aiReviewStatus === 'manual_requested' || row.aiReviewStatus === 'manual_reviewing'"
                  command="approve"
                  :disabled="isTopicBusy(row)"
                >
                  审核通过
                </el-dropdown-item>
                <el-dropdown-item
                  v-if="row.aiReviewStatus === 'manual_requested' || row.aiReviewStatus === 'manual_reviewing'"
                  command="reject"
                  :disabled="isTopicBusy(row)"
                >
                  驳回
                </el-dropdown-item>
                <el-dropdown-item :command="row.hidden ? 'unhide' : 'hide'" :disabled="isTopicBusy(row)">
                  {{ row.hidden ? "恢复" : "隐藏" }}
                </el-dropdown-item>
                <el-dropdown-item command="move" :disabled="isTopicBusy(row)">转版</el-dropdown-item>
                <el-dropdown-item command="destroy" divided :disabled="isTopicBusy(row)">删除</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </article>
      <el-empty v-if="!loading && !list.length" description="没有符合条件的帖子" />
    </div>

    <el-pagination
      v-if="total > size"
      :current-page="page"
      :page-size="size"
      :total="total"
      layout="prev, pager, next, total"
      class="pager"
      @current-change="onPage"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Search, MoreFilled } from "@element-plus/icons-vue";
import { adminApi } from "@/api/admin";
import { boardApi, type Board } from "@/api/board";
import { fmtDate } from "@/utils/format";

const list = ref<any[]>([]);
const boards = ref<Board[]>([]);
const total = ref(0);
const page = ref(1);
const size = ref(20);
const loading = ref(false);
const loadError = ref("");
const boardLoadError = ref("");
const topicBusyId = ref<number | null>(null);
const q = ref("");
const boardSlug = ref("");
const hidden = ref<"" | "0" | "1">("");
const reviewStatus = ref("");
let reloadSeq = 0;

onMounted(async () => {
  try {
    boards.value = await boardApi.list({ suppressErrorMessage: true });
  } catch (error) {
    boardLoadError.value = requestMessage(error) || "板块列表加载失败，转版和板块筛选暂不可用";
    boards.value = [];
  }
  await reload();
});

async function reload() {
  const seq = ++reloadSeq;
  loading.value = true;
  loadError.value = "";
  try {
    const r = await adminApi.topics({
      q: q.value, board: boardSlug.value || undefined,
      hidden: hidden.value || undefined,
      reviewStatus: reviewStatus.value || undefined,
      page: page.value, size: size.value,
    }, { suppressErrorMessage: true });
    if (seq !== reloadSeq) return;
    list.value = r.list;
    total.value = r.total;
  } catch (error) {
    if (seq !== reloadSeq) return;
    list.value = [];
    total.value = 0;
    loadError.value = requestMessage(error) || "帖子列表加载失败，请稍后重试";
  } finally {
    if (seq === reloadSeq) loading.value = false;
  }
}
function onPage(p: number) { page.value = p; reload(); }

function requestMessage(error: unknown) {
  if (typeof error !== "object" || error === null) return "";
  const responseMessage = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message;
  if (typeof responseMessage === "string") return responseMessage;
  return error instanceof Error ? error.message : "";
}

function isTopicBusy(row: any) {
  return topicBusyId.value === row.id;
}

async function runTopicAction(row: any, action: () => Promise<void>) {
  if (topicBusyId.value !== null) return;
  topicBusyId.value = row.id;
  try {
    await action();
  } finally {
    topicBusyId.value = null;
  }
}

function handleTopicCommand(command: string, row: any) {
  if (command === "open") return openTopic(row);
  if (topicBusyId.value !== null) return;
  if (command === "pin") return togglePin(row);
  if (command === "globalPin") return toggleGlobalPin(row);
  if (command === "lock") return toggleLock(row);
  if (command === "approve") return approveReview(row);
  if (command === "reject") return rejectReview(row);
  if (command === "hide") return hideRow(row);
  if (command === "unhide") return unhide(row);
  if (command === "move") return moveBoard(row);
  if (command === "destroy") return destroyRow(row);
}

function openTopic(row: any) {
  window.open(`/forum/topic/${row.id}`, "_blank", "noopener,noreferrer");
}

async function togglePin(row: any) {
  await runTopicAction(row, async () => {
    await adminApi.updateTopic(row.id, { pinned: !row.pinned });
    ElMessage.success(row.pinned ? "已取消板块置顶" : "已设为板块置顶");
    await reload();
  });
}
async function toggleGlobalPin(row: any) {
  await runTopicAction(row, async () => {
    await adminApi.updateTopic(row.id, { globalPinned: !row.globalPinned });
    ElMessage.success(row.globalPinned ? "已取消全局置顶" : "已设为全局置顶");
    await reload();
  });
}
async function toggleLock(row: any) {
  await runTopicAction(row, async () => {
    await adminApi.updateTopic(row.id, { locked: !row.locked });
    ElMessage.success(row.locked ? "已解锁" : "已锁定");
    await reload();
  });
}
async function hideRow(row: any) {
  await runTopicAction(row, async () => {
    const confirmed = await ElMessageBox.confirm(`隐藏帖子《${row.title.slice(0, 30)}》？`, "确认", { type: "warning" })
      .then(() => true)
      .catch(() => false);
    if (!confirmed) return;
    await adminApi.updateTopic(row.id, { hidden: true });
    ElMessage.success("已隐藏");
    await reload();
  });
}
async function destroyRow(row: any) {
  await runTopicAction(row, async () => {
    const confirmed = await ElMessageBox.confirm(
      `永久删除帖子《${row.title.slice(0, 30)}》？\n该操作会删除回复、点赞以及爬虫去重记录，无法恢复。`,
      "永久删除",
      { type: "error", confirmButtonText: "删除", cancelButtonText: "取消" }
    ).then(() => true).catch(() => false);
    if (!confirmed) return;
    await adminApi.destroyTopic(row.id);
    ElMessage.success("已删除");
    await reload();
  });
}
async function unhide(row: any) {
  await runTopicAction(row, async () => {
    await adminApi.updateTopic(row.id, { hidden: false });
    ElMessage.success("已恢复");
    await reload();
  });
}
async function moveBoard(row: any) {
  await runTopicAction(row, async () => {
    const writable = boards.value.filter((b) => !b.readOnly);
    if (!writable.length) {
      ElMessage.warning(boardLoadError.value || "暂无可转入的板块");
      return;
    }
    const slugs = writable.map((b) => `${b.slug} (${b.name})`).join(", ");
    const { value } = await ElMessageBox.prompt(
      `将《${row.title.slice(0, 30)}》转到哪个板块？\n可选 slug：\n${slugs}`,
      "转板块",
      { inputValidator: (v) => writable.some((b) => b.slug === v) }
    ).catch(() => ({ value: "" }));
    if (!value) return;
    await adminApi.updateTopic(row.id, { boardSlug: value });
    ElMessage.success("已转移");
    await reload();
  });
}

function reviewLabel(status?: string) {
  if (status === "auto_passed") return "自动通过";
  if (status === "blocked_ai") return "AI 拦截";
  if (status === "manual_requested") return "申请人工审核";
  if (status === "manual_reviewing") return "人工审核中";
  if (status === "approved_manual") return "人工已通过";
  if (status === "rejected_manual") return "人工已驳回";
  return "未审核";
}

async function approveReview(row: any) {
  await runTopicAction(row, async () => {
    await adminApi.updateTopic(row.id, { aiReviewStatus: "approved_manual", manualReviewNote: "管理员人工审核通过" });
    ElMessage.success("已审核通过");
    await reload();
  });
}

async function rejectReview(row: any) {
  await runTopicAction(row, async () => {
    let value = "";
    try {
      ({ value } = await ElMessageBox.prompt("填写驳回说明（选填）", "人工驳回", {
        inputPlaceholder: "例如：存在明显人身攻击 / 泄露隐私信息",
      }));
    } catch {
      return;
    }
    await adminApi.updateTopic(row.id, { aiReviewStatus: "rejected_manual", manualReviewNote: value || "管理员人工驳回" });
    ElMessage.success("已驳回");
    await reload();
  });
}
</script>

<style scoped>
.topics-pane { display: flex; flex-direction: column; gap: 12px; }
.ctrl-bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.pane-alert :deep(.el-alert__content) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}
.pager { display: flex; justify-content: center; padding-top: 12px; }
a { color: var(--cpu-primary); text-decoration: none; }
a:hover { text-decoration: underline; }
.admin-table { display: block; }
.mobile-list {
  display: none;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
  gap: 12px;
  min-height: 120px;
}
.topic-card {
  padding: 14px;
  border: 1px solid #e7edf5;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}
.topic-title {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-weight: 600;
  line-height: 1.5;
}
.topic-title a {
  flex: 1 1 100%;
  color: #111827;
}
.topic-title a.hidden {
  color: #9ca3af;
  text-decoration: line-through;
}
.state {
  border-radius: 4px;
  background: #f3f4f6;
  color: #4b5563;
  padding: 1px 5px;
  font-size: 11px;
  font-weight: 500;
}
.state.danger { color: #dc2626; background: #fef2f2; }
.muted-state { color: #9ca3af; }
.topic-meta {
  display: grid;
  gap: 4px;
  margin-top: 8px;
  color: #6b7280;
  font-size: 12px;
}
.author-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  line-height: 1.35;
}
.author-real {
  color: #6b7280;
  font-size: 12px;
}
.mobile-list :deep(.el-empty) {
  grid-column: 1 / -1;
}
.risk-note { font-size: 11px; color: #9ca3af; margin-top: 2px; }
.action-trigger { justify-content: center; }
.more-icon { margin-left: 2px; transform: rotate(90deg); }

@media (max-width: 768px) {
  .admin-table { display: none; }
  .mobile-list {
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
  }
  .ctrl-bar { align-items: stretch; }
  .ctrl-bar :deep(.el-input),
  .ctrl-bar :deep(.el-select),
  .ctrl-bar :deep(.el-radio-group),
  .ctrl-bar :deep(.el-button) {
    width: 100% !important;
  }
  .ctrl-bar :deep(.el-radio-group) {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
  }
  .ctrl-bar :deep(.el-radio-button__inner) {
    width: 100%;
    padding-left: 0;
    padding-right: 0;
  }
  .mobile-actions {
    margin-top: 12px;
  }
  .mobile-actions :deep(.el-dropdown) {
    width: 100%;
  }
  .mobile-action-trigger {
    width: 100%;
  }
  .pager { overflow-x: auto; justify-content: flex-start; padding-bottom: 2px; }
}
</style>
