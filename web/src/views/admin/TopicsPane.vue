<template>
  <div class="topics-pane">
    <div class="ctrl-bar">
      <el-input v-model="q" placeholder="搜标题 / 正文" clearable style="width:280px" @keyup.enter="reload">
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select v-model="boardSlug" clearable placeholder="所有板块" style="width:160px" @change="reload">
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
      <el-button @click="reload">刷新</el-button>
    </div>

    <el-table :data="list" v-loading="loading" stripe size="default" class="admin-table">
      <el-table-column prop="id" label="ID" width="60" />
      <el-table-column label="板块" width="120">
        <template #default="{ row }">{{ row.board.name }}</template>
      </el-table-column>
      <el-table-column label="标题" min-width="280">
        <template #default="{ row }">
          <span v-if="row.globalPinned" style="color:#b45309;margin-right:4px">📍</span>
          <span v-if="row.pinned" style="color:#dc2626;margin-right:4px">📌</span>
          <span v-if="row.locked" style="margin-right:4px">🔒</span>
          <span v-if="row.hidden" style="color:#9ca3af;text-decoration:line-through">{{ row.title }}</span>
          <a v-else :href="`/forum/topic/${row.id}`" target="_blank">{{ row.title }}</a>
        </template>
      </el-table-column>
      <el-table-column label="作者" width="120">
        <template #default="{ row }">{{ row.author.nickname }}</template>
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
            <el-button text size="small" class="action-trigger">
              操作<el-icon class="more-icon"><MoreFilled /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="open">查看原帖</el-dropdown-item>
                <el-dropdown-item command="pin">{{ row.pinned ? "取消板块置顶" : "板块置顶" }}</el-dropdown-item>
                <el-dropdown-item command="globalPin">{{ row.globalPinned ? "取消全局置顶" : "全局置顶" }}</el-dropdown-item>
                <el-dropdown-item command="lock">{{ row.locked ? "解锁" : "锁定" }}</el-dropdown-item>
                <el-dropdown-item
                  v-if="row.aiReviewStatus === 'manual_requested' || row.aiReviewStatus === 'manual_reviewing'"
                  command="approve"
                >
                  审核通过
                </el-dropdown-item>
                <el-dropdown-item
                  v-if="row.aiReviewStatus === 'manual_requested' || row.aiReviewStatus === 'manual_reviewing'"
                  command="reject"
                >
                  驳回
                </el-dropdown-item>
                <el-dropdown-item :command="row.hidden ? 'unhide' : 'hide'">
                  {{ row.hidden ? "恢复" : "隐藏" }}
                </el-dropdown-item>
                <el-dropdown-item command="move">转版</el-dropdown-item>
                <el-dropdown-item command="destroy" divided>删除</el-dropdown-item>
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
          <a :class="{ hidden: row.hidden }" :href="`/forum/topic/${row.id}`" target="_blank">{{ row.title }}</a>
        </div>
        <div class="topic-meta">
          <span>{{ row.board.name }}</span>
          <span>{{ row.author.nickname }}</span>
          <span>{{ reviewLabel(row.aiReviewStatus) }}<template v-if="row.aiRiskScore !== null && row.aiRiskScore !== undefined"> · {{ row.aiRiskScore }} 分</template></span>
          <span>{{ row.replyCount }} 回 / {{ row.likeCount }} 赞</span>
          <span>{{ fmtDate(row.createdAt) }}</span>
        </div>
        <div class="mobile-actions">
          <el-dropdown trigger="click" @command="handleTopicCommand($event, row)">
            <el-button plain size="small" class="mobile-action-trigger">
              操作<el-icon class="more-icon"><MoreFilled /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="open">查看原帖</el-dropdown-item>
                <el-dropdown-item command="pin">{{ row.pinned ? "取消板块置顶" : "板块置顶" }}</el-dropdown-item>
                <el-dropdown-item command="globalPin">{{ row.globalPinned ? "取消全局置顶" : "全局置顶" }}</el-dropdown-item>
                <el-dropdown-item command="lock">{{ row.locked ? "解锁" : "锁定" }}</el-dropdown-item>
                <el-dropdown-item
                  v-if="row.aiReviewStatus === 'manual_requested' || row.aiReviewStatus === 'manual_reviewing'"
                  command="approve"
                >
                  审核通过
                </el-dropdown-item>
                <el-dropdown-item
                  v-if="row.aiReviewStatus === 'manual_requested' || row.aiReviewStatus === 'manual_reviewing'"
                  command="reject"
                >
                  驳回
                </el-dropdown-item>
                <el-dropdown-item :command="row.hidden ? 'unhide' : 'hide'">
                  {{ row.hidden ? "恢复" : "隐藏" }}
                </el-dropdown-item>
                <el-dropdown-item command="move">转版</el-dropdown-item>
                <el-dropdown-item command="destroy" divided>删除</el-dropdown-item>
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
const q = ref("");
const boardSlug = ref("");
const hidden = ref<"" | "0" | "1">("");
const reviewStatus = ref("");

onMounted(async () => {
  boards.value = await boardApi.list();
  await reload();
});

async function reload() {
  loading.value = true;
  try {
    const r = await adminApi.topics({
      q: q.value, board: boardSlug.value || undefined,
      hidden: hidden.value || undefined,
      reviewStatus: reviewStatus.value || undefined,
      page: page.value, size: size.value,
    });
    list.value = r.list;
    total.value = r.total;
  } finally { loading.value = false; }
}
function onPage(p: number) { page.value = p; reload(); }

function handleTopicCommand(command: string, row: any) {
  if (command === "open") return openTopic(row);
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
  await adminApi.updateTopic(row.id, { pinned: !row.pinned });
  ElMessage.success(row.pinned ? "已取消板块置顶" : "已设为板块置顶");
  reload();
}
async function toggleGlobalPin(row: any) {
  await adminApi.updateTopic(row.id, { globalPinned: !row.globalPinned });
  ElMessage.success(row.globalPinned ? "已取消全局置顶" : "已设为全局置顶");
  reload();
}
async function toggleLock(row: any) {
  await adminApi.updateTopic(row.id, { locked: !row.locked });
  ElMessage.success(row.locked ? "已解锁" : "已锁定");
  reload();
}
async function hideRow(row: any) {
  await ElMessageBox.confirm(`隐藏帖子《${row.title.slice(0, 30)}》？`, "确认", { type: "warning" });
  await adminApi.updateTopic(row.id, { hidden: true });
  ElMessage.success("已隐藏");
  reload();
}
async function destroyRow(row: any) {
  await ElMessageBox.confirm(
    `永久删除帖子《${row.title.slice(0, 30)}》？\n该操作会删除回复、点赞以及爬虫去重记录，无法恢复。`,
    "永久删除",
    { type: "error", confirmButtonText: "删除", cancelButtonText: "取消" }
  );
  await adminApi.destroyTopic(row.id);
  ElMessage.success("已删除");
  reload();
}
async function unhide(row: any) {
  await adminApi.updateTopic(row.id, { hidden: false });
  ElMessage.success("已恢复");
  reload();
}
async function moveBoard(row: any) {
  const writable = boards.value.filter((b) => !b.readOnly);
  const slugs = writable.map((b) => `${b.slug} (${b.name})`).join(", ");
  const { value } = await ElMessageBox.prompt(
    `将《${row.title.slice(0, 30)}》转到哪个板块？\n可选 slug：\n${slugs}`,
    "转板块",
    { inputValidator: (v) => writable.some((b) => b.slug === v) }
  );
  await adminApi.updateTopic(row.id, { boardSlug: value });
  ElMessage.success("已转移");
  reload();
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
  await adminApi.updateTopic(row.id, { aiReviewStatus: "approved_manual", manualReviewNote: "管理员人工审核通过" });
  ElMessage.success("已审核通过");
  reload();
}

async function rejectReview(row: any) {
  const { value } = await ElMessageBox.prompt("填写驳回说明（选填）", "人工驳回", {
    inputPlaceholder: "例如：存在明显人身攻击 / 泄露隐私信息",
  }).catch(() => ({ value: "" }));
  await adminApi.updateTopic(row.id, { aiReviewStatus: "rejected_manual", manualReviewNote: value || "管理员人工驳回" });
  ElMessage.success("已驳回");
  reload();
}
</script>

<style scoped>
.topics-pane { display: flex; flex-direction: column; gap: 12px; }
.ctrl-bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.pager { display: flex; justify-content: center; padding-top: 12px; }
a { color: var(--cpu-primary); text-decoration: none; }
a:hover { text-decoration: underline; }
.admin-table { display: none; }
.mobile-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
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
.mobile-list :deep(.el-empty) {
  grid-column: 1 / -1;
}
.risk-note { font-size: 11px; color: #9ca3af; margin-top: 2px; }
.action-trigger { justify-content: center; }
.more-icon { margin-left: 2px; transform: rotate(90deg); }

@media (max-width: 768px) {
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
  .mobile-list {
    grid-template-columns: 1fr;
    gap: 10px;
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
