<template>
  <div class="feeds-pane">
    <div class="ctrl-bar">
      <el-button type="primary" :loading="runningAll" @click="runAll">
        <el-icon><Refresh /></el-icon> 全量重跑
      </el-button>
      <el-button @click="reload">刷新</el-button>
    </div>

    <el-table :data="list" v-loading="loading" stripe size="default">
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
      <el-table-column label="操作" width="140" fixed="right">
        <template #default="{ row }">
          <el-button text type="primary" size="small" :loading="runningId === row.id" @click="runOne(row)">立即跑一次</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { ElMessage } from "element-plus";
import { Refresh } from "@element-plus/icons-vue";
import { adminApi } from "@/api/admin";
import { fmtRelative } from "@/utils/format";

const list = ref<any[]>([]);
const loading = ref(false);
const runningAll = ref(false);
const runningId = ref<number | null>(null);

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
    ElMessage.success(`抓取完成，新增 ${r?.newCount ?? 0} 条`);
    reload();
  } finally { runningId.value = null; }
}

async function runAll() {
  runningAll.value = true;
  try {
    const r = await adminApi.runAllFeeds();
    const total = (r as any[]).reduce((s, x) => s + (x.newCount ?? 0), 0);
    ElMessage.success(`全部跑完，共新增 ${total} 条`);
    reload();
  } finally { runningAll.value = false; }
}
</script>

<style scoped>
.feeds-pane { display: flex; flex-direction: column; gap: 12px; }
.ctrl-bar { display: flex; gap: 10px; }
.muted { color: #9ca3af; }
</style>
