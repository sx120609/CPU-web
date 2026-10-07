<template>
  <div class="announce-page">
    <header class="announce-head">
      <h1>校园公告</h1>
      <p>学校各部门公开网站上的通知，自动同步到这里</p>
    </header>

    <nav v-if="boards.length" class="announce-tabs" aria-label="公告来源">
      <button data-cpu-button="option" type="button" :class="{ active: !activeSlug }" @click="selectSource('')">全部</button>
      <button
        data-cpu-button="option"
        v-for="b in boards"
        :key="b.slug"
        type="button"
        :class="{ active: activeSlug === b.slug }"
        @click="selectSource(b.slug)"
      >
        {{ b.name }}
      </button>
    </nav>

    <p v-if="activeBoard" class="announce-source">
      <span>{{ sourceLine(activeBoard) }}</span>
      <a v-if="activeBoard.feedSource?.homepage" :href="activeBoard.feedSource.homepage" target="_blank" rel="noopener noreferrer">
        原网站<el-icon aria-hidden="true"><TopRight /></el-icon>
      </a>
    </p>

    <section class="announce-list" :aria-busy="loading">
      <div v-if="error && !items.length" class="announce-state">
        <span>{{ error }}</span>
        <el-button type="primary" plain @click="reload">重试</el-button>
      </div>
      <div v-else-if="loading && !items.length" class="announce-state" role="status">正在加载公告…</div>
      <div v-else-if="!items.length" class="announce-state">这个来源还没有公告</div>
      <template v-else>
        <router-link v-for="t in items" :key="t.id" :to="`/forum/topic/${t.id}`" class="announce-item">
          <b>{{ t.title }}</b>
          <span class="announce-item-foot">
            <span v-if="!activeSlug && t.board?.name">{{ t.board.name }}</span>
            <span v-if="!activeSlug && t.board?.name" aria-hidden="true">·</span>
            <time :datetime="t.createdAt">{{ fmtRelative(t.createdAt) }}</time>
            <em v-if="isFresh(t.createdAt)">新</em>
          </span>
        </router-link>
      </template>
    </section>

    <div v-if="items.length" class="announce-more">
      <span v-if="error">{{ error }}<button data-cpu-button="text" type="button" @click="loadMore">重试</button></span>
      <el-button v-else-if="hasMore" :loading="loading" @click="loadMore">加载更多</el-button>
      <span v-else>已经到底了</span>
    </div>
  </div>
</template>

<script lang="ts">
// 从帖子返回时列表要原样还在（浏览器才能回到原来的滚动位置），所以已加载的内容留在模块里，十分钟内直接复用。
type ListSnapshot = { items: Topic[]; total: number; page: number; savedAt: number };
const SNAPSHOT_MS = 10 * 60 * 1000;
const listSnapshots = new Map<string, ListSnapshot>();
let boardsSnapshot: Board[] = [];
</script>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { TopRight } from "@element-plus/icons-vue";
import { boardApi, type Board } from "@/api/board";
import { topicApi, type Topic } from "@/api/topic";
import { fmtRelative } from "@/utils/format";

const PAGE_SIZE = 20;
const FRESH_MS = 2 * 24 * 60 * 60 * 1000;
const hiddenAnnouncementSlugs = new Set(["xinli-notice"]);

const route = useRoute();
const router = useRouter();
const allBoards = ref<Board[]>(boardsSnapshot);
const items = ref<Topic[]>([]);
const total = ref(0);
const page = ref(0);
const loading = ref(false);
const error = ref("");
let loadSeq = 0;
let ready = false;

const boards = computed(() => allBoards.value.filter(isVisibleSource));
const activeSlug = computed(() => {
  const slug = typeof route.query.source === "string" ? route.query.source : "";
  return boards.value.some((b) => b.slug === slug) ? slug : "";
});
const activeBoard = computed(() => boards.value.find((b) => b.slug === activeSlug.value) || null);
const hasMore = computed(() => page.value * PAGE_SIZE < total.value);

restore(activeSlug.value);
watch(activeSlug, (slug) => {
  // 离开本页时地址里的 source 会消失，那不是在切换来源。
  if (!ready || route.name !== "announcements") return;
  if (!restore(slug)) reload();
});

onMounted(async () => {
  // 来源只用来切换和显示说明；它加载失败时仍然可以看“全部”。
  try {
    allBoards.value = boardsSnapshot = await boardApi.list({ suppressErrorMessage: true });
  } catch {
    // 保留上一次的来源列表（可能为空）。
  }
  await nextTick();
  ready = true;
  if (!restore(activeSlug.value)) reload();
});

function restore(slug: string) {
  const snapshot = listSnapshots.get(slug);
  if (!snapshot || Date.now() - snapshot.savedAt > SNAPSHOT_MS) return false;
  loadSeq += 1;
  items.value = snapshot.items;
  total.value = snapshot.total;
  page.value = snapshot.page;
  loading.value = false;
  error.value = "";
  return true;
}

function isVisibleSource(board: Pick<Board, "slug" | "name" | "type">) {
  return board.type === "announce" && !hiddenAnnouncementSlugs.has(board.slug) && !board.name.includes("心理动态");
}

function selectSource(slug: string) {
  if (slug === activeSlug.value) return;
  router.replace({ query: { ...route.query, source: slug || undefined } });
}

function reload() {
  items.value = [];
  total.value = 0;
  page.value = 0;
  return loadMore();
}

async function loadMore() {
  const seq = ++loadSeq;
  const slug = activeSlug.value;
  const nextPage = page.value + 1;
  loading.value = true;
  error.value = "";
  try {
    const result = await topicApi.list(
      slug ? { board: slug, page: nextPage, size: PAGE_SIZE } : { type: "announce", page: nextPage, size: PAGE_SIZE },
      { suppressErrorMessage: true },
    );
    if (seq !== loadSeq) return;
    const known = new Set(items.value.map((t) => t.id));
    const hidden = (t: Topic) => !slug && Boolean(t.board) && hiddenAnnouncementSlugs.has(t.board!.slug);
    items.value = [...items.value, ...result.list.filter((t) => !known.has(t.id) && !hidden(t))];
    total.value = result.total;
    page.value = nextPage;
    // 快照的时间是第一页取回的时间，翻页不延长它。
    const savedAt = nextPage === 1 ? Date.now() : listSnapshots.get(slug)?.savedAt ?? Date.now();
    listSnapshots.set(slug, { items: items.value, total: total.value, page: page.value, savedAt });
  } catch (error_) {
    if (seq !== loadSeq) return;
    error.value = normalizeAnnouncementsError(error_);
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

function sourceLine(board: Board) {
  const parts = [board.description, board.feedSource?.homepage ? `同步自 ${shortHost(board.feedSource.homepage)}` : ""];
  if (board.feedSource?.lastRunAt) parts.push(`${fmtRelative(board.feedSource.lastRunAt)}更新`);
  return parts.filter(Boolean).join(" · ");
}

function isFresh(createdAt: string) {
  return Date.now() - new Date(createdAt).getTime() < FRESH_MS;
}

function shortHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function normalizeAnnouncementsError(error_: unknown) {
  const response = (error_ as { response?: { status?: number; data?: { message?: string } } })?.response;
  if (response?.status && response.status < 500) return response.data?.message || "公告加载失败";
  return "公告加载失败，请稍后再试";
}
</script>

<style scoped>
/* 和论坛列表页同一套：冷灰页面上的白色分组，行与行之间一条细线。 */
.announce-page { display: flex; max-width: 860px; margin: 0 auto; flex-direction: column; gap: 12px; color: var(--cpu-text); font-size: var(--cpu-fs-m); line-height: 1.6; }

.announce-head { margin: 0 4px; }
.announce-head h1 { margin: 0; font-size: var(--cpu-fs-xl); font-weight: 700; line-height: 1.3; }
.announce-head p { margin: 2px 0 0; color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); }

.announce-tabs { display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none; }
.announce-tabs::-webkit-scrollbar { display: none; }
.announce-tabs button { display: inline-flex; min-height: 36px; flex: 0 0 auto; align-items: center; padding: 0 12px; font-size: var(--cpu-fs-m); cursor: pointer; }

.announce-source { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 0 4px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); }
.announce-source span { min-width: 0; }
.announce-source a { display: inline-flex; flex: none; align-items: center; gap: 2px; color: var(--cpu-primary); text-decoration: none; white-space: nowrap; }

.announce-list { overflow: hidden; border-radius: var(--cpu-radius-l); background: var(--cpu-card); }
.announce-item { display: block; padding: 12px 16px; color: inherit; text-decoration: none; }
.announce-item + .announce-item { box-shadow: inset 0 1px 0 var(--cpu-border-soft); }
.announce-item:focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: -2px; }
.announce-item b { display: -webkit-box; overflow: hidden; font-weight: 500; line-height: 1.5; -webkit-box-orient: vertical; -webkit-line-clamp: 2; text-wrap: pretty; }
.announce-item-foot { display: flex; align-items: center; gap: 5px; margin-top: 2px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
.announce-item-foot em { height: 16px; padding: 0 4px; border-radius: var(--cpu-radius-s); background: var(--cpu-accent-soft); color: var(--cpu-accent); font-style: normal; font-weight: 500; line-height: 16px; }

.announce-state { display: flex; min-height: 160px; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 20px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); text-align: center; }
.announce-more { display: flex; min-height: 44px; align-items: center; justify-content: center; gap: 8px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-s); }
.announce-more button[data-cpu-button="text"] { margin-left: 8px; }

@media (hover: hover) {
  .announce-item:hover { background: var(--cpu-surface-soft); }
}
</style>
