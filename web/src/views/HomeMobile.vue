<template>
  <div class="home-stream">
    <section class="home-entry" aria-label="首页快捷入口">
      <SiteSearchBar
        :placeholder="showForumContent ? '搜索帖子或校园服务' : '搜索校园服务'"
        :scope="showForumContent ? 'all' : 'services'"
      />
      <nav class="quick-grid" :class="{ 'quick-grid--services': !showForumContent }">
        <button data-cpu-button="surface" v-for="entry in quickEntries" :key="entry.label" type="button" @click="openQuickEntry(entry.to)">
          <span class="quick-icon" aria-hidden="true"><el-icon><component :is="entry.icon" /></el-icon></span>
          <span>{{ entry.label }}</span>
        </button>
      </nav>
      <p v-if="nativeForumRestricted" class="forum-access-note">
        <el-icon aria-hidden="true"><Lock /></el-icon>
        <span>论坛仅限连接内网后使用</span>
      </p>
    </section>

    <ForumAdCarousel v-if="showForumContent && mobileHomeAds.length" :ads="mobileHomeAds" compact />

    <section v-if="showForumContent && hotPreview.length" class="hot-strip" aria-label="热榜">
      <header><b>热榜</b><router-link to="/forum?channel=hot">查看全部 →</router-link></header>
      <button data-cpu-button="surface" v-for="(topic, index) in hotPreview" :key="topic.id" type="button" @click="openTopic(topic.id)">
        <span :class="{ top: index < 3 }">{{ index + 1 }}</span>
        <b>{{ topic.title }}</b>
        <small>{{ topic.board?.name }}</small>
      </button>
    </section>

    <section v-if="!showForumContent" class="campus-services" v-loading="loading && !summary">
      <header class="service-section-head">
        <div>
          <h1>常用校园服务</h1>
          <p>快速打开常用入口</p>
        </div>
        <router-link to="/services">全部 <el-icon><Right /></el-icon></router-link>
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
          <el-icon class="service-arrow"><Right /></el-icon>
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
      <header class="section-head">
        <div><h1>校园动态</h1><p>{{ activeFeedDescription }}</p></div>
        <router-link :to="activeFeedLink">{{ activeFeedLinkLabel }} →</router-link>
      </header>
      <nav class="feed-tabs" role="tablist" aria-label="校园动态分流">
        <button data-cpu-button="option" type="button" role="tab" :aria-selected="activeFeedStream === 'forum'" :class="{ active: activeFeedStream === 'forum' }" @click="selectFeedStream('forum')">
          <el-icon><ChatDotRound /></el-icon>论坛
        </button>
        <button data-cpu-button="option" v-if="marketFeedEnabled" type="button" role="tab" :aria-selected="activeFeedStream === 'market'" :class="{ active: activeFeedStream === 'market' }" @click="selectFeedStream('market')">
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
import { ChatDotRound, Lock, MagicStick, Notification, Right, School, Search, Sell, Service } from "@element-plus/icons-vue";
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
import { isNativeForumIntranetOnlyAccount, shouldHideNativeYaodaCanFly } from "@/utils/clientInfo";
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
const visibleServices = computed(() => (summary.value?.services || [])
  .filter((service) => !(
    shouldHideNativeYaodaCanFly(auth.isLoggedIn, auth.user?.username)
    && String(service?.url || "").includes("/services/tools/yaoda-can-fly")
  ))
  .slice(0, 4));
const quickEntries = computed(() => {
  if (!showForumContent.value) {
    return [
      { icon: Notification, label: "公告", to: "/announcements" },
      { icon: Search, label: "失物", to: "/lost-found" },
      { icon: School, label: "教务", to: "/jwxt" },
      { icon: Service, label: "服务", to: "/services" },
    ];
  }
  return [
    { icon: ChatDotRound, label: "论坛", to: "/forum" },
    { icon: Notification, label: "公告", to: "/announcements" },
    site.features.market ? { icon: Sell, label: "二手", to: "/forum?channel=market" } : null,
    { icon: Service, label: "服务", to: "/services" },
    site.features.assistantEntry ? { icon: MagicStick, label: "拾间AI", to: "/search" } : null,
  ].filter(Boolean) as Array<{ icon: Component; label: string; to: string }>;
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
.home-stream { display: flex; max-width: 860px; margin: 0 auto; flex-direction: column; gap: 13px; }
.home-entry { padding: 12px; border: 1px solid var(--cpu-border-soft); border-radius: 15px; background: var(--cpu-card); box-shadow: var(--cpu-shadow-sm); }
.quick-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 7px; margin-top: 10px; }
.quick-grid--services { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.quick-grid button { display: flex; min-width: 0; min-height: 66px; flex-direction: column; align-items: center; justify-content: center; gap: 5px; padding: 7px 4px; border: 1px solid var(--cpu-border-soft); border-radius: 11px; background: var(--cpu-surface-soft); color: var(--cpu-text-secondary); font-size: 11px; font-weight: 650; cursor: pointer; }
.quick-grid button:hover { border-color: var(--cpu-primary); color: var(--cpu-primary); }
.quick-grid button:focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: 2px; }
.quick-icon { display: grid; width: 24px; height: 24px; place-items: center; color: var(--cpu-primary); line-height: 1; }
.quick-icon :deep(.el-icon) { width: 22px; height: 22px; font-size: 22px; }
.forum-access-note { display: flex; min-height: 34px; align-items: center; gap: 7px; margin: 9px 2px 0; padding: 7px 9px; border-radius: 8px; background: color-mix(in srgb, var(--cpu-warning, #b97920) 10%, var(--cpu-surface-soft)); color: var(--cpu-text-secondary); font-size: 11px; line-height: 1.45; }
.forum-access-note .el-icon { flex: 0 0 auto; color: var(--cpu-warning, #b97920); font-size: 14px; }
.campus-services { padding: 3px 2px 0; }
.service-section-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; padding: 0 3px 10px; }
.service-section-head h1 { margin: 0; color: var(--cpu-text); font-size: 17px; line-height: 1.35; }
.service-section-head p { margin: 3px 0 0; color: var(--cpu-text-muted); font-size: 11px; }
.service-section-head a { display: inline-flex; min-height: 32px; align-items: center; gap: 2px; color: var(--cpu-primary); font-size: 12px; text-decoration: none; }
.service-list { overflow: hidden; border: 1px solid var(--cpu-border-soft); border-radius: 12px; background: var(--cpu-card); box-shadow: var(--cpu-shadow-sm); }
.service-row { display: grid; width: 100%; min-height: 58px; grid-template-columns: 36px minmax(0, 1fr) 18px; align-items: center; gap: 10px; padding: 9px 12px; border: 0; border-bottom: 1px solid var(--cpu-border-soft); background: transparent; color: inherit; text-align: left; cursor: pointer; font: inherit; }
.service-row:last-child { border-bottom: 0; }
.service-row:hover { background: var(--cpu-surface-soft); }
.service-row:focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: -2px; }
.service-icon { display: grid; width: 36px; height: 36px; place-items: center; border-radius: 9px; background: var(--cpu-surface-soft); color: var(--cpu-primary); font-size: 19px; }
.service-copy { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
.service-copy b { overflow: hidden; color: var(--cpu-text); font-size: 13px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.service-copy small { overflow: hidden; color: var(--cpu-text-muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.service-arrow { color: var(--cpu-text-muted); font-size: 14px; }
.service-state { display: flex; min-height: 84px; align-items: center; justify-content: center; gap: 8px; border: 1px solid var(--cpu-border-soft); border-radius: 12px; background: var(--cpu-card); color: var(--cpu-text-muted); font-size: 12px; }
.service-state a { color: var(--cpu-primary); text-decoration: none; }
.hot-strip { padding: 10px 12px; border: 1px solid var(--cpu-border-soft); border-radius: 12px; background: var(--cpu-card); }
.hot-strip header, .section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.hot-strip header { margin-bottom: 4px; }
.hot-strip header b { display: inline-flex; align-items: center; gap: 5px; color: var(--cpu-text); font-size: 13px; }
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
  .quick-grid--services { grid-template-columns: repeat(4, minmax(0, 1fr)); overflow: visible; }
  .quick-grid::-webkit-scrollbar { display: none; }
}
</style>
