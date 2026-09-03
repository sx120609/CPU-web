<template>
  <div class="forum-hub">
    <header class="forum-hub-head">
      <div>
        <span class="eyebrow">CAMPUS FEED</span>
        <h1>校园动态</h1>
        <p>{{ activeChannel.description }}</p>
      </div>
      <el-button class="boards-button" plain @click="boardsOpen = true">全部板块</el-button>
    </header>

    <SiteSearchBar placeholder="搜索帖子标题、正文或校园服务" />

    <nav class="channel-tabs" aria-label="动态分类">
      <button
        v-for="channel in channels"
        :key="channel.id"
        type="button"
        :class="{ active: selectedChannel === channel.id }"
        @click="selectChannel(channel.id)"
      >
        <AppIcon :name="channel.icon" />{{ channel.label }}
      </button>
      <button type="button" class="all-boards-tab" @click="boardsOpen = true"><AppIcon name="board" />板块</button>
    </nav>

    <PinnedTopicStrip v-if="selectedChannel === 'latest'" :topics="pinnedList" />
    <ForumAdCarousel v-if="topAds.length" :ads="topAds" compact />

    <section class="feed-panel" :aria-busy="loading">
      <div class="feed-panel-head">
        <div>
          <h2>{{ activeChannel.feedTitle }}</h2>
          <span>{{ activeChannel.feedHint }}</span>
        </div>
        <strong v-if="total">{{ total }}</strong>
      </div>

      <div v-if="error && !feedItems.length" class="feed-state">
        <el-empty :description="error"><el-button type="primary" @click="loadFeed">重试</el-button></el-empty>
      </div>
      <div v-else class="feed-list" v-loading="loading && !feedItems.length">
        <template v-for="(topic, index) in feedItems" :key="topic.id">
          <ForumFeedCard
            :topic="topic"
            :rank="selectedChannel === 'hot' ? Number((topic as any).rank || 0) : 0"
            :time-mode="selectedChannel === 'hot' ? 'published' : 'activity'"
          />
          <ForumAdCarousel v-if="inlineAds.length && index === 2" :ads="inlineAds" compact />
        </template>
        <ForumAdCarousel v-if="inlineAds.length && feedItems.length > 0 && feedItems.length < 3" :ads="inlineAds" compact />
        <el-empty v-if="!loading && !feedItems.length" description="这个分类暂时还没有内容" />
      </div>

      <div v-if="feedItems.length" class="feed-more">
        <div v-if="loadMoreError" class="load-sentinel is-error">
          <span>{{ loadMoreError }}</span><el-button text size="small" @click="loadMore">重试</el-button>
        </div>
        <div v-else-if="canLoadMore" ref="loadMoreSentinelRef" class="load-sentinel">
          <span v-if="loadingMore">正在加载…</span>
        </div>
      </div>
    </section>

    <el-dialog v-model="boardsOpen" title="全部讨论板块" width="min(640px, calc(100vw - 24px))" class="board-dialog">
      <div v-if="boardError && !boards.length" class="board-state">
        <el-empty :description="boardError"><el-button type="primary" @click="loadBoards">重试</el-button></el-empty>
      </div>
      <div v-else class="board-grid" v-loading="boardsLoading && !boards.length">
        <button v-for="board in discussionBoards" :key="board.slug" type="button" class="board-choice" @click="openBoard(board)">
          <span class="board-icon" :style="{ background: board.color || '#168776' }"><AppIcon :legacy="board.icon" name="board" /></span>
          <span class="board-copy"><b>{{ board.name }}</b><small>{{ board.description }}</small></span>
          <span class="board-count">{{ board.topicCount }} 帖</span>
        </button>
      </div>
      <template #footer>
        <router-link class="announcement-link" to="/announcements" @click="boardsOpen = false">查看校园公告 →</router-link>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import { boardApi, type Board } from "@/api/board";
import { homeApi } from "@/api/home";
import { topicApi, type Topic } from "@/api/topic";
import { forumAdsApi, type ForumAd } from "@/api/forumAds";
import ForumAdCarousel from "@/components/forum/ForumAdCarousel.vue";
import ForumFeedCard from "@/components/forum/ForumFeedCard.vue";
import PinnedTopicStrip from "@/components/forum/PinnedTopicStrip.vue";
import SiteSearchBar from "@/components/search/SiteSearchBar.vue";
import AppIcon from "@/components/common/AppIcon.vue";
import { useAuthStore } from "@/stores/auth";
import { useSiteStore } from "@/stores/site";
import {
  forumCacheScope,
  readForumBoards,
  readForumHotFeed,
  readForumLatestFeed,
  writeForumBoards,
  writeForumHotFeed,
  writeForumLatestFeed,
} from "@/utils/forumCache";
import { clearForumListRestoreState, readForumListRestoreState, writeForumListRestoreState } from "@/utils/forumListRestore";

type ChannelId = "latest" | "hot" | "question" | "market" | "freshman";
type Channel = { id: ChannelId; label: string; icon: string; description: string; feedTitle: string; feedHint: string; board?: string };
type MobileFeedRestoreState = {
  scrollY: number;
  page?: number;
  savedAt: number;
};

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const site = useSiteStore();
const cacheScope = computed(() => forumCacheScope(auth.user));
const baseChannels: Channel[] = [
  { id: "latest", label: "最新", icon: "new", description: "直接看看校园里刚刚发生了什么。", feedTitle: "最新内容", feedHint: "按发布时间排列" },
  { id: "hot", label: "热榜", icon: "hot", description: "近 24 小时新发布且互动活跃的内容。", feedTitle: "热榜", feedHint: "新帖优先，综合互动热度" },
  { id: "question", label: "求助", icon: "question", description: "提问、咨询和同学互助。", feedTitle: "求助答疑", feedHint: "来自提问广场", board: "question" },
  { id: "market", label: "二手", icon: "market", description: "闲置、求购和二手经验交流。", feedTitle: "二手交流", feedHint: "仅提供信息发布与公开交流", board: "market" },
  { id: "freshman", label: "新生", icon: "school", description: "入学攻略和新生常见问题。", feedTitle: "新生入学", feedHint: "学长学姐经验分享", board: "freshman" },
];
const channels = computed(() => baseChannels.filter((channel) => channel.id !== "market" || site.features.market));
const selectedChannel = computed<ChannelId>(() => {
  const requested = typeof route.query.channel === "string" ? route.query.channel : "latest";
  return channels.value.some((channel) => channel.id === requested) ? requested as ChannelId : "latest";
});
const activeChannel = computed(() => channels.value.find((channel) => channel.id === selectedChannel.value) || channels.value[0]);
const boards = ref<Board[]>([]);
const discussionBoards = computed(() => boards.value.filter((board) => board.type !== "announce"));
const boardsLoading = ref(false);
const boardError = ref("");
const boardsOpen = ref(false);
const feedItems = ref<Topic[]>([]);
const pinnedList = ref<Topic[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 15;
const loading = ref(false);
const loadingMore = ref(false);
const error = ref("");
const loadMoreError = ref("");
const topAds = ref<ForumAd[]>([]);
const inlineAds = ref<ForumAd[]>([]);
const loadMoreSentinelRef = ref<HTMLElement | null>(null);
const canLoadMore = computed(() => selectedChannel.value !== "hot" && feedItems.value.length < total.value);
let loadObserver: IntersectionObserver | null = null;
let loadSequence = 0;
let disposed = false;
let pendingRestoreState: MobileFeedRestoreState | null = null;

onMounted(() => {
  void loadBoards();
  void loadAd();
  loadObserver = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
    if (entry?.isIntersecting && canLoadMore.value && !loading.value && !loadingMore.value && !loadMoreError.value) void loadMore();
  }, { rootMargin: "220px 0px 320px", threshold: .01 });
  observeLoadMore();
});

onBeforeUnmount(() => {
  disposed = true;
  loadSequence += 1;
  loadObserver?.disconnect();
});

watch(() => [selectedChannel.value, cacheScope.value], () => {
  pendingRestoreState = readForumListRestoreState<MobileFeedRestoreState>(route.fullPath);
  void loadFeed();
}, { immediate: true });

watch(canLoadMore, () => void nextTick(observeLoadMore));

onBeforeRouteLeave((to) => {
  if (to.name !== "topic" || !feedItems.value.length) return;
  writeForumListRestoreState(route.fullPath, {
    scrollY: window.scrollY,
    page: page.value,
  });
});

function observeLoadMore() {
  loadObserver?.disconnect();
  if (canLoadMore.value && loadMoreSentinelRef.value) loadObserver?.observe(loadMoreSentinelRef.value);
}

function selectChannel(channel: ChannelId) {
  const query = { ...route.query };
  if (channel === "latest") delete query.channel;
  else query.channel = channel;
  void router.replace({ name: "forum", query });
}

async function loadFeed() {
  const sequence = ++loadSequence;
  const channel = activeChannel.value;
  page.value = Math.max(1, Number(pendingRestoreState?.page || 1));
  error.value = "";
  loadMoreError.value = "";
  pinnedList.value = [];
  feedItems.value = [];
  total.value = 0;

  if (channel.id === "latest") {
    const cached = readForumLatestFeed(cacheScope.value, "forum");
    if (cached) {
      pinnedList.value = cached.pins;
      feedItems.value = cached.list.slice(0, page.value * pageSize);
      total.value = cached.total;
    }
  } else if (channel.id === "hot") {
    const cached = readForumHotFeed(cacheScope.value);
    if (cached?.length) {
      feedItems.value = cached;
      total.value = cached.length;
    }
  }
  loading.value = !feedItems.value.length;

  try {
    if (channel.id === "hot") {
      const list = await homeApi.hotRanking({ stream: "forum" }, { suppressErrorMessage: true });
      if (disposed || sequence !== loadSequence) return;
      feedItems.value = list;
      total.value = list.length;
      writeForumHotFeed(cacheScope.value, list);
    } else if (channel.id === "latest") {
      const pages = await Promise.all(
        Array.from({ length: page.value }, (_, index) => homeApi.latestFeed(
          { page: index + 1, size: pageSize, stream: "forum" },
          { suppressErrorMessage: true },
        )),
      );
      if (disposed || sequence !== loadSequence) return;
      pinnedList.value = pages[0]?.pins || [];
      feedItems.value = dedupeTopics(pages.flatMap((result) => result.list));
      total.value = pages[0]?.total || feedItems.value.length;
      writeForumLatestFeed(cacheScope.value, { pins: pinnedList.value, list: feedItems.value, total: total.value, page: page.value }, "forum");
    } else {
      const pages = await Promise.all(
        Array.from({ length: page.value }, (_, index) => topicApi.list(
          { board: channel.board, page: index + 1, size: pageSize, sort: "new", pinned: "exclude" },
          { suppressErrorMessage: true },
        )),
      );
      if (disposed || sequence !== loadSequence) return;
      feedItems.value = dedupeTopics(pages.flatMap((result) => result.list));
      total.value = pages[0]?.total || feedItems.value.length;
    }
  } catch (requestError) {
    if (disposed || sequence !== loadSequence) return;
    if (!feedItems.value.length) error.value = requestMessage(requestError) || "内容加载失败，请稍后重试";
  } finally {
    if (!disposed && sequence === loadSequence) {
      loading.value = false;
      await nextTick();
      await restoreScrollIfNeeded();
      observeLoadMore();
    }
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

async function loadMore() {
  if (!canLoadMore.value || loadingMore.value || loading.value) return;
  const sequence = loadSequence;
  const nextPage = page.value + 1;
  const channel = activeChannel.value;
  loadingMore.value = true;
  loadMoreError.value = "";
  loadObserver?.disconnect();
  try {
    if (channel.id === "latest") {
      const result = await homeApi.latestFeed({ page: nextPage, size: pageSize, stream: "forum" }, { suppressErrorMessage: true });
      if (disposed || sequence !== loadSequence) return;
      page.value = nextPage;
      feedItems.value = dedupeTopics([...feedItems.value, ...result.list]);
      total.value = result.total;
      pinnedList.value = result.pins || pinnedList.value;
      writeForumLatestFeed(cacheScope.value, { pins: pinnedList.value, list: feedItems.value, total: total.value, page: page.value }, "forum");
    } else {
      const result = await topicApi.list({ board: channel.board, page: nextPage, size: pageSize, sort: "new", pinned: "exclude" }, { suppressErrorMessage: true });
      if (disposed || sequence !== loadSequence) return;
      page.value = nextPage;
      feedItems.value = dedupeTopics([...feedItems.value, ...result.list]);
      total.value = result.total;
    }
  } catch (requestError) {
    if (!disposed && sequence === loadSequence) loadMoreError.value = requestMessage(requestError) || "加载更多失败";
  } finally {
    if (!disposed && sequence === loadSequence) {
      loadingMore.value = false;
      await nextTick();
      observeLoadMore();
    }
  }
}

function dedupeTopics(items: Topic[]) {
  const seen = new Set<number>();
  return items.filter((topic) => {
    if (seen.has(topic.id)) return false;
    seen.add(topic.id);
    return true;
  });
}

async function loadBoards() {
  const cached = readForumBoards(cacheScope.value);
  if (cached?.length && !boards.value.length) boards.value = cached;
  boardsLoading.value = !boards.value.length;
  boardError.value = "";
  try {
    const result = await boardApi.list({ suppressErrorMessage: true });
    if (disposed) return;
    boards.value = result;
    writeForumBoards(cacheScope.value, result);
  } catch (requestError) {
    if (!boards.value.length) boardError.value = requestMessage(requestError) || "板块列表加载失败";
  } finally {
    if (!disposed) boardsLoading.value = false;
  }
}

async function loadAd() {
  try {
    const [top, inline] = await Promise.all([
      forumAdsApi.list("forum-index-top").catch(() => []),
      forumAdsApi.list("forum-feed-inline").catch(() => []),
    ]);
    topAds.value = top;
    inlineAds.value = inline;
  } catch {
    topAds.value = [];
    inlineAds.value = [];
  }
}

function openBoard(board: Board) {
  boardsOpen.value = false;
  void router.push(board.type === "market" ? { name: "forum", query: { channel: "market" } } : `/forum/b/${board.slug}`);
}

function requestMessage(requestError: unknown) {
  return (requestError as { response?: { data?: { message?: string } } })?.response?.data?.message || "";
}
</script>

<style scoped>
.forum-hub { display: flex; flex-direction: column; gap: 14px; max-width: 860px; margin: 0 auto; }
.forum-hub-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; }
.eyebrow { color: var(--cpu-primary); font-size: 10px; font-weight: 800; letter-spacing: .14em; }
.forum-hub-head h1 { margin: 3px 0 0; color: var(--cpu-text); font-size: 24px; }
.forum-hub-head p { margin: 5px 0 0; color: var(--cpu-text-secondary); font-size: 12px; }
.boards-button { flex: 0 0 auto; }
.channel-tabs { display: flex; gap: 7px; padding-bottom: 2px; overflow-x: auto; scrollbar-width: none; }
.channel-tabs::-webkit-scrollbar { display: none; }
.channel-tabs button { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 4px; min-height: 35px; padding: 0 13px; border: 1px solid var(--cpu-border-soft); border-radius: 999px; background: var(--cpu-card); color: var(--cpu-text-secondary); font-size: 12px; font-weight: 650; cursor: pointer; }
.channel-tabs button:hover, .channel-tabs button.active { border-color: var(--cpu-primary); background: var(--cpu-primary); color: #fff; }
.channel-tabs .all-boards-tab { border-style: dashed; }
.feed-panel { padding: 14px; border: 1px solid var(--cpu-border-soft); border-radius: 15px; background: color-mix(in srgb, var(--cpu-surface-soft) 58%, var(--cpu-card)); }
.feed-panel-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; padding: 0 2px 11px; }
.feed-panel-head h2 { margin: 0; color: var(--cpu-text); font-size: 17px; }
.feed-panel-head span { display: block; margin-top: 3px; color: var(--cpu-text-muted); font-size: 10px; }
.feed-panel-head strong { color: var(--cpu-primary); font-size: 13px; }
.feed-list { display: flex; min-height: 120px; flex-direction: column; gap: 9px; }
.feed-state, .board-state { padding: 22px 10px; }
.feed-more { padding-top: 10px; }
.load-sentinel { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 40px; border-radius: 10px; color: var(--cpu-text-muted); font-size: 11px; }
.load-sentinel.is-error { color: #b91c1c; }
.board-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; min-height: 120px; }
.board-choice { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; align-items: center; gap: 10px; min-width: 0; padding: 11px; border: 1px solid var(--cpu-border-soft); border-radius: 11px; background: var(--cpu-card); color: var(--cpu-text); text-align: left; cursor: pointer; }
.board-choice:hover { border-color: var(--cpu-primary); background: var(--cpu-surface-soft); }
.board-choice:focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: 2px; }
.board-icon { height: 40px; display: grid; place-items: center; border-radius: 11px; color: #fff; font-size: 19px; }
.board-copy { min-width: 0; }
.board-copy b, .board-copy small { display: block; }
.board-copy b { font-size: 13px; }
.board-copy small { margin-top: 3px; overflow: hidden; color: var(--cpu-text-muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.board-count { color: var(--cpu-text-muted); font-size: 10px; }
.announcement-link { color: var(--cpu-primary); font-size: 12px; text-decoration: none; }
@media (max-width: 640px) {
  .forum-hub { gap: 11px; }
  .forum-hub-head h1 { font-size: 20px; }
  .forum-hub-head p { display: none; }
  .boards-button { display: none; }
  .channel-tabs { margin-inline: -2px; }
  .channel-tabs button { min-height: 33px; padding: 0 11px; }
  .feed-panel { margin-inline: -4px; padding: 10px 8px; border-radius: 12px; }
  .feed-list { gap: 7px; }
  .board-grid { grid-template-columns: 1fr; }
}
</style>
