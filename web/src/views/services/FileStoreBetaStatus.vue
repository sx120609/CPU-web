<template>
  <div class="fs-status-beta">
    <section class="fs-status-shell" v-loading="loading">
      <button type="button" class="fs-status-back" @click="$router.push('/services/tools/file_collect')">
        <el-icon><ArrowLeft /></el-icon>
        文件收集
      </button>

      <template v-if="statusData">
        <header class="fs-status-hero">
          <div>
            <div class="fs-status-kicker">
              <span>成功提交名单</span>
              <el-tag size="small" effect="plain">Beta</el-tag>
            </div>
            <h1>{{ statusData.title }}</h1>
            <p>这里显示已经成功提交的记录和文件名。文件内容不会在此页面公开。</p>
            <small v-if="statusData.deadline">截止时间：{{ formatDateTime(statusData.deadline) }}</small>
          </div>
          <a :href="submitPath" target="_blank" rel="noopener">前往提交</a>
        </header>

        <section class="fs-status-metrics">
          <div>
            <span>已提交</span>
            <b>{{ statusData.stats.submitted }}</b>
            <small>成功记录数</small>
          </div>
          <div>
            <span>应提交</span>
            <b>{{ statusData.stats.expected || "-" }}</b>
            <small>{{ statusData.stats.expected ? "来自名单行数" : "未设置名单" }}</small>
          </div>
          <div>
            <span>未提交</span>
            <b>{{ statusData.stats.missing }}</b>
            <small>{{ statusData.stats.expected ? "名单内尚未提交" : "未设置名单" }}</small>
          </div>
        </section>

        <section class="fs-status-panel">
          <div class="fs-status-panel-head">
            <div>
              <b>提交记录</b>
              <span>{{ filteredRows.length }} / {{ statusData.submissions.length }}</span>
            </div>
            <el-input v-model="query" class="fs-status-search" placeholder="搜索姓名、编号或文件名" clearable>
              <template #prefix>
                <el-icon><Search /></el-icon>
              </template>
            </el-input>
          </div>
          <div class="fs-status-list">
            <article v-for="item in filteredRows" :key="item.id" class="fs-status-item">
              <div class="fs-status-person">
                <b>{{ item.displayName }}</b>
                <span>{{ item.identity || `提交 #${item.id}` }} · {{ formatDateTime(item.createdAt) }}</span>
              </div>
              <div class="fs-status-files">
                <span v-for="file in item.files" :key="file.storedName">
                  <b>{{ file.storedName }}</b>
                  <small>{{ formatBytes(file.size) }}</small>
                </span>
              </div>
            </article>
            <el-empty v-if="!filteredRows.length" :description="statusData.submissions.length ? '没有匹配结果' : '暂无成功提交'" />
          </div>
        </section>
      </template>

      <el-empty v-else-if="!loading" :description="error || '成功名单不存在'">
        <el-button type="primary" :loading="loading" @click="load">重新加载</el-button>
      </el-empty>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { ArrowLeft, Search } from "@element-plus/icons-vue";
import { filestoreBetaApi, type FilestoreBetaPublicStatus } from "@/api/filestoreBeta";
import { formatDateTime, requestErrorMessage } from "@/views/services/filestoreBetaShared";
import { formatBytes } from "@/views/services/fileCollectExport";

const route = useRoute();
const loading = ref(false);
const error = ref("");
const statusData = ref<FilestoreBetaPublicStatus | null>(null);
const query = ref("");
let loadSeq = 0;

const slug = computed(() => String(route.params.slug || "").trim());
const submitPath = computed(() => `/services/tools/filestore-beta/submit/${slug.value}`);
const filteredRows = computed(() => {
  const data = statusData.value;
  if (!data) return [];
  const keyword = query.value.trim().toLowerCase();
  if (!keyword) return data.submissions;
  return data.submissions.filter((item) => `${item.displayName} ${item.identity} ${item.files.map((file) => file.storedName).join(" ")}`.toLowerCase().includes(keyword));
});

watch(slug, load, { immediate: true });

async function load() {
  const seq = ++loadSeq;
  loading.value = true;
  error.value = "";
  statusData.value = null;
  if (!slug.value) {
    error.value = "成功名单地址无效";
    loading.value = false;
    return;
  }
  try {
    const next = await filestoreBetaApi.publicStatus(slug.value);
    if (seq !== loadSeq) return;
    statusData.value = next;
    document.title = `${next.siteTitle || "药大拾间文件收集"} · 提交成功名单`;
  } catch (err) {
    if (seq !== loadSeq) return;
    error.value = requestErrorMessage(err, "成功名单加载失败");
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}
</script>

<style scoped>
.fs-status-beta {
  min-height: calc(100dvh - 64px);
  padding: 22px;
  background: var(--cpu-bg);
}

.fs-status-shell {
  width: min(960px, 100%);
  margin: 0 auto;
  display: grid;
  gap: 14px;
}

.fs-status-back {
  justify-self: start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  border: 0;
  background: transparent;
  color: var(--cpu-primary);
  cursor: pointer;
}

.fs-status-hero,
.fs-status-panel {
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  background: var(--cpu-surface);
  box-shadow: var(--cpu-shadow-sm);
}

.fs-status-hero {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  padding: 22px;
}

.fs-status-kicker {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.fs-status-kicker span:first-child {
  color: var(--cpu-primary);
  font-size: 12px;
  font-weight: 800;
}

.fs-status-hero h1 {
  margin: 8px 0;
  color: var(--cpu-text);
  font-size: 26px;
}

.fs-status-hero p {
  margin: 0;
  color: var(--cpu-text-secondary);
  line-height: 1.7;
}

.fs-status-hero small {
  display: block;
  margin-top: 8px;
  color: var(--cpu-text-secondary);
}

.fs-status-hero a {
  align-self: flex-start;
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 14px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  color: var(--cpu-primary);
  background: var(--cpu-surface-soft);
  text-decoration: none;
}

.fs-status-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.fs-status-metrics div {
  padding: 14px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  background: var(--cpu-surface);
}

.fs-status-metrics span,
.fs-status-metrics small {
  display: block;
  color: var(--cpu-text-secondary);
  font-size: 12px;
}

.fs-status-metrics b {
  display: block;
  margin: 6px 0 4px;
  color: var(--cpu-text);
  font-size: 24px;
}

.fs-status-panel {
  padding: 14px;
}

.fs-status-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.fs-status-panel-head div {
  display: grid;
  gap: 2px;
}

.fs-status-panel-head b {
  color: var(--cpu-text);
}

.fs-status-panel-head span {
  color: var(--cpu-text-secondary);
  font-size: 12px;
}

.fs-status-search {
  max-width: 320px;
}

.fs-status-list {
  display: grid;
  gap: 10px;
  margin-top: 14px;
}

.fs-status-item {
  display: grid;
  grid-template-columns: minmax(180px, 0.7fr) minmax(0, 1fr);
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  background: var(--cpu-surface-soft);
}

.fs-status-person b,
.fs-status-files b {
  color: var(--cpu-text);
}

.fs-status-person span {
  display: block;
  margin-top: 4px;
  color: var(--cpu-text-secondary);
  font-size: 12px;
}

.fs-status-files {
  display: grid;
  gap: 7px;
}

.fs-status-files span {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.fs-status-files b {
  min-width: 0;
  overflow-wrap: anywhere;
}

.fs-status-files small {
  flex: 0 0 auto;
  color: var(--cpu-text-secondary);
}

@media (max-width: 720px) {
  .fs-status-beta {
    padding: 14px;
  }

  .fs-status-hero,
  .fs-status-panel-head {
    flex-direction: column;
    align-items: stretch;
  }

  .fs-status-metrics,
  .fs-status-item {
    grid-template-columns: 1fr;
  }

  .fs-status-search {
    max-width: none;
  }

  .fs-status-files span {
    display: grid;
  }
}
</style>
