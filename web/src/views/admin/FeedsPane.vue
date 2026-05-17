<template>
  <div class="feeds-pane">
    <div class="ctrl-bar">
      <el-button type="primary" :loading="runningAll" @click="runAll">
        <el-icon><Refresh /></el-icon> 全量同步
      </el-button>
      <el-button @click="reload">刷新</el-button>
    </div>

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
          <el-switch :model-value="row.enabled" @change="toggleEnabled(row)" />
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
      <el-table-column label="操作" width="240" fixed="right">
        <template #default="{ row }">
          <el-button text type="primary" size="small" :loading="runningId === row.id" @click="runOne(row)">立即同步</el-button>
          <el-button text type="danger" size="small" :loading="resettingId === row.id" @click="resetRun(row)">删除重爬</el-button>
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
          <el-switch :model-value="row.enabled" @change="toggleEnabled(row)" />
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
          <el-button plain type="primary" size="small" :loading="runningId === row.id" @click="runOne(row)">立即同步</el-button>
          <el-button plain type="danger" size="small" :loading="resettingId === row.id" @click="resetRun(row)">删除重爬</el-button>
        </div>
      </article>
      <el-empty v-if="!loading && !list.length" description="暂无同步源" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Refresh } from "@element-plus/icons-vue";
import { adminApi } from "@/api/admin";
import { fmtRelative } from "@/utils/format";

const list = ref<any[]>([]);
const loading = ref(false);
const runningAll = ref(false);
const runningId = ref<number | null>(null);
const resettingId = ref<number | null>(null);

onMounted(reload);
async function reload() {
  loading.value = true;
  try { list.value = await adminApi.feeds(); }
  finally { loading.value = false; }
}

async function toggleEnabled(row: any) {
  await adminApi.updateFeed(row.id, { enabled: !row.enabled });
  ElMessage.success(row.enabled ? "已禁用" : "已启用");
  reload();
}

async function runOne(row: any) {
  runningId.value = row.id;
  try {
    const r = await adminApi.runFeed(row.id);
    ElMessage.success(`同步完成，新增 ${r?.newCount ?? 0} 条`);
    reload();
  } finally { runningId.value = null; }
}

async function resetRun(row: any) {
  await ElMessageBox.confirm(
    `删除「${row.name}」已抓取的 ${row.board?.topicCount ?? 0} 篇文章并重新抓取？\n用于切换到代理后重新获取正文，删除后不可恢复。`,
    "删除并重爬",
    { type: "warning", confirmButtonText: "删除重爬", cancelButtonText: "取消" }
  );
  resettingId.value = row.id;
  try {
    const r = await adminApi.resetRunFeed(row.id);
    ElMessage.success(`重爬完成，新增 ${r?.newCount ?? 0} 条`);
    reload();
  } finally { resettingId.value = null; }
}

async function runAll() {
  runningAll.value = true;
  try {
    const r = await adminApi.runAllFeeds();
    const total = (r as any[]).reduce((s, x) => s + (x.newCount ?? 0), 0);
    ElMessage.success(`全量同步完成，共新增 ${total} 条`);
    reload();
  } finally { runningAll.value = false; }
}
</script>

<style scoped>
.feeds-pane { display: flex; flex-direction: column; gap: 12px; }
.ctrl-bar { display: flex; gap: 10px; }
.muted { color: #9ca3af; }
.mobile-list { display: none; }

@media (max-width: 768px) {
  .ctrl-bar {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
  .ctrl-bar :deep(.el-button) {
    width: 100%;
    margin-left: 0;
  }
  .admin-table { display: none; }
  .mobile-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 120px;
  }
  .feed-card {
    padding: 12px;
    border: 1px solid #eef0f4;
    border-radius: 8px;
    background: #fff;
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
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-top: 12px;
  }
  .mobile-actions :deep(.el-button) {
    width: 100%;
    margin-left: 0;
  }
}
</style>
