<template>
  <div class="home-stream">
    <section class="home-entry" aria-label="首页快捷入口">
      <SiteSearchBar placeholder="搜索帖子或校园服务" />
      <nav class="quick-grid">
        <button v-for="entry in quickEntries" :key="entry.label" type="button" @click="openQuickEntry(entry.to)">
          <span class="quick-icon">{{ entry.icon }}</span>
          <span>{{ entry.label }}</span>
        </button>
      </nav>
    </section>

    <section v-if="showForumContent && hotPreview.length" class="hot-strip" aria-label="今日热议">
      <header><b>今日热议</b><router-link to="/forum?channel=hot">查看全部 →</router-link></header>
      <button v-for="(topic, index) in hotPreview" :key="topic.id" type="button" @click="openTopic(topic.id)">
        <span :class="{ top: index < 3 }">{{ index + 1 }}</span>
        <b>{{ topic.title }}</b>
        <small>{{ topic.board?.name }}</small>
      </button>
    </section>

    <PinnedTopicStrip v-if="showForumContent" :topics="pinnedTopics" />
    <ForumAdCard v-if="pinnedAd" :ad="pinnedAd" compact />
    <ForumAdCard v-if="hotAd" :ad="hotAd" compact />

    <section v-if="homeError && !summary" class="home-state">
      <el-empty :description="homeError"><el-button type="primary" @click="loadSummary()">重试</el-button></el-empty>
    </section>

    <section v-else-if="showForumContent" class="home-feed" v-loading="loading && !summary">
      <header class="section-head">
        <div><h1>校园动态</h1><p>最近发布的校园内容</p></div>
        <router-link to="/forum">进入信息流 →</router-link>
      </header>
      <div class="home-feed-list">
        <ForumFeedCard v-for="topic in latestTopics" :key="topic.id" :topic="topic" />
        <el-empty v-if="!loading && !latestTopics.length" description="校园里暂时还没有新动态" />
      </div>
      <router-link v-if="latestTopics.length" class="more-feed" to="/forum">继续查看全部动态</router-link>
    </section>

    <section v-else class="official-feed" v-loading="loading && !summary">
      <header class="section-head">
        <div><h1>校园公告</h1><p>学校公开信息</p></div>
        <router-link to="/announcements">查看全部 →</router-link>
      </header>
      <button v-for="topic in announcements" :key="topic.id" type="button" @click="openTopic(topic.id)">
        <b>{{ topic.title }}</b><span>{{ topic.board?.name }} · {{ fmtRelative(topic.createdAt) }}</span>
      </button>
      <el-empty v-if="!loading && !announcements.length" description="暂无校园公告" />
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import type { Topic } from "@/api/topic";
import { homeApi, type HomeSummary } from "@/api/home";
import { forumAdsApi, type ForumAd } from "@/api/forumAds";
import ForumAdCard from "@/components/forum/ForumAdCard.vue";
import ForumFeedCard from "@/components/forum/ForumFeedCard.vue";
import PinnedTopicStrip from "@/components/forum/PinnedTopicStrip.vue";
import SiteSearchBar from "@/components/search/SiteSearchBar.vue";
import { useAuthStore } from "@/stores/auth";
import { useSiteStore } from "@/stores/site";
import { fmtRelative } from "@/utils/format";
import { readHomeSummaryCache, writeHomeSummaryCache } from "@/utils/homeCache";

const auth = useAuthStore();
const site = useSiteStore();
const router = useRouter();
const summary = ref<HomeSummary | null>(null);
const loading = ref(false);
const homeError = ref("");
const pinnedAd = ref<ForumAd | null>(null);
const hotAd = ref<ForumAd | null>(null);
const showForumContent = computed(() => site.features.forum && auth.canAccessForum);
const hotPreview = computed(() => (summary.value?.hotTopics || []).slice(0, 3) as Topic[]);
const pinnedTopics = computed(() => (summary.value?.pinnedTopics || []) as Topic[]);
const latestTopics = computed(() => (summary.value?.latestTopics || []).slice(0, 10) as Topic[]);
const announcements = computed(() => (summary.value?.announce || []).slice(0, 8) as Topic[]);
const quickEntries = computed(() => [
  showForumContent.value ? { icon: "💬", label: "论坛", to: "/forum" } : null,
  { icon: "📢", label: "公告", to: "/announcements" },
  site.features.market && auth.canAccessForum ? { icon: "♻️", label: "二手", to: "/market" } : null,
  { icon: "🧭", label: "服务", to: "/services" },
  { icon: "✨", label: "拾间AI", to: "/search" },
].filter(Boolean) as Array<{ icon: string; label: string; to: string }>);
const homeCacheScope = computed(() => {
  const identity = auth.user?.id ? `user-${auth.user.id}` : "guest";
  return `${identity}:forum-${auth.canAccessForum ? "on" : "off"}`;
});
let loadSequence = 0;
let adSequence = 0;
let mounted = false;

onMounted(() => {
  mounted = true;
  void loadHomeScope();
});

watch(homeCacheScope, () => {
  if (mounted) void loadHomeScope();
});

async function loadHomeScope() {
  const scope = homeCacheScope.value;
  const cached = readHomeSummaryCache(scope);
  summary.value = cached;
  homeError.value = "";
  void loadSummary({ scope, fallback: cached });
  void loadAds();
}

async function loadAds() {
  const sequence = ++adSequence;
  try {
    const [pinned, hot] = await Promise.all([
      forumAdsApi.list("forum-home-pinned"),
      forumAdsApi.list("forum-home-hot"),
    ]);
    if (sequence !== adSequence) return;
    pinnedAd.value = pinned[0] || null;
    hotAd.value = hot[0] || null;
  } catch {
    if (sequence !== adSequence) return;
    pinnedAd.value = null;
    hotAd.value = null;
  }
}

async function loadSummary(options: { scope?: string; fallback?: HomeSummary | null } = {}) {
  const scope = options.scope || homeCacheScope.value;
  const sequence = ++loadSequence;
  loading.value = !summary.value;
  homeError.value = "";
  try {
    const result = await homeApi.summary({ suppressErrorMessage: true, cacheTtlMs: 0 });
    if (sequence !== loadSequence || scope !== homeCacheScope.value) return;
    summary.value = result;
    writeHomeSummaryCache(scope, result);
  } catch (requestError) {
    if (sequence !== loadSequence) return;
    if (scope === homeCacheScope.value && options.fallback) summary.value = options.fallback;
    if (!summary.value) homeError.value = requestMessage(requestError) || "首页内容加载失败，请稍后重试";
  } finally {
    if (sequence === loadSequence) loading.value = false;
  }
}

function openQuickEntry(to: string) { void router.push(to); }
function openTopic(id: number) { void router.push(`/forum/topic/${id}`); }
function requestMessage(requestError: unknown) {
  return (requestError as { response?: { data?: { message?: string } } })?.response?.data?.message || "";
}
</script>

<style scoped>
.home-stream { display: flex; max-width: 860px; margin: 0 auto; flex-direction: column; gap: 13px; }
.home-entry { padding: 12px; border: 1px solid var(--cpu-border-soft); border-radius: 15px; background: var(--cpu-card); box-shadow: var(--cpu-shadow-sm); }
.quick-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 7px; margin-top: 10px; }
.quick-grid button { display: flex; min-width: 0; min-height: 66px; flex-direction: column; align-items: center; justify-content: center; gap: 5px; padding: 7px 4px; border: 1px solid var(--cpu-border-soft); border-radius: 11px; background: var(--cpu-surface-soft); color: var(--cpu-text-secondary); font-size: 11px; font-weight: 650; cursor: pointer; }
.quick-grid button:hover { border-color: var(--cpu-primary); color: var(--cpu-primary); }
.quick-grid button:focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: 2px; }
.quick-icon { font-size: 21px; line-height: 1; }
.hot-strip { padding: 10px 12px; border: 1px solid var(--cpu-border-soft); border-radius: 12px; background: var(--cpu-card); }
.hot-strip header, .section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.hot-strip header { margin-bottom: 4px; }
.hot-strip header b { color: var(--cpu-text); font-size: 13px; }
.hot-strip a, .section-head a { color: var(--cpu-primary); font-size: 11px; text-decoration: none; }
.hot-strip button { display: grid; width: 100%; grid-template-columns: 20px minmax(0, 1fr) auto; align-items: center; gap: 7px; padding: 6px 1px; border: 0; border-top: 1px dashed var(--cpu-border-soft); background: transparent; color: inherit; text-align: left; cursor: pointer; }
.hot-strip button > span { color: var(--cpu-text-muted); font-size: 10px; font-weight: 800; text-align: center; }
.hot-strip button > span.top { color: #dc2626; }
.hot-strip button b { overflow: hidden; color: var(--cpu-text); font-size: 12px; font-weight: 580; text-overflow: ellipsis; white-space: nowrap; }
.hot-strip button small { max-width: 90px; overflow: hidden; color: var(--cpu-text-muted); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.home-feed, .official-feed { padding: 14px; border: 1px solid var(--cpu-border-soft); border-radius: 15px; background: color-mix(in srgb, var(--cpu-surface-soft) 58%, var(--cpu-card)); }
.section-head { align-items: flex-end; padding: 0 2px 11px; }
.section-head h1 { margin: 0; color: var(--cpu-text); font-size: 18px; }
.section-head p { margin: 3px 0 0; color: var(--cpu-text-muted); font-size: 10px; }
.home-feed-list { display: flex; min-height: 140px; flex-direction: column; gap: 8px; }
.more-feed { display: flex; min-height: 38px; align-items: center; justify-content: center; margin-top: 9px; border-radius: 9px; background: var(--cpu-surface-soft); color: var(--cpu-primary); font-size: 11px; font-weight: 650; text-decoration: none; }
.official-feed > button { display: flex; width: 100%; flex-direction: column; gap: 3px; padding: 10px 3px; border: 0; border-top: 1px dashed var(--cpu-border-soft); background: transparent; color: inherit; text-align: left; cursor: pointer; }
.official-feed > button b { color: var(--cpu-text); font-size: 13px; }
.official-feed > button span { color: var(--cpu-text-muted); font-size: 10px; }
.home-state { padding: 28px 12px; border-radius: 14px; background: var(--cpu-card); }
@media (max-width: 640px) {
  .home-stream { gap: 10px; }
  .home-entry { padding: 9px; border-radius: 13px; }
  .quick-grid { gap: 5px; }
  .quick-grid button { min-height: 58px; border-radius: 9px; }
  .quick-icon { font-size: 18px; }
  .hot-strip { padding: 9px 10px; }
  .home-feed, .official-feed { margin-inline: -4px; padding: 10px 8px; border-radius: 12px; }
  .home-feed-list { gap: 7px; }
}
@media (max-width: 420px) {
  .quick-grid { grid-template-columns: repeat(5, minmax(54px, 1fr)); overflow-x: auto; scrollbar-width: none; }
  .quick-grid::-webkit-scrollbar { display: none; }
}
</style>
