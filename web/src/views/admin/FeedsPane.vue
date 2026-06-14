<template>
  <div class="feeds-pane">
    <div class="ctrl-bar">
      <el-button type="primary" :loading="runningAll" :disabled="runningAll || loading" @click="runAll">
        <el-icon><Refresh /></el-icon> 全量同步
      </el-button>
      <el-button :loading="loading" :disabled="loading || runningAll" @click="reload()">刷新</el-button>
    </div>

    <el-alert
      v-if="loadError"
      type="error"
      :closable="false"
      show-icon
      class="pane-alert"
      :title="loadError"
    >
      <template #default>
        <el-button size="small" :loading="loading" :disabled="runningAll" @click="reload()">重试</el-button>
      </template>
    </el-alert>

    <el-table :data="list" v-loading="loading" stripe size="default" class="admin-table">
      <el-table-column prop="id" label="ID" width="60" />
      <el-table-column prop="slug" label="slug" width="140" />
      <el-table-column prop="name" label="名称" min-width="140" />
      <el-table-column label="板块" width="140">
        <template #default="{ row }">{{ row.board?.name }} ({{ row.board?.topicCount }} 帖)</template>
      </el-table-column>
      <el-table-column prop="cronMinutes" label="周期(分)" width="90" align="right" />
      <el-table-column prop="maxPages" label="最多页数" width="90" align="right" />
      <el-table-column label="启用" width="80">
        <template #default="{ row }">
          <el-switch :model-value="row.enabled" :disabled="isFeedBusy(row) || runningAll" @change="toggleEnabled(row)" />
        </template>
      </el-table-column>
      <el-table-column label="上次" width="170">
        <template #default="{ row }">
          <span v-if="!row.lastRunAt" class="muted">—</span>
          <span v-else :style="{ color: row.lastRunOk ? '#16a34a' : '#dc2626' }">
            {{ fmtRelative(row.lastRunAt) }} · {{ row.lastRunOk ? '✓' : '✗' }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="错误" min-width="200">
        <template #default="{ row }">
          <span v-if="row.lastError" style="font-size:11px;color:#dc2626">{{ row.lastError.slice(0, 80) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="108" fixed="right" align="center">
        <template #default="{ row }">
          <el-dropdown trigger="click" @command="handleFeedCommand($event, row)">
            <el-button
              text
              size="small"
              class="action-trigger"
              :loading="isFeedBusy(row)"
              :disabled="runningAll"
            >
              操作<el-icon class="more-icon"><MoreFilled /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="run" :disabled="isFeedBusy(row) || runningAll">立即同步</el-dropdown-item>
                <el-dropdown-item command="reset" :disabled="isFeedBusy(row) || runningAll" divided>
                  删除重爬
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </template>
      </el-table-column>
    </el-table>

    <div class="mobile-list" v-loading="loading">
      <article v-for="row in list" :key="row.id" class="feed-card">
        <div class="feed-head">
          <div>
            <b>{{ row.name }}</b>
            <span>{{ row.slug }} · ID {{ row.id }}</span>
          </div>
          <el-switch :model-value="row.enabled" :disabled="isFeedBusy(row) || runningAll" @change="toggleEnabled(row)" />
        </div>
        <div class="feed-meta">
          <span>板块：{{ row.board?.name }}（{{ row.board?.topicCount }} 帖）</span>
          <span>周期：{{ row.cronMinutes }} 分 · 最多 {{ row.maxPages }} 页</span>
          <span>
            上次：
            <b v-if="!row.lastRunAt" class="muted">—</b>
            <b v-else :style="{ color: row.lastRunOk ? '#16a34a' : '#dc2626' }">
              {{ fmtRelative(row.lastRunAt) }} · {{ row.lastRunOk ? '成功' : '失败' }}
            </b>
          </span>
          <span v-if="row.lastError" class="feed-error">{{ row.lastError.slice(0, 120) }}</span>
        </div>
        <div class="mobile-actions">
          <el-dropdown trigger="click" @command="handleFeedCommand($event, row)">
            <el-button
              plain
              size="small"
              class="mobile-action-trigger"
              :loading="isFeedBusy(row)"
              :disabled="runningAll"
            >
              操作<el-icon class="more-icon"><MoreFilled /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="run" :disabled="isFeedBusy(row) || runningAll">立即同步</el-dropdown-item>
                <el-dropdown-item command="reset" :disabled="isFeedBusy(row) || runningAll" divided>
                  删除重爬
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </article>
      <el-empty v-if="!loading && !list.length" description="暂无同步源" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Refresh, MoreFilled } from "@element-plus/icons-vue";
import { adminApi } from "@/api/admin";
import { fmtRelative } from "@/utils/format";

const list = ref<any[]>([]);
const loading = ref(false);
const loadError = ref("");
const runningAll = ref(false);
const runningId = ref<number | null>(null);
const resettingId = ref<number | null>(null);
const togglingId = ref<number | null>(null);
let feedLoadSeq = 0;

onMounted(reload);
async function reload(force = false) {
  if (loading.value || (runningAll.value && !force)) return;
  const seq = ++feedLoadSeq;
  loading.value = true;
  loadError.value = "";
  try {
    const next = await adminApi.feeds({ suppressErrorMessage: true });
    if (seq === feedLoadSeq) list.value = next;
  } catch (error) {
    if (seq === feedLoadSeq) {
      list.value = [];
      loadError.value = requestMessage(error) || "同步源列表加载失败，请稍后重试";
    }
  } finally {
    if (seq === feedLoadSeq) loading.value = false;
  }
}

function handleFeedCommand(command: string, row: any) {
  if (command === "run") return runOne(row);
  if (command === "reset") return resetRun(row);
}

function isFeedBusy(row: any) {
  return runningId.value === row.id || resettingId.value === row.id || togglingId.value === row.id;
}

async function toggleEnabled(row: any) {
  if (isFeedBusy(row) || runningAll.value) return;
  togglingId.value = row.id;
  try {
    await adminApi.updateFeed(row.id, { enabled: !row.enabled });
    ElMessage.success(row.enabled ? "已禁用" : "已启用");
    await reload();
  } finally {
    togglingId.value = null;
  }
}

async function runOne(row: any) {
  if (isFeedBusy(row) || runningAll.value) return;
  runningId.value = row.id;
  try {
    const r = await adminApi.runFeed(row.id);
    ElMessage.success(`同步完成，新增 ${r?.newCount ?? 0} 条`);
    await reload();
  } finally { runningId.value = null; }
}

async function resetRun(row: any) {
  if (isFeedBusy(row) || runningAll.value) return;
  resettingId.value = row.id;
  try {
    await ElMessageBox.confirm(
      `删除「${row.name}」已抓取的 ${row.board?.topicCount ?? 0} 篇文章并重新抓取？\n用于切换到代理后重新获取正文，删除后不可恢复。`,
      "删除并重爬",
      { type: "warning", confirmButtonText: "删除重爬", cancelButtonText: "取消" }
    );
  } catch {
    resettingId.value = null;
    return;
  }
  try {
    const r = await adminApi.resetRunFeed(row.id);
    ElMessage.success(`重爬完成，新增 ${r?.newCount ?? 0} 条`);
    await reload();
  } finally { resettingId.value = null; }
}

async function runAll() {
  if (runningAll.value || loading.value) return;
  runningAll.value = true;
  try {
    const r = await adminApi.runAllFeeds();
    const total = (r as any[]).reduce((s, x) => s + (x.newCount ?? 0), 0);
    ElMessage.success(`全量同步完成，共新增 ${total} 条`);
    runningAll.value = false;
    await reload(true);
  } finally {
    runningAll.value = false;
  }
}

function requestMessage(error: unknown) {
  if (typeof error !== "object" || error === null) return "";
  const responseMessage = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message;
  if (typeof responseMessage === "string") return responseMessage;
  return error instanceof Error ? error.message : "";
}
</script>

<style scoped>
.feeds-pane { display: flex; flex-direction: column; gap: 12px; }
.ctrl-bar { display: flex; gap: 10px; }
.pane-alert :deep(.el-alert__content) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}
.muted { color: #9ca3af; }
.admin-table { display: block; }
.mobile-list {
  display: none;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
  gap: 12px;
  min-height: 120px;
}
.feed-card {
  padding: 14px;
  border: 1px solid #e7edf5;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}
.feed-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.feed-head b {
  display: block;
  color: #111827;
  font-size: 14px;
}
.feed-head span {
  display: block;
  margin-top: 2px;
  color: #6b7280;
  font-size: 12px;
}
.feed-meta {
  display: grid;
  gap: 5px;
  margin-top: 10px;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.5;
}
.feed-error { color: #dc2626; }
.mobile-actions {
  margin-top: 12px;
}
.mobile-actions :deep(.el-dropdown) {
  width: 100%;
}
.mobile-action-trigger {
  width: 100%;
}
.mobile-list :deep(.el-empty) {
  grid-column: 1 / -1;
}
.action-trigger { justify-content: center; }
.more-icon { margin-left: 2px; transform: rotate(90deg); }

@media (max-width: 768px) {
  .admin-table { display: none; }
  .mobile-list {
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
  }
  .ctrl-bar {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
  .ctrl-bar :deep(.el-button) {
    width: 100%;
    margin-left: 0;
  }
}
</style>
