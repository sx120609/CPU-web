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

    <section class="hot-strip announcement-strip" aria-label="校园公告" v-loading="loading && !summary">
      <header><b><el-icon><Notification /></el-icon>校园公告</b><router-link to="/announcements">查看全部 →</router-link></header>
      <button v-for="(topic, index) in announcements" :key="topic.id" type="button" @click="openTopic(topic.id)">
        <span :class="{ top: index === 0 }">{{ index + 1 }}</span>
        <b>{{ topic.title }}</b>
        <small>{{ topic.board?.name || "公告" }} · {{ fmtRelative(topic.createdAt) }}</small>
      </button>
      <p v-if="!loading && !announcements.length" class="strip-empty">暂无校园公告</p>
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
        <div><h1>校园动态</h1><p>{{ activeFeedDescription }}</p></div>
        <router-link :to="activeFeedLink">{{ activeFeedLinkLabel }} →</router-link>
      </header>
      <nav class="feed-tabs" role="tablist" aria-label="校园动态分流">
        <button type="button" role="tab" :aria-selected="activeFeedStream === 'forum'" :class="{ active: activeFeedStream === 'forum' }" @click="selectFeedStream('forum')">
          <el-icon><ChatDotRound /></el-icon>论坛
        </button>
        <button v-if="marketFeedEnabled" type="button" role="tab" :aria-selected="activeFeedStream === 'market'" :class="{ active: activeFeedStream === 'market' }" @click="selectFeedStream('market')">
          <el-icon><Sell /></el-icon>二手
        </button>
      </nav>
      <div v-if="activeFeed.error && !latestTopics.length" class="feed-state">
        <el-empty :description="activeFeed.error"><el-button type="primary" @click="loadFeedPages(activeFeedStream)">重试</el-button></el-empty>
      </div>
      <div v-else class="home-feed-list" v-loading="activeFeed.loading && !latestTopics.length">
        <ForumFeedCard v-for="topic in latestTopics" :key="topic.id" :topic="topic" time-mode="published" />
        <el-empty v-if="!activeFeed.loading && !latestTopics.length" :description="activeFeedEmptyText" />
      </div>
      <div v-if="activeFeed.loadMoreError" class="feed-load-error">
        <span>{{ activeFeed.loadMoreError }}</span><el-button text size="small" @click="loadMore">重试</el-button>
      </div>
      <div v-else-if="canLoadMore" ref="loadMoreSentinelRef" class="feed-load-sentinel">
        <span v-if="activeFeed.loadingMore">正在加载…</span>
      </div>
    </section>

  </div>
</template>

<script setup lang="ts">
import { ChatDotRound, MagicStick, Notification, Sell, Service } from "@element-plus/icons-vue";
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, type Component } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import type { Topic } from "@/api/topic";
import { homeApi, type HomeFeedStream, type HomeSummary } from "@/api/home";
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

type MobileHomeFeedStream = Exclude<HomeFeedStream, "all">;
type HomeFeedRestoreState = {
  scrollY: number;
  page?: number;
  stream?: MobileHomeFeedStream;
  forumPage?: number;
  marketPage?: number;
  savedAt: number;
};

type HomeFeedState = {
  list: Topic[];
  total: number;
  page: number;
  loaded: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string;
  loadMoreError: string;
};

function createFeedState(): HomeFeedState {
  return { list: [], total: 0, page: 1, loaded: false, loading: false, loadingMore: false, error: "", loadMoreError: "" };
}

const auth = useAuthStore();
const site = useSiteStore();
const route = useRoute();
const router = useRouter();
const summary = ref<HomeSummary | null>(null);
const loading = ref(false);
const homeError = ref("");
const mobileHomeAd = ref<ForumAd | null>(null);
const pinnedAd = ref<ForumAd | null>(null);
const hotAd = ref<ForumAd | null>(null);
const activeFeedStream = ref<MobileHomeFeedStream>("forum");
const feedStates = reactive<Record<MobileHomeFeedStream, HomeFeedState>>({
  forum: createFeedState(),
  market: createFeedState(),
});
const feedPageSize = 10;
const loadMoreSentinelRef = ref<HTMLElement | null>(null);
const showForumContent = computed(() => site.features.forum && auth.canAccessForum);
const marketFeedEnabled = computed(() => site.features.market && auth.canAccessForum);
const hotPreview = computed(() => (summary.value?.hotTopics || []).slice(0, 3) as Topic[]);
const pinnedTopics = computed(() => (summary.value?.pinnedTopics || []) as Topic[]);
const activeFeed = computed(() => feedStates[activeFeedStream.value]);
const latestTopics = computed(() => activeFeed.value.list);
const announcements = computed(() => (summary.value?.announce || []).slice(0, 3) as Topic[]);
const canLoadMore = computed(() => showForumContent.value && latestTopics.value.length < activeFeed.value.total);
const activeFeedDescription = computed(() => activeFeedStream.value === "market" ? "闲置转让、求购与二手交流" : "最近发布的讨论与校园内容");
const activeFeedEmptyText = computed(() => activeFeedStream.value === "market" ? "暂时还没有二手信息" : "校园里暂时还没有新动态");
const activeFeedLink = computed(() => activeFeedStream.value === "market" ? "/forum?channel=market" : "/forum");
const activeFeedLinkLabel = computed(() => activeFeedStream.value === "market" ? "进入二手" : "进入论坛");
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
const feedSequences: Record<MobileHomeFeedStream, number> = { forum: 0, market: 0 };
let adSequence = 0;
let mounted = false;
let disposed = false;
let loadObserver: IntersectionObserver | null = null;
let pendingRestoreState: HomeFeedRestoreState | null = null;

onMounted(() => {
  mounted = true;
  pendingRestoreState = readForumListRestoreState<HomeFeedRestoreState>(route.fullPath);
  if (pendingRestoreState?.stream === "market" && marketFeedEnabled.value) activeFeedStream.value = "market";
  loadObserver = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
    if (entry?.isIntersecting && canLoadMore.value && !activeFeed.value.loading && !activeFeed.value.loadingMore && !activeFeed.value.loadMoreError) void loadMore();
  }, { rootMargin: "220px 0px 320px", threshold: .01 });
  void loadHomeScope();
});

watch(homeCacheScope, () => {
  if (!mounted) return;
  pendingRestoreState = null;
  void loadHomeScope();
});

watch(marketFeedEnabled, (enabled) => {
  if (enabled || activeFeedStream.value !== "market") return;
  activeFeedStream.value = "forum";
  if (!feedStates.forum.loaded && !feedStates.forum.loading) void loadFeedPages("forum");
});

watch(canLoadMore, () => void nextTick(observeLoadMore));

onBeforeUnmount(() => {
  disposed = true;
  loadSequence += 1;
  feedSequences.forum += 1;
  feedSequences.market += 1;
  adSequence += 1;
  loadObserver?.disconnect();
});

onBeforeRouteLeave((to) => {
  if (to.name !== "topic" || !latestTopics.value.length) return;
  writeForumListRestoreState<HomeFeedRestoreState>(route.fullPath, {
    scrollY: window.scrollY,
    page: activeFeed.value.page,
    stream: activeFeedStream.value,
    forumPage: feedStates.forum.page,
    marketPage: feedStates.market.page,
  });
});

async function loadHomeScope() {
  const scope = homeCacheScope.value;
  const cached = readHomeSummaryCache(scope);
  summary.value = cached;
  if (!marketFeedEnabled.value) activeFeedStream.value = "forum";
  for (const stream of ["forum", "market"] as const) {
    const state = feedStates[stream];
    const restoredPage = stream === "forum" ? pendingRestoreState?.forumPage : pendingRestoreState?.marketPage;
    state.page = Math.max(1, Number(restoredPage || (pendingRestoreState?.stream === stream ? pendingRestoreState.page : 1) || 1));
    const cachedFeed = readForumLatestFeed(forumCacheScope(auth.user), stream);
    state.list = cachedFeed?.list.slice(0, state.page * feedPageSize) || [];
    state.total = cachedFeed?.total || state.list.length;
    state.loaded = false;
    state.loading = false;
    state.loadingMore = false;
    state.error = "";
    state.loadMoreError = "";
  }
  if (!feedStates.forum.list.length && cached?.latestTopics?.length) {
    feedStates.forum.list = (cached.latestTopics as Topic[])
      .filter((topic) => topic.board?.type !== "market")
      .slice(0, feedPageSize);
    feedStates.forum.total = feedStates.forum.list.length;
  }
  homeError.value = "";
  void loadSummary({ scope, fallback: cached });
  void loadFeedPages(activeFeedStream.value);
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
    if (!feedStates.forum.list.length && !feedStates.forum.loaded) {
      feedStates.forum.list = ((result.latestTopics || []) as Topic[])
        .filter((topic) => topic.board?.type !== "market")
        .slice(0, feedPageSize);
      feedStates.forum.total = feedStates.forum.list.length;
    }
    writeHomeSummaryCache(scope, result);
  } catch (requestError) {
    if (disposed || sequence !== loadSequence) return;
    if (scope === homeCacheScope.value && options.fallback) summary.value = options.fallback;
    if (!summary.value) homeError.value = requestMessage(requestError) || "首页内容加载失败，请稍后重试";
  } finally {
    if (!disposed && sequence === loadSequence) loading.value = false;
  }
}

async function loadFeedPages(stream: MobileHomeFeedStream) {
  if (!showForumContent.value || (stream === "market" && !marketFeedEnabled.value)) return;
  const state = feedStates[stream];
  const sequence = ++feedSequences[stream];
  const targetPage = state.page;
  state.loading = !state.list.length;
  state.error = "";
  state.loadMoreError = "";
  try {
    const pages = await Promise.all(
      Array.from({ length: targetPage }, (_, index) => homeApi.latestFeed(
        { page: index + 1, size: feedPageSize, stream },
        { suppressErrorMessage: true },
      )),
    );
    if (disposed || sequence !== feedSequences[stream]) return;
    state.list = dedupeTopics(pages.flatMap((result) => result.list as Topic[]));
    state.total = pages[0]?.total || state.list.length;
    state.loaded = true;
    writeForumLatestFeed(forumCacheScope(auth.user), {
      pins: pages[0]?.pins || [],
      list: state.list,
      total: state.total,
      page: state.page,
    }, stream);
  } catch (requestError) {
    if (!state.list.length && !disposed && sequence === feedSequences[stream]) {
      state.error = requestMessage(requestError) || (stream === "market" ? "二手信息加载失败，请稍后重试" : "校园动态加载失败，请稍后重试");
    }
  } finally {
    if (!disposed && sequence === feedSequences[stream]) {
      state.loading = false;
      await nextTick();
      if (stream === activeFeedStream.value) {
        await restoreScrollIfNeeded();
        observeLoadMore();
      }
    }
  }
}

async function loadMore() {
  const stream = activeFeedStream.value;
  const state = feedStates[stream];
  if (!canLoadMore.value || state.loadingMore || state.loading) return;
  const sequence = feedSequences[stream];
  const nextPage = state.page + 1;
  state.loadingMore = true;
  state.loadMoreError = "";
  loadObserver?.disconnect();
  try {
    const result = await homeApi.latestFeed(
      { page: nextPage, size: feedPageSize, stream },
      { suppressErrorMessage: true },
    );
    if (disposed || sequence !== feedSequences[stream]) return;
    state.page = nextPage;
    state.list = dedupeTopics([...state.list, ...(result.list as Topic[])]);
    state.total = result.total;
    writeForumLatestFeed(forumCacheScope(auth.user), {
      pins: result.pins || [],
      list: state.list,
      total: state.total,
      page: state.page,
    }, stream);
  } catch (requestError) {
    if (!disposed && sequence === feedSequences[stream]) state.loadMoreError = requestMessage(requestError) || "加载更多失败";
  } finally {
    if (!disposed && sequence === feedSequences[stream]) {
      state.loadingMore = false;
      await nextTick();
      if (stream === activeFeedStream.value) observeLoadMore();
    }
  }
}

function observeLoadMore() {
  loadObserver?.disconnect();
  if (canLoadMore.value && loadMoreSentinelRef.value && !activeFeed.value.loadMoreError) {
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

function selectFeedStream(stream: MobileHomeFeedStream) {
  if (stream === "market" && !marketFeedEnabled.value) return;
  if (activeFeedStream.value === stream) return;
  activeFeedStream.value = stream;
  loadObserver?.disconnect();
  if (!feedStates[stream].loaded && !feedStates[stream].loading) void loadFeedPages(stream);
  void nextTick(observeLoadMore);
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
.hot-strip { padding: 10px 12px; border: 1px solid var(--cpu-border-soft); border-radius: 12px; background: var(--cpu-card); }
.hot-strip header, .section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.hot-strip header { margin-bottom: 4px; }
.hot-strip header b { display: inline-flex; align-items: center; gap: 5px; color: var(--cpu-text); font-size: 13px; }
.announcement-strip { border-color: color-mix(in srgb, var(--cpu-primary) 20%, var(--cpu-border-soft)); box-shadow: var(--cpu-shadow-sm); }
.announcement-strip header .el-icon { color: var(--cpu-primary); font-size: 15px; }
.strip-empty { margin: 8px 0 2px; color: var(--cpu-text-muted); font-size: 11px; text-align: center; }
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
.feed-tabs { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 5px; margin-bottom: 10px; padding: 4px; border: 1px solid var(--cpu-border-soft); border-radius: 11px; background: var(--cpu-card); }
.feed-tabs button { display: inline-flex; min-width: 0; min-height: 36px; align-items: center; justify-content: center; gap: 5px; border: 0; border-radius: 8px; background: transparent; color: var(--cpu-text-secondary); font-size: 13px; font-weight: 700; cursor: pointer; }
.feed-tabs button:hover { color: var(--cpu-primary); }
.feed-tabs button.active { background: var(--cpu-primary); box-shadow: 0 4px 12px color-mix(in srgb, var(--cpu-primary) 20%, transparent); color: #fff; }
.feed-tabs button:focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: 2px; }
.home-feed-list { display: flex; min-height: 140px; flex-direction: column; gap: 8px; }
.feed-state { min-height: 140px; }
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
  .home-feed { margin-inline: -4px; padding: 10px 8px; border-radius: 12px; }
  .home-feed-list { gap: 7px; }
}
@media (max-width: 420px) {
  .quick-grid { grid-template-columns: repeat(5, minmax(54px, 1fr)); overflow-x: auto; scrollbar-width: none; }
  .quick-grid::-webkit-scrollbar { display: none; }
}
</style>
