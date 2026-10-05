<template>
  <div class="fs-st">
    <div v-if="loading" class="fs-st-card fs-st-pad"><el-skeleton :rows="6" animated /></div>

    <section v-else-if="!statusData" class="fs-st-card fs-st-state">
      <span class="fs-st-state-icon" aria-hidden="true"><el-icon><WarningFilled /></el-icon></span>
      <b>无法查看成功名单</b>
      <p>{{ error || "成功名单地址无效" }}</p>
      <el-button type="primary" plain @click="load">重新加载</el-button>
    </section>

    <template v-else>
      <header class="fs-st-hero">
        <p class="fs-st-brand"><span aria-hidden="true">药</span>{{ statusData.siteTitle || "药大拾间文件收集" }} · 提交成功名单</p>
        <h1>{{ statusData.title }}</h1>
        <p class="fs-st-desc">这里显示已经成功提交的记录和文件名，文件内容不会在此页面公开。</p>
        <ul class="fs-st-chips">
          <li :class="statusData.status === 'open' ? 'is-open' : 'is-closed'"><span class="fs-st-dot" aria-hidden="true" />{{ statusData.status === "open" ? "正在收集" : "已停止提交" }}</li>
          <li v-if="statusData.deadline"><el-icon aria-hidden="true"><Clock /></el-icon>截止 {{ formatDateTime(statusData.deadline) }}</li>
        </ul>
      </header>

      <section class="fs-st-card fs-st-stats" aria-label="提交统计">
        <div class="fs-st-stat">
          <span>已提交</span>
          <b>{{ statusData.stats.submitted }}</b>
        </div>
        <div class="fs-st-stat">
          <span>应提交</span>
          <b>{{ statusData.stats.expected || "-" }}</b>
        </div>
        <div class="fs-st-stat" :class="{ 'is-warn': statusData.stats.expected && statusData.stats.missing }">
          <span>未提交</span>
          <b>{{ statusData.stats.expected ? statusData.stats.missing : "-" }}</b>
        </div>
        <el-progress
          v-if="statusData.stats.expected"
          class="fs-st-progress"
          :percentage="completion"
          :stroke-width="6"
          :status="completion >= 100 ? 'success' : undefined"
        />
      </section>

      <div class="fs-st-tools">
        <div class="fs-st-search" role="search">
          <el-icon aria-hidden="true"><Search /></el-icon>
          <input v-model="query" type="search" enterkeyhint="search" autocomplete="off" aria-label="搜索成功名单" placeholder="搜索姓名、编号或文件名" @keydown.enter="($event.target as HTMLInputElement).blur()">
        </div>
        <router-link v-if="statusData.status === 'open'" class="fs-st-submit" :to="submitRoute">
          <el-icon aria-hidden="true"><Upload /></el-icon>去提交
        </router-link>
      </div>

      <section class="fs-st-card fs-st-list" aria-label="成功提交记录">
        <article v-for="item in filteredRows" :key="item.id" class="fs-st-item">
          <span class="fs-st-avatar" aria-hidden="true">{{ item.displayName.slice(0, 1) || "#" }}</span>
          <div class="fs-st-item-main">
            <div class="fs-st-person">
              <b>{{ item.displayName }}</b>
              <span>{{ item.identity || `提交 #${item.id}` }}</span>
              <time>{{ formatDateTime(item.createdAt) }}</time>
            </div>
            <ul class="fs-st-files">
              <li v-for="file in item.files" :key="file.storedName">
                <FileBadge :name="file.storedName" :size="24" />
                <span :title="file.storedName">{{ file.storedName }}</span>
                <small>{{ formatBytes(file.size) }}</small>
              </li>
            </ul>
          </div>
        </article>
        <div v-if="!filteredRows.length" class="fs-st-empty">
          <b>{{ statusData.submissions.length ? "没有匹配结果" : "暂无成功提交" }}</b>
          <span>{{ statusData.submissions.length ? "换个关键词再试。" : "提交成功后会显示在这里。" }}</span>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { Clock, Search, Upload, WarningFilled } from "@element-plus/icons-vue";
import { filestoreApi, type FilestorePublicStatus } from "@/api/filestore";
import { formatBytes } from "@/views/services/fileCollectExport";
import FileBadge from "./components/FileBadge.vue";
import { formatDateTime, requestErrorMessage, submitPath } from "./shared";

const route = useRoute();
const loading = ref(false);
const error = ref("");
const statusData = ref<FilestorePublicStatus | null>(null);
const query = ref("");
let loadSeq = 0;

const slug = computed(() => String(route.params.slug || "").trim());
const submitRoute = computed(() => submitPath(slug.value));
const completion = computed(() => {
  const stats = statusData.value?.stats;
  if (!stats?.expected) return 0;
  return Math.min(100, Math.round(((stats.expected - stats.missing) / stats.expected) * 100));
});
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
    const next = await filestoreApi.publicStatus(slug.value);
    if (seq !== loadSeq) return;
    statusData.value = next;
    document.title = `${next.siteTitle || "药大拾间文件收集"} - 提交成功名单`;
  } catch (err) {
    if (seq !== loadSeq) return;
    error.value = requestErrorMessage(err, "成功名单加载失败");
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}
</script>

<style scoped>
.fs-st { display: flex; min-width: 0; max-width: 880px; margin: 0 auto; flex-direction: column; gap: 16px; color: var(--cpu-text); }
.fs-st :is(button, a):focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: 2px; }
.fs-st-card { border: 1px solid var(--cpu-border-soft); border-radius: 16px; background: var(--cpu-card); box-shadow: var(--cpu-shadow-sm); }
.fs-st-pad { padding: 20px; }

.fs-st-state { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 40px 20px 32px; text-align: center; }
.fs-st-state-icon { display: grid; width: 52px; height: 52px; margin-bottom: 6px; place-items: center; border-radius: 16px; background: color-mix(in srgb, var(--cpu-warn) 13%, var(--cpu-card)); color: var(--cpu-warn); font-size: 24px; }
.fs-st-state b { font-size: 17px; font-weight: 700; }
.fs-st-state p { margin: 0 0 10px; color: var(--cpu-text-secondary); font-size: 13px; }

.fs-st-hero { padding: 6px 4px 0; }
.fs-st-brand { display: flex; align-items: center; gap: 8px; margin: 0; color: var(--cpu-text-secondary); font-size: 13px; }
.fs-st-brand span { display: grid; width: 24px; height: 24px; place-items: center; border-radius: 7px; background: var(--cpu-primary); color: #fff; font-size: 13px; font-weight: 800; }
.fs-st-hero h1 { margin: 10px 0 0; font-size: 28px; font-weight: 750; line-height: 1.3; letter-spacing: -.01em; overflow-wrap: anywhere; }
.fs-st-desc { margin: 6px 0 0; color: var(--cpu-text-secondary); font-size: 13px; line-height: 1.6; }
.fs-st-chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0 0; padding: 0; list-style: none; }
.fs-st-chips li { display: inline-flex; min-height: 28px; align-items: center; gap: 6px; padding: 0 11px; border: 1px solid var(--cpu-border-soft); border-radius: 999px; background: var(--cpu-card); color: var(--cpu-text-secondary); font-size: 12px; }
.fs-st-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.fs-st-chips li.is-open { border-color: color-mix(in srgb, var(--cpu-success) 30%, transparent); background: color-mix(in srgb, var(--cpu-success) 10%, var(--cpu-card)); color: color-mix(in srgb, var(--cpu-success) 75%, var(--cpu-text)); font-weight: 600; }
.fs-st-chips li.is-closed { background: var(--cpu-surface-subtle); font-weight: 600; }

.fs-st-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); overflow: hidden; }
.fs-st-stat { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 16px 8px 14px; }
.fs-st-stat + .fs-st-stat { border-left: 1px solid var(--cpu-border-soft); }
.fs-st-stats span { color: var(--cpu-text-muted); font-size: 12px; }
.fs-st-stats b { font-size: 26px; font-weight: 750; font-variant-numeric: tabular-nums; line-height: 1.2; }
.fs-st-stats .is-warn b { color: var(--cpu-warn); }
.fs-st-progress { grid-column: 1 / -1; padding: 0 16px 14px; }
.fs-st-progress :deep(.el-progress__text) { min-width: 40px; font-size: 12px !important; }

.fs-st-tools { display: flex; gap: 10px; }
.fs-st-search { display: flex; height: 42px; min-width: 0; flex: 1; align-items: center; gap: 8px; padding: 0 12px; border: 1px solid var(--cpu-border-soft); border-radius: 13px; background: var(--cpu-card); box-shadow: var(--cpu-shadow-sm); }
.fs-st-search:focus-within { border-color: var(--cpu-primary); }
.fs-st-search > .el-icon { flex: 0 0 auto; color: var(--cpu-text-muted); font-size: 16px; }
.fs-st-search input { min-width: 0; height: 100%; flex: 1; padding: 0; border: 0; outline: 0; background: transparent; color: var(--cpu-text); font: inherit; font-size: 15px; appearance: none; }
.fs-st-search input::placeholder { color: var(--cpu-text-muted); }
.fs-st-submit { display: inline-flex; height: 42px; flex: 0 0 auto; align-items: center; gap: 5px; padding: 0 16px; border-radius: 13px; background: var(--cpu-button-primary); color: var(--cpu-button-on-primary); font-size: 14px; font-weight: 650; text-decoration: none; }

.fs-st-list { overflow: hidden; }
.fs-st-item { display: flex; gap: 12px; padding: 14px 16px; }
.fs-st-item + .fs-st-item { border-top: 1px solid var(--cpu-border-soft); }
.fs-st-avatar { display: grid; width: 36px; height: 36px; flex: 0 0 auto; place-items: center; border-radius: 50%; background: var(--cpu-primary-soft); color: var(--cpu-primary); font-size: 14px; font-weight: 700; }
.fs-st-item-main { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 8px; }
.fs-st-person { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; }
.fs-st-person b { font-size: 15px; font-weight: 650; }
.fs-st-person span { color: var(--cpu-text-secondary); font-family: var(--cpu-font-mono); font-size: 12px; }
.fs-st-person time { margin-left: auto; color: var(--cpu-text-muted); font-size: 12px; }
.fs-st-files { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; }
.fs-st-files li { display: flex; min-width: 0; align-items: center; gap: 8px; font-size: 13px; }
.fs-st-files li span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fs-st-files li small { flex: 0 0 auto; color: var(--cpu-text-muted); font-size: 12px; }
.fs-st-empty { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 40px 16px; color: var(--cpu-text-muted); font-size: 12px; }
.fs-st-empty b { color: var(--cpu-text); font-size: 15px; }

@media (max-width: 768px) {
  .fs-st { gap: 12px; }
  .fs-st-hero { padding: 0 2px; }
  .fs-st-hero h1 { margin-top: 8px; font-size: 23px; }
  .fs-st-stat { padding: 12px 6px 10px; }
  .fs-st-stats b { font-size: 22px; }
  .fs-st-item { padding: 12px; }
  .fs-st-person time { flex-basis: 100%; margin-left: 0; }
  /* 16px 以下 iOS 会在聚焦时放大页面 */
  .fs-st-search input { font-size: 16px; }
}
</style>
