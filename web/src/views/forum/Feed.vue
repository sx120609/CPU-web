<template>
  <div class="feed-page">
    <div class="feed-head">
      <div>
        <h2 class="title">{{ isHot ? "热榜 Top 10" : "最新内容" }}</h2>
        <p class="desc">
          {{ isHot ? "这里展示近 24 小时讨论最活跃的内容。" : "这里按照发布时间查看近期更新。" }}
        </p>
      </div>
    </div>

    <section class="cpu-card" v-loading="loading">
      <template v-if="isHot">
        <div v-for="item in hotList" :key="item.id" class="rank-row" @click="openHotTopic(item.id)">
          <div class="rank-no" :class="{ top3: item.rank <= 3 }">#{{ item.rank }}</div>
          <div class="rank-main">
            <div class="rank-title">{{ item.title }}</div>
            <div class="rank-meta">
              <span>{{ item.board?.name }}</span>
              <span>{{ item.replyCount }} 回</span>
              <span>{{ item.likeCount }} 赞</span>
              <span>{{ fmtRelative(item.lastReplyAt || item.createdAt) }}</span>
            </div>
          </div>
          <div class="rank-score">{{ Math.round(item.hotScore || 0) }}</div>
        </div>
      </template>

      <template v-else>
        <div v-if="pinnedList.length" class="pin-section">
          <div class="section-head">
            <h3>全局置顶</h3>
            <span>{{ pinnedList.length }} 条</span>
          </div>
          <TopicListItem v-for="t in pinnedList" :key="`pin-${t.id}`" :topic="t" />
        </div>
        <div class="section-head" v-if="latestList.length || latestTotal">
          <h3>最新内容</h3>
          <span>已显示 {{ latestList.length }} / {{ latestTotal }}</span>
        </div>
        <TopicListItem v-for="t in latestList" :key="t.id" :topic="t" />
        <div v-if="latestTotal > latestSize" class="latest-actions">
          <div
            v-if="canLoadMore"
            ref="loadMoreSentinelRef"
            class="auto-load-sentinel"
            :class="{ loading: loadingMore }"
          >
            {{ loadingMore ? "正在加载更多…" : "继续下滑自动加载更多" }}
          </div>
          <div v-else-if="latestList.length" class="auto-load-sentinel done">
            已加载全部内容
          </div>
          <el-button v-if="latestList.length > latestSize" text @click="backToTop">
            回到顶部
          </el-button>
        </div>
      </template>

      <el-empty v-if="!loading && !currentList.length" description="暂无内容" />
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import TopicListItem from "@/components/forum/TopicListItem.vue";
import { homeApi } from "@/api/home";
import { fmtRelative } from "@/utils/format";
import { clearForumListRestoreState, readForumListRestoreState, writeForumListRestoreState } from "@/utils/forumListRestore";

type LatestFeedRestoreState = {
  scrollY: number;
  latestPage?: number;
  savedAt: number;
};

const route = useRoute();
const router = useRouter();
const isHot = computed(() => route.name === "forum-hot");
const loading = ref(false);
const loadingMore = ref(false);
const hotList = ref<any[]>([]);
const pinnedList = ref<any[]>([]);
const latestList = ref<any[]>([]);
const latestTotal = ref(0);
const latestPage = ref(1);
const latestSize = ref(15);
const loadMoreSentinelRef = ref<HTMLElement | null>(null);
const currentList = computed(() => isHot.value ? hotList.value : [...pinnedList.value, ...latestList.value]);
const canLoadMore = computed(() => !isHot.value && latestList.value.length < latestTotal.value);
let loadMoreObserver: IntersectionObserver | null = null;
let pendingRestoreState: LatestFeedRestoreState | null = null;

watch(() => route.fullPath, () => {
  resetState();
  pendingRestoreState = !isHot.value ? readForumListRestoreState<LatestFeedRestoreState>(route.fullPath) : null;
  if (pendingRestoreState?.latestPage && pendingRestoreState.latestPage > 1) {
    latestPage.value = pendingRestoreState.latestPage;
  }
  void load();
}, { immediate: true });

watch(canLoadMore, async (value) => {
  if (!loadMoreObserver) return;
  loadMoreObserver.disconnect();
  if (!value) return;
  await nextTick();
  if (loadMoreSentinelRef.value) {
    loadMoreObserver.observe(loadMoreSentinelRef.value);
  }
});

onMounted(() => {
  if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") return;
  loadMoreObserver = new IntersectionObserver((entries) => {
    const entry = entries[0];
    if (!entry?.isIntersecting || loading.value || loadingMore.value || !canLoadMore.value) return;
    void loadMore();
  }, {
    root: null,
    rootMargin: "240px 0px 320px 0px",
    threshold: 0.01,
  });
});

onBeforeUnmount(() => {
  loadMoreObserver?.disconnect();
  loadMoreObserver = null;
});

async function load() {
  loading.value = true;
  try {
    if (isHot.value) {
      hotList.value = await homeApi.hotRanking();
      pinnedList.value = [];
      latestList.value = [];
      latestTotal.value = 0;
      return;
    }
    if (latestPage.value > 1) {
      const pages = await Promise.all(
        Array.from({ length: latestPage.value }, (_, index) => homeApi.latestFeed({ page: index + 1, size: latestSize.value })),
      );
      pinnedList.value = pages[0]?.pins ?? [];
      latestTotal.value = pages[0]?.total ?? 0;
      latestList.value = dedupeTopicsById(pages.flatMap((pageResult) => pageResult.list ?? []));
    } else {
      const res = await homeApi.latestFeed({ page: latestPage.value, size: latestSize.value });
      pinnedList.value = res.pins ?? [];
      latestList.value = res.list ?? [];
      latestTotal.value = res.total;
    }
  } finally {
    loading.value = false;
    if (!isHot.value) {
      await nextTick();
      await restoreScrollIfNeeded();
      if (loadMoreObserver && canLoadMore.value && loadMoreSentinelRef.value) {
        loadMoreObserver.disconnect();
        loadMoreObserver.observe(loadMoreSentinelRef.value);
      }
    }
  }
}

function resetState() {
  hotList.value = [];
  pinnedList.value = [];
  latestList.value = [];
  latestTotal.value = 0;
  latestPage.value = 1;
}

async function loadMore() {
  if (!canLoadMore.value || loadingMore.value) return;
  loadingMore.value = true;
  loadMoreObserver?.disconnect();
  const nextPage = latestPage.value + 1;
  try {
    const res = await homeApi.latestFeed({ page: nextPage, size: latestSize.value });
    latestPage.value = nextPage;
    pinnedList.value = res.pins ?? pinnedList.value;
    latestTotal.value = res.total;
    latestList.value = [...latestList.value, ...(res.list ?? [])];
  } finally {
    loadingMore.value = false;
    await nextTick();
    if (loadMoreObserver && canLoadMore.value && loadMoreSentinelRef.value) {
      loadMoreObserver.observe(loadMoreSentinelRef.value);
    }
  }
}

function backToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function dedupeTopicsById(items: any[]) {
  const seen = new Set<number>();
  return items.filter((item) => {
    const id = Number(item?.id || 0);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

async function restoreScrollIfNeeded() {
  if (!pendingRestoreState) return;
  const scrollY = Math.max(0, Number(pendingRestoreState.scrollY || 0));
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      window.scrollTo({ top: scrollY, behavior: "auto" });
      resolve();
    });
  });
  clearForumListRestoreState(route.fullPath);
  pendingRestoreState = null;
}

function persistRestoreState() {
  if (isHot.value || !latestList.value.length || !route.fullPath) return;
  writeForumListRestoreState(route.fullPath, {
    scrollY: window.scrollY,
    latestPage: latestPage.value,
  });
}

function openHotTopic(id: number) {
  router.push({
    path: `/forum/topic/${id}`,
    query: { from: route.fullPath },
  });
}

onBeforeRouteLeave((to) => {
  if (to.name === "topic") persistRestoreState();
});
</script>

<style scoped>
.feed-page { display: flex; flex-direction: column; gap: 16px; }
.feed-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.title { margin: 0; font-size: 22px; color: #111827; }
.desc { margin: 6px 0 0; font-size: 13px; color: #6b7280; line-height: 1.65; }
.cpu-card { background: #fff; border-radius: 12px; padding: 14px 16px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04); }
.pin-section {
  margin-bottom: 12px;
  border: 1px solid #fee2e2;
  border-radius: 12px;
  background: linear-gradient(180deg, #fff9f9 0%, #ffffff 100%);
}
.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 10px 8px;
}
.section-head h3 {
  margin: 0;
  font-size: 15px;
  color: #111827;
}
.section-head span {
  font-size: 12px;
  color: #9ca3af;
}

.rank-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 12px 4px;
  border-bottom: 1px dashed #eef2f7;
  cursor: pointer;
  min-width: 0;
  overflow: hidden;
}
.rank-row:last-child { border-bottom: none; }
.rank-no {
  min-width: 44px;
  font-size: 13px;
  font-weight: 800;
  color: #94a3b8;
}
.rank-no.top3 { color: #dc2626; }
.rank-title { font-size: 15px; font-weight: 600; color: #111827; line-height: 1.5; overflow-wrap: anywhere; min-width: 0; }
.rank-meta {
  margin-top: 4px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 12px;
  color: #6b7280;
  min-width: 0;
}
.rank-score {
  min-width: 50px;
  text-align: right;
  font-size: 18px;
  font-weight: 700;
  color: var(--cpu-primary);
}
.latest-actions {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 12px;
  padding-top: 14px;
}

.auto-load-sentinel {
  width: 100%;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px dashed #d8e2ee;
  background: #f8fafc;
  color: #6b7280;
  font-size: 13px;
  text-align: center;
}

.auto-load-sentinel.loading {
  color: var(--cpu-primary);
  border-color: rgba(22, 135, 118, 0.28);
  background: rgba(22, 135, 118, 0.06);
}

.auto-load-sentinel.done {
  color: #94a3b8;
}

@media (max-width: 700px) {
  .feed-page { gap: 12px; }
  .title { font-size: 20px; }
  .cpu-card { border-radius: 10px; padding: 12px; }
  .section-head {
    padding: 8px 8px 6px;
  }
  .rank-row {
    grid-template-columns: auto minmax(0, 1fr);
  }
  .rank-score {
    grid-column: 2;
    text-align: left;
    min-width: 0;
    font-size: 14px;
  }

  .latest-actions {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
