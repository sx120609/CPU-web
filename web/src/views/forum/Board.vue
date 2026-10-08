<template>
  <div class="board-page">
    <div v-if="board" class="board-head">
      <div class="head-left">
        <div class="head-icon" :style="{ background: board.color || '#168776' }"><AppIcon :legacy="board.icon" :name="board.type" /></div>
        <div>
          <h2 class="head-name">{{ boardDisplayName }}</h2>
          <p class="head-desc">{{ boardDisplayDescription }}</p>
          <div class="head-meta">
            <span>{{ board.topicCount }} 帖</span>
            <span v-if="board.anonymousEnabled" class="anon-tag">支持匿名</span>
            <span v-if="board.readOnly" class="ro-tag">公告板</span>
            <a v-if="board.feedSource?.homepage" :href="board.feedSource.homepage" target="_blank" rel="noopener noreferrer" class="ro-link">查看来源 →</a>
          </div>
        </div>
      </div>
      <div class="head-right">
        <el-radio-group v-model="sort" size="default" @change="onSortChange">
          <el-radio-button value="new">最新</el-radio-button>
          <el-radio-button value="hot">最热</el-radio-button>
        </el-radio-group>
        <el-button v-if="canPost" type="primary" @click="goPost">
          <el-icon><Edit /></el-icon> 发帖
        </el-button>
      </div>
    </div>

    <ForumAdCarousel v-if="forumAds.length" :ads="forumAds" />

    <div v-if="error && !loading" class="topic-list cpu-card board-error">
      <el-empty :description="error">
        <el-button type="primary" @click="reload()">重试</el-button>
      </el-empty>
    </div>

    <template v-else>
      <div v-if="orderedPinnedList.length" class="topic-list cpu-card pinned-list">
        <div class="section-head">
          <h3>置顶帖</h3>
          <span>{{ orderedPinnedList.length }} 条</span>
        </div>
        <TopicListItem v-for="t in orderedPinnedList" :key="`pin-${t.id}`" :topic="t" />
      </div>

      <div class="topic-list cpu-card" v-loading="loading">
        <div class="section-head board-summary">
          <div class="section-head-copy">
            <h3>{{ sort === "hot" ? "热门讨论" : "最新内容" }}</h3>
            <span>{{ sort === "hot" ? "综合互动与浏览热度排列" : "按最近发布与回复时间排列" }}</span>
          </div>
          <div class="section-count" aria-label="当前页帖子数量">
            <strong>{{ list.length }}</strong>
            <span>/ {{ total }}</span>
          </div>
        </div>
        <TopicListItem v-for="t in list" :key="t.id" :topic="t" />
        <el-empty v-if="!loading && !list.length" description="还没有帖子" />
        <el-pagination
          v-if="total > size"
          :current-page="page"
          :page-size="size"
          :total="total"
          layout="prev, pager, next"
          class="pager"
          @current-change="onPage"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import { Edit } from "@element-plus/icons-vue";
import TopicListItem from "@/components/forum/TopicListItem.vue";
import ForumAdCarousel from "@/components/forum/ForumAdCarousel.vue";
import AppIcon from "@/components/common/AppIcon.vue";
import { boardApi, type Board } from "@/api/board";
import { forumAdsApi, type ForumAd } from "@/api/forumAds";
import { topicApi } from "@/api/topic";
import { useAuthStore } from "@/stores/auth";
import { clearForumListRestoreState, readForumListRestoreState, writeForumListRestoreState } from "@/utils/forumListRestore";
import { forumCacheScope, readForumBoardPage, writeForumBoardPage } from "@/utils/forumCache";

type BoardRestoreState = {
  scrollY: number;
  page?: number;
  sort?: "new" | "hot";
  savedAt: number;
};

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const board = ref<Board | null>(null);
const pinnedList = ref<any[]>([]);
const list = ref<any[]>([]);
const total = ref(0);
const forumAds = ref<ForumAd[]>([]);
const page = ref(1);
const size = ref(20);
const sort = ref<"new" | "hot">("new");
const loading = ref(false);
const error = ref("");
let pendingRestoreState: BoardRestoreState | null = null;
let loadSeq = 0;

const boardSlug = computed(() => String(route.params.slug || (route.name === "market" ? "market" : "")));
const canPost = computed(() => !!board.value && !board.value.readOnly && auth.canAccessForum);
const boardDisplayName = computed(() => board.value?.name || "");
const boardDisplayDescription = computed(() => board.value?.description || "");
const orderedPinnedList = computed(() => pinnedList.value);

watch(() => route.fullPath, async () => {
  const restored = readForumListRestoreState<BoardRestoreState>(route.fullPath);
  page.value = Math.max(1, Number(restored?.page ?? 1) || 1);
  sort.value = restored?.sort === "hot" ? "hot" : "new";
  pendingRestoreState = restored;
  await reload();
  void loadAd();
}, { immediate: true });

async function reload(options: { scrollToTop?: boolean } = {}) {
  const seq = ++loadSeq;
  const slug = boardSlug.value;
  const scope = forumCacheScope(auth.user);
  const cached = readForumBoardPage(scope, slug, page.value, sort.value);
  if (cached) {
    board.value = cached.board;
    pinnedList.value = cached.pins;
    list.value = cached.list;
    total.value = cached.total;
  }
  loading.value = !cached;
  error.value = "";
  try {
    const nextBoard = await boardApi.detail(slug, { suppressErrorMessage: true });
    const [pins, normal] = await Promise.all([
      topicApi.list({ board: slug, size: 20, sort: "new", pinned: "only" }, { suppressErrorMessage: true }),
      topicApi.list({ board: slug, page: page.value, size: size.value, sort: sort.value, pinned: "exclude" }, { suppressErrorMessage: true }),
    ]);
    if (seq !== loadSeq) return;
    board.value = nextBoard;
    pinnedList.value = pins?.list ?? [];
    list.value = normal.list;
    total.value = normal.total;
    writeForumBoardPage(scope, slug, page.value, sort.value, {
      board: nextBoard,
      pins: pins?.list ?? [],
      list: normal.list,
      total: normal.total,
    });
  } catch (e) {
    if (seq !== loadSeq) return;
    if ((e as { response?: { status?: number } })?.response?.status === 403) {
      router.replace({ name: "forum", query: { redirect: route.fullPath } });
      return;
    }
    if ((e as { response?: { status?: number } })?.response?.status === 404) {
      board.value = null;
      pinnedList.value = [];
      list.value = [];
      total.value = 0;
      error.value = normalizeBoardError(e);
    } else if (!cached) {
      pinnedList.value = [];
      list.value = [];
      total.value = 0;
      error.value = normalizeBoardError(e);
    }
  } finally {
    if (seq !== loadSeq) return;
    loading.value = false;
    if (!error.value && pendingRestoreState) {
      await restoreScrollIfNeeded();
    } else if (!error.value && options.scrollToTop) {
      await scrollToTop();
    }
  }
}

async function loadAd() {
  try {
    forumAds.value = await forumAdsApi.list("forum-board-top");
  } catch {
    forumAds.value = [];
  }
}

function normalizeBoardError(error: unknown) {
  const status = (error as { response?: { status?: number; data?: { message?: string } } })?.response?.status;
  if (status === 404) return "板块不存在或已关闭";
  if (status && status < 500) {
    return (error as { response?: { data?: { message?: string } } })?.response?.data?.message || "板块内容加载失败";
  }
  return "板块内容加载失败，请稍后再试";
}

function onPage(p: number) {
  page.value = p;
  void reload({ scrollToTop: true });
}

function onSortChange() {
  page.value = 1;
  void reload({ scrollToTop: true });
}

function goPost() {
  if (!auth.isLoggedIn) {
    router.push({ name: "login", query: { redirect: route.fullPath } });
    return;
  }
  router.push({ name: "post", query: { board: boardSlug.value } });
}

async function restoreScrollIfNeeded() {
  if (!pendingRestoreState) return;
  const scrollY = Math.max(0, Number(pendingRestoreState.scrollY || 0));
  await nextTick();
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      window.scrollTo({ top: scrollY, behavior: "auto" });
      resolve();
    });
  });
  clearForumListRestoreState(route.fullPath);
  pendingRestoreState = null;
}

async function scrollToTop() {
  await nextTick();
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "auto" });
      resolve();
    });
  });
}

function persistRestoreState() {
  if (!board.value || !route.fullPath) return;
  writeForumListRestoreState(route.fullPath, {
    scrollY: window.scrollY,
    page: page.value,
    sort: sort.value,
  });
}

onBeforeRouteLeave((to) => {
  if (to.name === "topic") persistRestoreState();
});
</script>

<style scoped lang="scss">
@use "../../styles/compact" as *;

.board-page { display: flex; max-width: 1120px; margin: 0 auto; flex-direction: column; gap: 12px; color: var(--cpu-text); font-size: var(--cpu-fs-m); line-height: 1.6; }
.board-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin: 0 4px; }
.head-left { display: flex; min-width: 0; align-items: center; gap: 12px; }
.head-left > div:last-child { min-width: 0; }
.head-icon { display: grid; width: 48px; height: 48px; flex-shrink: 0; place-items: center; border-radius: var(--cpu-radius-l); color: #fff; font-size: 24px; }
.head-name { margin: 0; font-size: var(--cpu-fs-xl); font-weight: 700; line-height: 1.3; }
.head-desc { margin: 0; color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); overflow-wrap: anywhere; }
.head-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; margin-top: 4px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
.ro-tag, .anon-tag { height: 18px; padding: 0 5px; border-radius: var(--cpu-radius-s); line-height: 18px; box-shadow: inset 0 0 0 1px var(--cpu-border); }
.ro-link { color: var(--cpu-primary); text-decoration: none; }
.head-right { display: flex; flex-shrink: 0; align-items: center; gap: 8px; }
.cpu-card { padding: 0; overflow: hidden; border: 0; border-radius: var(--cpu-radius-l); background: var(--cpu-card); box-shadow: none; }
.cpu-card:hover { transform: none; box-shadow: none; }
.cpu-card :deep(.forum-ad-carousel) { padding: 12px 12px 0; }
.cpu-card :deep(.forum-ad-card) { border-radius: var(--cpu-radius-m); background: var(--cpu-surface-soft); }
.section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 14px 16px 6px; }
.section-head h3 { margin: 0; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); font-weight: 500; }
.section-head span { color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); }
.section-head-copy { display: flex; min-width: 0; align-items: baseline; gap: 8px; }
.section-count { display: inline-flex; flex: 0 0 auto; align-items: baseline; gap: 4px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); font-variant-numeric: tabular-nums; }
.section-count strong { font-weight: 500; }
.board-error { padding: 24px 12px; }
.pager { display: flex; justify-content: center; padding: 12px; }
// Desktop layout on a touch tablet: finger-sized page buttons.
@include expanded-touch {
  .pager {
    --el-pagination-button-width: 40px;
    --el-pagination-button-height: 40px;
  }
}
@media (max-width: 700px) {
  .board-head { flex-direction: column; align-items: stretch; }
  .head-right { justify-content: space-between; }
  .head-right .el-button { flex: 1; }
}
</style>
