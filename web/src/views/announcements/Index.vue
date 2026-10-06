<template>
  <div class="pk-page pk-page--narrow announce-page" :aria-busy="loading">
    <header class="pk-head">
      <div class="pk-title">
        <span class="pk-tile" style="--tone: #1d4d8a" aria-hidden="true"><AppIcon name="announcement" /></span>
        <div class="pk-title-copy">
          <h1>校园公告</h1>
          <p>整理学校公开渠道的公告入口</p>
        </div>
      </div>
    </header>

    <!-- 错误态：网络失败 / 后端 5xx -->
    <section v-if="!loading && error" class="pk-card">
      <el-empty :description="error"><el-button type="primary" @click="reload">重试</el-button></el-empty>
    </section>
    <section v-else-if="loading && !boards.length" class="pk-card"><div class="pk-empty" role="status">正在加载公告来源…</div></section>
    <!-- 空态 -->
    <section v-else-if="!boards.length" class="pk-card"><el-empty description="暂无公告来源" /></section>
    <!-- 列表：router-link 直接跳转，避免 div+click 在移动端偶尔不响应 -->
    <ul v-else class="pk-card pk-card--flush pk-rows">
      <li v-for="b in boards" :key="b.slug">
        <router-link :to="`/forum/b/${b.slug}`" class="pk-row announce-row">
          <span class="pk-tile" :style="{ '--tone': b.color || '#1d4d8a' }" aria-hidden="true"><AppIcon :legacy="b.icon" name="announcement" /></span>
          <span class="pk-row-copy">
            <b>{{ b.name }}<em class="pk-badge">{{ b.topicCount }} 条</em></b>
            <small v-if="b.description" class="announce-desc">{{ b.description }}</small>
            <small v-if="b.feedSource?.homepage || b.feedSource?.lastRunAt">
              <template v-if="b.feedSource?.homepage">同步自 {{ shortHost(b.feedSource.homepage) }}</template>
              <template v-if="b.feedSource?.lastRunAt"> · 最近更新 {{ fmtRelative(b.feedSource.lastRunAt) }}</template>
            </small>
          </span>
          <el-icon class="pk-row-end" aria-hidden="true"><Right /></el-icon>
        </router-link>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { Right } from "@element-plus/icons-vue";
import { boardApi, type Board } from "@/api/board";
import { fmtRelative } from "@/utils/format";
import AppIcon from "@/components/common/AppIcon.vue";
import "@/styles/page-kit.css";

const all = ref<Board[]>([]);
const loading = ref(false);
const error = ref("");
const hiddenAnnouncementSlugs = new Set(["xinli-notice"]);
let loadSeq = 0;

onMounted(reload);

async function reload() {
  const seq = ++loadSeq;
  loading.value = true;
  error.value = "";
  try {
    const next = await boardApi.list({ suppressErrorMessage: true });
    if (seq !== loadSeq) return;
    all.value = next;
  } catch (error_) {
    if (seq !== loadSeq) return;
    error.value = normalizeAnnouncementsError(error_);
    all.value = [];
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

const boards = computed(() => all.value.filter((b) =>
  b.type === "announce" &&
  !hiddenAnnouncementSlugs.has(b.slug) &&
  !b.name.includes("心理动态")
));

function shortHost(url?: string) {
  if (!url) return "";
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch { return url; }
}

function normalizeAnnouncementsError(error_: unknown) {
  const status = (error_ as { response?: { status?: number; data?: { message?: string } } })?.response?.status;
  if (status && status < 500) {
    return (error_ as { response?: { data?: { message?: string } } })?.response?.data?.message || "公告来源加载失败";
  }
  return "公告来源加载失败，请稍后再试";
}
</script>

<style scoped>
.announce-row { min-height: 72px; padding-block: 12px; }
.announce-row b { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font-size: 15px; }
.announce-desc { color: var(--cpu-text-secondary); }
@media (hover: hover) {
  .announce-row:hover { background: var(--cpu-surface-soft); }
}
</style>
