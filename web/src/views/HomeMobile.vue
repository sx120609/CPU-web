<template>
  <div class="home-stream">
    <section class="home-entry" aria-label="首页快捷入口">
      <SiteSearchBar placeholder="搜索帖子或校园服务" />
      <nav class="quick-grid">
        <button v-for="entry in quickEntries" :key="entry.label" type="button" @click="openQuickEntry(entry.to)">
          <span class="quick-icon" aria-hidden="true"><el-icon><component :is="entry.icon" /></el-icon></span>
          <span>{{ entry.label }}</span>
        </button>
      </nav>
    </section>

    <ForumAdCard v-if="mobileHomeAd" :ad="mobileHomeAd" compact />

    <section class="announcement-panel" aria-label="校园公告" v-loading="loading && !summary">
      <header class="announcement-head">
        <div class="announcement-heading">
          <span class="announcement-icon" aria-hidden="true"><el-icon><Notification /></el-icon></span>
          <div><h2>校园公告</h2><p>学校最新公开信息</p></div>
        </div>
        <router-link to="/announcements">全部公告 →</router-link>
      </header>
      <div v-if="announcements.length" class="announcement-list">
        <button v-for="(topic, index) in announcements" :key="topic.id" type="button" @click="openTopic(topic.id)">
          <span class="announcement-marker" :class="{ latest: index === 0 }" aria-hidden="true"></span>
          <span class="announcement-copy">
            <b>{{ topic.title }}</b>
            <small>{{ topic.board?.name || "校园公告" }} · {{ fmtRelative(topic.createdAt) }}</small>
          </span>
          <span class="announcement-arrow" aria-hidden="true">›</span>
        </button>
      </div>
      <el-empty v-else-if="!loading" :image-size="54" description="暂无校园公告" />
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
        <ForumFeedCard v-for="topic in latestTopics" :key="topic.id" :topic="topic" time-mode="published" />
        <el-empty v-if="!loading && !latestTopics.length" description="校园里暂时还没有新动态" />
      </div>
      <div v-if="loadMoreError" class="feed-load-error">
        <span>{{ loadMoreError }}</span><el-button text size="small" @click="loadMore">重试</el-button>
      </div>
      <div v-else-if="canLoadMore" ref="loadMoreSentinelRef" class="feed-load-sentinel">
        <span v-if="loadingMore">正在加载…</span>
      </div>
    </section>

  </div>
</template>

<script setup lang="ts">
import { ChatDotRound, MagicStick, Notification, Sell, Service } from "@element-plus/icons-vue";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
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
import { forumCacheScope, readForumLatestFeed, writeForumLatestFeed } from "@/utils/forumCache";
import { clearForumListRestoreState, readForumListRestoreState, writeForumListRestoreState } from "@/utils/forumListRestore";
import { readHomeSummaryCache, writeHomeSummaryCache } from "@/utils/homeCache";

type HomeFeedRestoreState = {
  scrollY: number;
  page?: number;
  savedAt: number;
};

const auth = useAuthStore();
const site = useSiteStore();
const route = useRoute();
const router = useRouter();
const summary = ref<HomeSummary | null>(null);
const loading = ref(false);
const loadingMore = ref(false);
const homeError = ref("");
const loadMoreError = ref("");
const mobileHomeAd = ref<ForumAd | null>(null);
const pinnedAd = ref<ForumAd | null>(null);
const hotAd = ref<ForumAd | null>(null);
const feedTopics = ref<Topic[]>([]);
const feedTotal = ref(0);
const feedPage = ref(1);
const feedPageSize = 10;
const loadMoreSentinelRef = ref<HTMLElement | null>(null);
const showForumContent = computed(() => site.features.forum && auth.canAccessForum);
const hotPreview = computed(() => (summary.value?.hotTopics || []).slice(0, 3) as Topic[]);
const pinnedTopics = computed(() => (summary.value?.pinnedTopics || []) as Topic[]);
const latestTopics = computed(() => feedTopics.value);
const announcements = computed(() => (summary.value?.announce || []).slice(0, 4) as Topic[]);
const canLoadMore = computed(() => showForumContent.value && feedTopics.value.length < feedTotal.value);
const quickEntries = computed(() => [
  showForumContent.value ? { icon: ChatDotRound, label: "论坛", to: "/forum" } : null,
  { icon: Notification, label: "公告", to: "/announcements" },
  site.features.market && auth.canAccessForum ? { icon: Sell, label: "二手", to: "/forum?channel=market" } : null,
  { icon: Service, label: "服务", to: "/services" },
  { icon: MagicStick, label: "拾间AI", to: "/search" },
].filter(Boolean) as Array<{ icon: Component; label: string; to: string }>);
const homeCacheScope = computed(() => {
  const identity = auth.user?.id ? `user-${auth.user.id}` : "guest";
  return `${identity}:forum-${auth.canAccessForum ? "on" : "off"}`;
});
let loadSequence = 0;
let feedSequence = 0;
let adSequence = 0;
let mounted = false;
let disposed = false;
let loadObserver: IntersectionObserver | null = null;
let pendingRestoreState: HomeFeedRestoreState | null = null;

onMounted(() => {
  mounted = true;
  pendingRestoreState = readForumListRestoreState<HomeFeedRestoreState>(route.fullPath);
  loadObserver = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
    if (entry?.isIntersecting && canLoadMore.value && !loading.value && !loadingMore.value && !loadMoreError.value) void loadMore();
  }, { rootMargin: "220px 0px 320px", threshold: .01 });
  void loadHomeScope();
});

watch(homeCacheScope, () => {
  if (!mounted) return;
  pendingRestoreState = null;
  void loadHomeScope();
});

watch(canLoadMore, () => void nextTick(observeLoadMore));

onBeforeUnmount(() => {
  disposed = true;
  loadSequence += 1;
  feedSequence += 1;
  adSequence += 1;
  loadObserver?.disconnect();
});

onBeforeRouteLeave((to) => {
  if (to.name !== "topic" || !feedTopics.value.length) return;
  writeForumListRestoreState(route.fullPath, {
    scrollY: window.scrollY,
    page: feedPage.value,
  });
});

async function loadHomeScope() {
  const scope = homeCacheScope.value;
  const cached = readHomeSummaryCache(scope);
  summary.value = cached;
  feedPage.value = Math.max(1, Number(pendingRestoreState?.page || 1));
  const cachedFeed = readForumLatestFeed(forumCacheScope(auth.user));
  feedTopics.value = cachedFeed?.list.slice(0, feedPage.value * feedPageSize)
    || (cached?.latestTopics || []).slice(0, feedPageSize) as Topic[];
  feedTotal.value = cachedFeed?.total || feedTopics.value.length;
  loadMoreError.value = "";
  homeError.value = "";
  void loadSummary({ scope, fallback: cached });
  void loadFeedPages();
  void loadAds();
}

async function loadAds() {
  const sequence = ++adSequence;
  try {
    const [mobileHome, pinned, hot] = await Promise.all([
      forumAdsApi.list("home-mobile-top").catch(() => []),
      forumAdsApi.list("forum-home-pinned").catch(() => []),
      forumAdsApi.list("forum-home-hot").catch(() => []),
    ]);
    if (sequence !== adSequence) return;
    mobileHomeAd.value = mobileHome[0] || null;
    pinnedAd.value = pinned[0] || null;
    hotAd.value = hot[0] || null;
  } catch {
    if (sequence !== adSequence) return;
    mobileHomeAd.value = null;
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
    if (disposed || sequence !== loadSequence || scope !== homeCacheScope.value) return;
    summary.value = result;
    if (!feedTopics.value.length) feedTopics.value = (result.latestTopics || []).slice(0, feedPageSize) as Topic[];
    writeHomeSummaryCache(scope, result);
  } catch (requestError) {
    if (disposed || sequence !== loadSequence) return;
    if (scope === homeCacheScope.value && options.fallback) summary.value = options.fallback;
    if (!summary.value) homeError.value = requestMessage(requestError) || "首页内容加载失败，请稍后重试";
  } finally {
    if (!disposed && sequence === loadSequence) loading.value = false;
  }
}

async function loadFeedPages() {
  if (!showForumContent.value) return;
  const sequence = ++feedSequence;
  const targetPage = feedPage.value;
  try {
    const pages = await Promise.all(
      Array.from({ length: targetPage }, (_, index) => homeApi.latestFeed(
        { page: index + 1, size: feedPageSize },
        { suppressErrorMessage: true },
      )),
    );
    if (disposed || sequence !== feedSequence) return;
    feedTopics.value = dedupeTopics(pages.flatMap((result) => result.list as Topic[]));
    feedTotal.value = pages[0]?.total || feedTopics.value.length;
    writeForumLatestFeed(forumCacheScope(auth.user), {
      pins: pages[0]?.pins || [],
      list: feedTopics.value,
      total: feedTotal.value,
      page: feedPage.value,
    });
  } catch (requestError) {
    if (!feedTopics.value.length && !disposed && sequence === feedSequence) {
      homeError.value = requestMessage(requestError) || "校园动态加载失败，请稍后重试";
    }
  } finally {
    if (!disposed && sequence === feedSequence) {
      await nextTick();
      await restoreScrollIfNeeded();
      observeLoadMore();
    }
  }
}

async function loadMore() {
  if (!canLoadMore.value || loadingMore.value) return;
  const sequence = feedSequence;
  const nextPage = feedPage.value + 1;
  loadingMore.value = true;
  loadMoreError.value = "";
  loadObserver?.disconnect();
  try {
    const result = await homeApi.latestFeed(
      { page: nextPage, size: feedPageSize },
      { suppressErrorMessage: true },
    );
    if (disposed || sequence !== feedSequence) return;
    feedPage.value = nextPage;
    feedTopics.value = dedupeTopics([...feedTopics.value, ...(result.list as Topic[])]);
    feedTotal.value = result.total;
    writeForumLatestFeed(forumCacheScope(auth.user), {
      pins: result.pins || [],
      list: feedTopics.value,
      total: feedTotal.value,
      page: feedPage.value,
    });
  } catch (requestError) {
    if (!disposed && sequence === feedSequence) loadMoreError.value = requestMessage(requestError) || "加载更多失败";
  } finally {
    if (!disposed && sequence === feedSequence) {
      loadingMore.value = false;
      await nextTick();
      observeLoadMore();
    }
  }
}

function observeLoadMore() {
  loadObserver?.disconnect();
  if (canLoadMore.value && loadMoreSentinelRef.value && !loadMoreError.value) {
    loadObserver?.observe(loadMoreSentinelRef.value);
  }
}

async function restoreScrollIfNeeded() {
  if (!pendingRestoreState) return;
  const scrollY = Math.max(0, Number(pendingRestoreState.scrollY || 0));
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.scrollTo({ top: scrollY, behavior: "auto" });
      resolve();
    }));
  });
  clearForumListRestoreState(route.fullPath);
  pendingRestoreState = null;
}

function dedupeTopics(items: Topic[]) {
  const seen = new Set<number>();
  return items.filter((topic) => {
    if (seen.has(topic.id)) return false;
    seen.add(topic.id);
    return true;
  });
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
.quick-icon { display: grid; width: 24px; height: 24px; place-items: center; color: var(--cpu-primary); line-height: 1; }
.quick-icon :deep(.el-icon) { width: 22px; height: 22px; font-size: 22px; }
.announcement-panel { overflow: hidden; border: 1px solid color-mix(in srgb, var(--cpu-primary) 22%, var(--cpu-border-soft)); border-radius: 15px; background: var(--cpu-card); box-shadow: var(--cpu-shadow-sm); }
.announcement-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 13px 10px; background: linear-gradient(135deg, color-mix(in srgb, var(--cpu-primary) 10%, var(--cpu-card)), var(--cpu-card)); }
.announcement-heading { display: flex; min-width: 0; align-items: center; gap: 9px; }
.announcement-icon { display: grid; width: 32px; height: 32px; flex: 0 0 32px; place-items: center; border-radius: 10px; background: var(--cpu-primary); color: #fff; font-size: 18px; }
.announcement-heading h2 { margin: 0; color: var(--cpu-text); font-size: 16px; line-height: 1.2; }
.announcement-heading p { margin: 3px 0 0; color: var(--cpu-text-muted); font-size: 10px; }
.announcement-head a { flex: 0 0 auto; color: var(--cpu-primary); font-size: 11px; font-weight: 650; text-decoration: none; }
.announcement-list { padding: 0 12px 5px; }
.announcement-list button { display: grid; width: 100%; grid-template-columns: 8px minmax(0, 1fr) 14px; align-items: center; gap: 8px; padding: 10px 1px; border: 0; border-top: 1px dashed var(--cpu-border-soft); background: transparent; color: inherit; text-align: left; cursor: pointer; }
.announcement-list button:focus-visible { border-radius: 7px; outline: 2px solid var(--cpu-primary); outline-offset: 1px; }
.announcement-marker { width: 6px; height: 6px; border-radius: 50%; background: var(--cpu-border); }
.announcement-marker.latest { background: #f59e0b; box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.14); }
.announcement-copy { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
.announcement-copy b { overflow: hidden; color: var(--cpu-text); font-size: 13px; font-weight: 620; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
.announcement-copy small { overflow: hidden; color: var(--cpu-text-muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.announcement-arrow { color: var(--cpu-text-muted); font-size: 20px; line-height: 1; text-align: right; }
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
.home-feed { padding: 14px; border: 1px solid var(--cpu-border-soft); border-radius: 15px; background: color-mix(in srgb, var(--cpu-surface-soft) 58%, var(--cpu-card)); }
.section-head { align-items: flex-end; padding: 0 2px 11px; }
.section-head h1 { margin: 0; color: var(--cpu-text); font-size: 18px; }
.section-head p { margin: 3px 0 0; color: var(--cpu-text-muted); font-size: 10px; }
.home-feed-list { display: flex; min-height: 140px; flex-direction: column; gap: 8px; }
.feed-load-sentinel, .feed-load-error { display: flex; min-height: 42px; align-items: center; justify-content: center; gap: 6px; color: var(--cpu-text-muted); font-size: 11px; }
.feed-load-error { color: var(--cpu-danger); }
.home-state { padding: 28px 12px; border-radius: 14px; background: var(--cpu-card); }
@media (max-width: 640px) {
  .home-stream { gap: 10px; }
  .home-entry { padding: 9px; border-radius: 13px; }
  .quick-grid { gap: 5px; }
  .quick-grid button { min-height: 58px; border-radius: 9px; }
  .quick-icon { width: 22px; height: 22px; }
  .quick-icon :deep(.el-icon) { width: 20px; height: 20px; font-size: 20px; }
  .hot-strip { padding: 9px 10px; }
  .announcement-head { padding: 11px 11px 9px; }
  .announcement-list { padding-inline: 10px; }
  .home-feed { margin-inline: -4px; padding: 10px 8px; border-radius: 12px; }
  .home-feed-list { gap: 7px; }
}
@media (max-width: 420px) {
  .quick-grid { grid-template-columns: repeat(5, minmax(54px, 1fr)); overflow-x: auto; scrollbar-width: none; }
  .quick-grid::-webkit-scrollbar { display: none; }
}
</style>
