<template>
  <div class="home-stream">
    <section class="home-entry" aria-label="首页快捷入口">
      <SiteSearchBar
        :placeholder="showForumContent ? '搜索帖子或校园服务' : '搜索校园服务'"
        :scope="showForumContent ? 'all' : 'services'"
      />
      <nav class="quick-grid" :class="{ 'quick-grid--services': !showForumContent }">
        <button data-cpu-button="surface" v-for="entry in quickEntries" :key="entry.label" type="button" :data-hue="entry.hue" @click="openQuickEntry(entry.to)">
          <span class="quick-icon" aria-hidden="true"><el-icon><component :is="entry.icon" /></el-icon></span>
          <span>{{ entry.label }}</span>
        </button>
      </nav>
      <p v-if="nativeForumRestricted && !auth.forumHidden" class="forum-access-note">
        <el-icon aria-hidden="true"><Lock /></el-icon>
        <span>论坛仅限连接内网后使用</span>
      </p>
    </section>

    <ForumAdCarousel v-if="showForumContent && mobileHomeAds.length" :ads="mobileHomeAds" compact />

    <section v-if="showForumContent && hotPreview.length" class="hot-strip" aria-label="热榜">
      <header><b><AppIcon name="hot" />热榜</b><router-link to="/forum?channel=hot">查看全部<el-icon><ArrowRight /></el-icon></router-link></header>
      <button data-cpu-button="surface" v-for="(topic, index) in hotPreview" :key="topic.id" type="button" @click="openTopic(topic.id)">
        <span class="hot-rank" :class="{ top: index === 0 }">{{ index + 1 }}</span>
        <b>{{ topic.title }}</b>
        <small v-if="topic.board?.name">{{ topic.board.name }}</small>
      </button>
    </section>

    <section v-if="!showForumContent" class="campus-services" v-loading="loading && !summary">
      <header class="section-caption">
        <div>
          <h1>常用校园服务</h1>
          <p>快速打开常用入口</p>
        </div>
        <router-link to="/services">全部<el-icon><ArrowRight /></el-icon></router-link>
      </header>
      <div v-if="visibleServices.length" class="service-list">
        <button
          data-cpu-button="surface"
          v-for="service in visibleServices"
          :key="service.id || service.url"
          type="button"
          class="service-row"
          @click="openService(service)"
        >
          <span class="service-icon" aria-hidden="true"><AppIcon :legacy="service.icon" name="link" /></span>
          <span class="service-copy">
            <b>{{ service.name }}</b>
            <small>{{ [service.owner, service.description].filter(Boolean).join(" · ") || "校园服务" }}</small>
          </span>
          <el-icon class="service-arrow"><ArrowRight /></el-icon>
        </button>
      </div>
      <div v-else-if="homeError" class="service-state">
        <span>{{ homeError }}</span>
        <el-button text type="primary" @click="loadSummary()">重试</el-button>
      </div>
      <div v-else-if="!loading" class="service-state">
        <span>暂时没有可用服务</span>
        <router-link to="/services">查看全部</router-link>
      </div>
    </section>

    <section v-else-if="homeError && !summary" class="home-state">
      <el-empty :description="homeError"><el-button type="primary" @click="loadSummary()">重试</el-button></el-empty>
    </section>

    <section v-else-if="showForumContent" class="home-feed" v-loading="loading && !summary">
      <header class="section-caption">
        <div><h1>校园动态</h1><p>{{ activeFeedDescription }}</p></div>
        <router-link :to="activeFeedLink">{{ activeFeedLinkLabel }}<el-icon><ArrowRight /></el-icon></router-link>
      </header>
      <nav class="feed-tabs" role="tablist" aria-label="校园动态分流">
        <button data-cpu-button="surface" type="button" role="tab" :aria-selected="activeFeedStream === 'forum'" :class="{ active: activeFeedStream === 'forum' }" @click="selectFeedStream('forum')">论坛</button>
        <button data-cpu-button="surface" v-if="marketFeedEnabled" type="button" role="tab" :aria-selected="activeFeedStream === 'market'" :class="{ active: activeFeedStream === 'market' }" @click="selectFeedStream('market')">二手</button>
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
import { ArrowRight, ChatDotRound, Lock, MagicStick, Notification, School, Search, Sell, Service } from "@element-plus/icons-vue";
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, type Component } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import type { Topic } from "@/api/topic";
import { homeApi, type HomeFeedStream, type HomeSummary } from "@/api/home";
import { forumAdsApi, type ForumAd } from "@/api/forumAds";
import AppIcon from "@/components/common/AppIcon.vue";
import ForumAdCarousel from "@/components/forum/ForumAdCarousel.vue";
import ForumFeedCard from "@/components/forum/ForumFeedCard.vue";
import SiteSearchBar from "@/components/search/SiteSearchBar.vue";
import { useAuthStore } from "@/stores/auth";
import { useSiteStore } from "@/stores/site";
import { isCampusAssistantDestination, isNativeForumIntranetOnlyAccount, shouldHideHarmonyAssistant, shouldHideNativeYaodaCanFly } from "@/utils/clientInfo";
import { forumCacheScope, readForumLatestFeed, writeForumLatestFeed } from "@/utils/forumCache";
import { clearForumListRestoreState, readForumListRestoreState, writeForumListRestoreState } from "@/utils/forumListRestore";
import { readHomeSummaryCache, writeHomeSummaryCache } from "@/utils/homeCache";
import { isForumDestination } from "@/utils/nativeForumVisibility";

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
const mobileHomeAds = ref<ForumAd[]>([]);
const activeFeedStream = ref<MobileHomeFeedStream>("forum");
const feedStates = reactive<Record<MobileHomeFeedStream, HomeFeedState>>({
  forum: createFeedState(),
  market: createFeedState(),
});
const feedPageSize = 10;
const loadMoreSentinelRef = ref<HTMLElement | null>(null);
const showForumContent = computed(() => site.features.forum
  && auth.canAccessForum
  && !isNativeForumIntranetOnlyAccount(auth.user?.username));
const marketFeedEnabled = computed(() => site.features.market && showForumContent.value);
const hotPreview = computed(() => (summary.value?.hotTopics || []).slice(0, 3) as Topic[]);
const activeFeed = computed(() => feedStates[activeFeedStream.value]);
const latestTopics = computed(() => activeFeed.value.list);
const canLoadMore = computed(() => showForumContent.value && latestTopics.value.length < activeFeed.value.total);
const activeFeedDescription = computed(() => activeFeedStream.value === "market" ? "闲置转让、求购与二手交流" : "最近发布的讨论与校园内容");
const activeFeedEmptyText = computed(() => activeFeedStream.value === "market" ? "暂时还没有二手信息" : "校园里暂时还没有新动态");
const activeFeedLink = computed(() => activeFeedStream.value === "market" ? "/forum?channel=market" : "/forum");
const activeFeedLinkLabel = computed(() => activeFeedStream.value === "market" ? "进入二手" : "进入论坛");
const nativeForumRestricted = computed(() => isNativeForumIntranetOnlyAccount(auth.user?.username));
const assistantEntryVisible = computed(() => site.features.assistantEntry
  && !shouldHideHarmonyAssistant(auth.isLoggedIn, auth.user?.username));
const visibleServices = computed(() => (summary.value?.services || [])
  .filter((service) => !auth.forumHidden || !isForumDestination(String(service?.url || "")))
  .filter((service) => assistantEntryVisible.value || !isCampusAssistantDestination(service?.url))
  .filter((service) => !(
    shouldHideNativeYaodaCanFly(auth.isLoggedIn, auth.user?.username)
    && String(service?.url || "").includes("/services/tools/yaoda-can-fly")
  ))
  .slice(0, 4));
const quickEntries = computed(() => {
  if (!showForumContent.value) {
    return [
      ...(auth.forumHidden ? [{ icon: Search, label: "搜索", to: "/search/results?scope=services", hue: "blue" }]
        : [{ icon: Notification, label: "公告", to: "/announcements", hue: "blue" }]),
      { icon: Search, label: "失物", to: "/lost-found", hue: "amber" },
      { icon: School, label: "教务", to: "/jwxt", hue: "brand" },
      { icon: Service, label: "服务", to: "/services", hue: "green" },
    ];
  }
  return [
    { icon: ChatDotRound, label: "论坛", to: "/forum", hue: "brand" },
    { icon: Notification, label: "公告", to: "/announcements", hue: "blue" },
    site.features.market ? { icon: Sell, label: "二手", to: "/forum?channel=market", hue: "amber" } : null,
    { icon: Service, label: "服务", to: "/services", hue: "green" },
    assistantEntryVisible.value ? { icon: MagicStick, label: "拾间AI", to: "/search", hue: "violet" } : null,
  ].filter(Boolean) as Array<{ icon: Component; label: string; to: string; hue: string }>;
});
const homeCacheScope = computed(() => {
  const identity = auth.user?.id ? `user-${auth.user.id}` : "guest";
  return `${identity}:forum-${showForumContent.value ? "on" : "off"}`;
});
let loadSequence = 0;
const feedSequences: Record<MobileHomeFeedStream, number> = { forum: 0, market: 0 };
let adSequence = 0;
let mounted = false;
let disposed = false;
let loadObserver: IntersectionObserver | null = null;
let pendingRestoreState: HomeFeedRestoreState | null = readForumListRestoreState<HomeFeedRestoreState>(route.fullPath);

if (pendingRestoreState?.stream === "market" && marketFeedEnabled.value) activeFeedStream.value = "market";

onMounted(() => {
  mounted = true;
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
    scrollY: readPageScrollY(),
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
    const cachedFeed = showForumContent.value ? readForumLatestFeed(forumCacheScope(auth.user), stream) : null;
    state.list = cachedFeed?.list.slice(0, state.page * feedPageSize) || [];
    state.total = cachedFeed?.total || state.list.length;
    state.loaded = false;
    state.loading = false;
    state.loadingMore = false;
    state.error = "";
    state.loadMoreError = "";
  }
  if (showForumContent.value && !feedStates.forum.list.length && cached?.latestTopics?.length) {
    feedStates.forum.list = (cached.latestTopics as Topic[])
      .filter((topic) => topic.board?.type !== "market")
      .slice(0, feedPageSize);
    feedStates.forum.total = feedStates.forum.list.length;
  }
  // Cached rows are available synchronously. Put the page back before the
  // network refresh can cause a visible top-of-page frame.
  if (pendingRestoreState) {
    await nextTick();
    const scrollY = Math.max(0, Number(pendingRestoreState.scrollY || 0));
    if (scrollY <= getPageScrollHeight() + 8) scrollPageTo(scrollY);
  }
  homeError.value = "";
  await Promise.all([
    loadSummary({ scope, fallback: cached }),
    loadFeedPages(activeFeedStream.value),
    loadAds(),
  ]);
  // Restore only after the summary, feed and ad slots have settled. Each of
  // them can insert content above the saved position and otherwise shifts the
  // user back to a different height after the first successful scroll.
  if (pendingRestoreState && !disposed) {
    await nextTick();
    await restoreScrollIfNeeded();
  }
}

async function loadAds() {
  if (!showForumContent.value) {
    mobileHomeAds.value = [];
    return;
  }
  const sequence = ++adSequence;
  try {
    const mobileHome = await forumAdsApi.list("home-mobile-top").catch(() => []);
    if (sequence !== adSequence) return;
    mobileHomeAds.value = mobileHome;
  } catch {
    if (sequence !== adSequence) return;
    mobileHomeAds.value = [];
  }
}

async function loadSummary(options: { scope?: string; fallback?: HomeSummary | null } = {}) {
  const scope = options.scope || homeCacheScope.value;
  const sequence = ++loadSequence;
  loading.value = !summary.value;
  homeError.value = "";
  try {
    const result = await homeApi.summary({ suppressErrorMessage: true, cacheTtlMs: 0 }, auth.forumHidden);
    if (disposed || sequence !== loadSequence || scope !== homeCacheScope.value) return;
    summary.value = result;
    if (showForumContent.value && !feedStates.forum.list.length && !feedStates.forum.loaded) {
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
    let attempts = 0;
    const restore = () => {
      scrollPageTo(scrollY);
      const availableHeight = getPageScrollHeight();
      if (scrollY <= availableHeight + 8 || attempts >= 24) {
        resolve();
        return;
      }
      attempts += 1;
      requestAnimationFrame(restore);
    };
    requestAnimationFrame(restore);
  });
  clearForumListRestoreState(route.fullPath);
  pendingRestoreState = null;
}

function readPageScrollY() {
  const app = document.getElementById("app");
  const documentScrollY = document.scrollingElement?.scrollTop || 0;
  return Math.max(window.scrollY || 0, documentScrollY, app?.scrollTop || 0);
}

function scrollPageTo(top: number) {
  const options: ScrollToOptions = { top, left: 0, behavior: "auto" };
  document.getElementById("app")?.scrollTo(options);
  document.scrollingElement?.scrollTo(options);
  window.scrollTo(options);
}

function getPageScrollHeight() {
  const app = document.getElementById("app");
  const documentScroller = document.scrollingElement;
  return Math.max(
    0,
    (app?.scrollHeight || 0) - (app?.clientHeight || 0),
    (documentScroller?.scrollHeight || 0) - (documentScroller?.clientHeight || 0),
  );
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
function openService(service: any) {
  const target = typeof service?.url === "string" ? service.url.trim() : "";
  if (!target) {
    ElMessage.warning("该服务暂未配置链接");
    return;
  }
  if (target.startsWith("/")) {
    void router.push(target);
    return;
  }
  if (target.startsWith("tel:") || target.startsWith("mailto:")) {
    window.location.href = target;
    return;
  }
  if (/^https?:\/\//i.test(target)) {
    window.open(target, "_blank", "noopener,noreferrer");
    return;
  }
  ElMessage.warning("该服务链接格式暂不支持");
}
function requestMessage(requestError: unknown) {
  return (requestError as { response?: { data?: { message?: string } } })?.response?.data?.message || "";
}
</script>

<style scoped>
/* 冷灰页面上的白色分组：入口色块、热榜、信息流共用一套分组、细线和字号。 */
.home-stream { display: flex; max-width: 860px; margin: 0 auto; flex-direction: column; gap: 12px; color: var(--cpu-text); font-size: var(--cpu-fs-m); line-height: 1.6; }
.home-entry { display: flex; flex-direction: column; gap: 12px; }

.quick-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
.quick-grid--services { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.quick-grid button { display: flex; min-width: 0; flex-direction: column; align-items: center; gap: 5px; padding: 12px 0 9px; border: 0; border-radius: var(--cpu-radius-l); background: var(--cpu-hue-bg); color: var(--cpu-hue-ink); font: inherit; font-size: var(--cpu-fs-s); font-weight: 500; line-height: 1.4; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.quick-grid button:focus-visible, .hot-strip button:focus-visible, .service-row:focus-visible, .feed-tabs button:focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: 2px; }
.quick-icon { display: inline-flex; font-size: 24px; line-height: 1; }
.forum-access-note { display: flex; align-items: center; gap: 8px; margin: 0; padding: 10px 12px; border-radius: var(--cpu-radius-m); background: var(--cpu-accent-soft); color: var(--cpu-accent); font-size: var(--cpu-fs-s); line-height: 1.5; }
.forum-access-note .el-icon { flex: none; font-size: 16px; }

/* 热榜：白色分组里的三行，每行一句标题 */
.hot-strip { padding: 8px 12px 4px 14px; border-radius: var(--cpu-radius-l); background: var(--cpu-card); }
.hot-strip header { display: flex; min-height: 28px; align-items: center; justify-content: space-between; gap: 12px; }
.hot-strip header b { display: inline-flex; align-items: center; gap: 5px; font-weight: 700; }
.hot-strip header b :deep(.cpu-app-icon) { color: var(--cpu-rank-top); font-size: 15px; }
.hot-strip a, .section-caption a { display: inline-flex; flex: none; min-height: 28px; align-items: center; gap: 1px; color: var(--cpu-primary); font-size: var(--cpu-fs-s); text-decoration: none; white-space: nowrap; }
.hot-strip button { display: flex; width: 100%; min-height: 36px; align-items: center; gap: 8px; padding: 0; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.hot-strip button b { min-width: 0; flex: 1; overflow: hidden; font-weight: 400; text-overflow: ellipsis; white-space: nowrap; }
.hot-strip button small { flex: none; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
.hot-rank { flex: none; width: 14px; color: var(--cpu-text-muted); font-weight: 700; text-align: center; font-variant-numeric: tabular-nums; }
.hot-rank.top { color: var(--cpu-rank-top); }
.service-arrow { flex: none; color: var(--cpu-border); font-size: 16px; }

/* 分组标题 */
.section-caption { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin: 12px 4px 0; }
.section-caption h1 { margin: 0; font-size: var(--cpu-fs-xl); font-weight: 700; line-height: 1.3; }
.section-caption p { margin: 2px 0 0; color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); }
.section-caption a { min-height: 32px; font-size: var(--cpu-fs-m); }

.campus-services, .home-feed { display: flex; flex-direction: column; gap: 12px; }
.service-list { overflow: hidden; border-radius: var(--cpu-radius-l); background: var(--cpu-card); }
.service-row { display: flex; width: 100%; min-height: 60px; align-items: center; gap: 12px; padding: 10px 12px 10px 16px; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.service-row + .service-row { box-shadow: inset 0 1px 0 var(--cpu-border-soft); }
.service-icon { display: inline-flex; flex: none; color: var(--cpu-primary); font-size: 22px; }
.service-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; }
.service-copy b { overflow: hidden; font-weight: 500; line-height: 1.45; text-overflow: ellipsis; white-space: nowrap; }
.service-copy small { overflow: hidden; color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); text-overflow: ellipsis; white-space: nowrap; }
.service-state { display: flex; min-height: 84px; align-items: center; justify-content: center; gap: 8px; border-radius: var(--cpu-radius-l); background: var(--cpu-card); color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); }
.service-state a { color: var(--cpu-primary); text-decoration: none; }

/* 分段控件 */
.feed-tabs { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; padding: 2px; border-radius: var(--cpu-radius-m); background: var(--cpu-track); }
.feed-tabs button { height: 40px; border: 0; border-radius: 8px; background: none; color: var(--cpu-text-secondary); font: inherit; font-weight: 500; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.feed-tabs button.active { background: var(--cpu-card); color: var(--cpu-text); }

/* 信息流是一整块分组，帖子之间用细线分隔 */
.home-feed-list { display: flex; min-height: 140px; flex-direction: column; overflow: hidden; border-radius: var(--cpu-radius-l); background: var(--cpu-card); }
.home-feed-list :deep(.feed-card) { border-radius: 0; }
.home-feed-list :deep(.feed-card + .feed-card) { box-shadow: inset 0 1px 0 var(--cpu-border-soft); }
.feed-state { min-height: 140px; border-radius: var(--cpu-radius-l); background: var(--cpu-card); }
.feed-load-sentinel, .feed-load-error { display: flex; min-height: 44px; align-items: center; justify-content: center; gap: 6px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); }
.feed-load-error { color: var(--cpu-danger); }
.home-state { padding: 28px 12px; border-radius: var(--cpu-radius-l); background: var(--cpu-card); }
</style>
