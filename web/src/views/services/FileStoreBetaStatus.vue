<template>
  <div class="filestore-beta-legacy">
    <main class="submit-shell status-shell">
      <section class="submit-card status-card">
        <div class="submit-brandbar">
          <div class="submit-brand">
            <span class="brand-mark">药</span>
            <div>
              <strong>{{ statusData?.siteTitle || "药大拾间文件收集" }}</strong>
              <small>CPU 校园互助服务 · 成功提交名单</small>
            </div>
          </div>
          <span class="submit-brand-tag">校园小工具</span>
        </div>
        <div class="submit-hero">
          <p class="eyebrow">药大拾间 · 成功提交名单</p>
          <h1>{{ statusData?.title || (loading ? "加载成功名单中" : "无法查看") }}</h1>
          <p>{{ statusData ? "这里显示已经成功提交的记录和文件名。文件内容不会在此页面公开。" : (error || "请稍候。") }}</p>
          <p v-if="statusData?.deadline" class="hint hero-deadline">截止时间：{{ formatDateTime(statusData.deadline) }}</p>
        </div>

        <section v-if="statusData" class="status-body">
          <div class="summary-grid status-summary">
            <div class="metric">
              <span>已提交</span>
              <b>{{ statusData.stats.submitted }}</b>
              <small>成功记录数</small>
            </div>
            <div class="metric">
              <span>应提交</span>
              <b>{{ statusData.stats.expected || "-" }}</b>
              <small>{{ statusData.stats.expected ? "来自名单行数" : "未设置名单" }}</small>
            </div>
            <div class="metric">
              <span>未提交</span>
              <b>{{ statusData.stats.missing }}</b>
              <small>{{ statusData.stats.expected ? "名单内尚未提交" : "未设置名单" }}</small>
            </div>
          </div>
          <div class="status-tools">
            <button type="button" class="chip" @click="goSubmit">返回提交</button>
            <input v-model="query" placeholder="搜索姓名、编号或文件名">
          </div>
          <div class="status-list">
            <article v-for="item in filteredRows" :key="item.id" class="status-item">
              <div class="status-person">
                <strong>{{ item.displayName }}</strong>
                <span>{{ item.identity || `提交 #${item.id}` }} · {{ formatDateTime(item.createdAt) }}</span>
              </div>
              <div class="status-files">
                <div v-for="file in item.files" :key="file.storedName" class="status-file">
                  <strong>{{ file.storedName }}</strong>
                  <span>{{ formatBytes(file.size) }}</span>
                </div>
              </div>
            </article>
            <div v-if="!filteredRows.length" class="table-empty">
              <strong>{{ statusData.submissions.length ? "没有匹配结果" : "暂无成功提交" }}</strong>
              <span>{{ statusData.submissions.length ? "换个关键词再试。" : "提交成功后会显示在这里。" }}</span>
            </div>
          </div>
        </section>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { filestoreBetaApi, type FilestoreBetaPublicStatus } from "@/api/filestoreBeta";
import {
  formatDateTime,
  requestErrorMessage,
  useScopedLegacyFilestoreCss,
} from "@/views/services/filestoreBetaShared";
import { formatBytes } from "@/views/services/fileCollectExport";

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const error = ref("");
const statusData = ref<FilestoreBetaPublicStatus | null>(null);
const query = ref("");
let loadSeq = 0;

useScopedLegacyFilestoreCss();

const slug = computed(() => String(route.params.slug || "").trim());
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
    document.title = `${next.siteTitle || "药大拾间文件收集"} - 提交成功名单`;
  } catch (err) {
    if (seq !== loadSeq) return;
    error.value = requestErrorMessage(err, "成功名单加载失败");
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

function goSubmit() {
  router.push(`/services/tools/filestore-beta/submit/${slug.value}`);
}
</script>
