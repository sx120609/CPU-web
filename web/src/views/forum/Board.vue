<template>
  <div class="board-page">
    <div v-if="board" class="board-head">
      <div class="head-left">
        <div class="head-icon" :style="{ background: board.color || '#168776' }">{{ board.icon || fallbackBoardIcon }}</div>
        <div>
          <h2 class="head-name">{{ boardDisplayName }}</h2>
          <p class="head-desc">{{ boardDisplayDescription }}</p>
          <div class="head-meta">
            <span>{{ board.topicCount }} 帖</span>
            <span v-if="board.anonymousEnabled" class="anon-tag">支持匿名</span>
            <span v-if="board.readOnly" class="ro-tag">{{ board.slug === 'campus-wall' ? '逛逛镜像' : '公告板' }}</span>
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
        <div class="section-head">
          <h3>{{ sort === "hot" ? "按热度查看" : "按时间查看" }}</h3>
          <span>{{ total }} 条</span>
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
import { boardApi, type Board } from "@/api/board";
import { topicApi } from "@/api/topic";
import { useAuthStore } from "@/stores/auth";
import { clearForumListRestoreState, readForumListRestoreState, writeForumListRestoreState } from "@/utils/forumListRestore";

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
const page = ref(1);
const size = ref(20);
const sort = ref<"new" | "hot">("new");
const loading = ref(false);
const error = ref("");
let pendingRestoreState: BoardRestoreState | null = null;
let loadSeq = 0;

const canPost = computed(() => !!board.value && !board.value.readOnly && auth.canAccessForum);
const boardDisplayName = computed(() => board.value?.slug === "campus-wall" ? "逛逛" : (board.value?.name || ""));
const boardDisplayDescription = computed(() => (
  board.value?.slug === "campus-wall"
    ? "从外部逛逛同步的只读镜像，自动刷新帖子与评论。"
    : (board.value?.description || "")
));
const fallbackBoardIcon = computed(() => {
  if (board.value?.type === "market") return "🛒";
  if (board.value?.type === "question") return "❓";
  if (board.value?.type === "coursereview") return "📚";
  if (board.value?.type === "announce") return "📢";
  return "💬";
});
const orderedPinnedList = computed(() => {
  return pinnedList.value.filter((item) => !item?.metadata?.weiwallHotEntry);
});

watch(() => route.fullPath, async () => {
  const restored = readForumListRestoreState<BoardRestoreState>(route.fullPath);
  page.value = Math.max(1, Number(restored?.page ?? 1) || 1);
  sort.value = restored?.sort === "hot" ? "hot" : "new";
  pendingRestoreState = restored;
  await reload();
}, { immediate: true });

async function reload(options: { scrollToTop?: boolean } = {}) {
  const seq = ++loadSeq;
  loading.value = true;
  error.value = "";
  try {
    const slug = String(route.params.slug);
    const nextBoard = await boardApi.detail(slug, { suppressErrorMessage: true });
    const [pins, normal] = await Promise.all([
      topicApi.list({ board: slug, size: 20, sort: "new", pinned: "only" }, { suppressErrorMessage: true }),
      topicApi.list({ board: slug, page: page.value, size: size.value, sort: sort.value, pinned: "exclude" }, { suppressErrorMessage: true }),
    ]);
    if (seq !== loadSeq) return;
    board.value = nextBoard;
    pinnedList.value = (pins?.list ?? []).filter((item) => !item?.metadata?.weiwallHotEntry);
    list.value = normal.list.filter((item: any) => !item?.metadata?.weiwallHotEntry);
    total.value = normal.total;
  } catch (e) {
    if (seq !== loadSeq) return;
    if ((e as { response?: { status?: number } })?.response?.status === 403) {
      router.replace({ name: "forum", query: { redirect: route.fullPath } });
      return;
    }
    if ((e as { response?: { status?: number } })?.response?.status === 404) {
      board.value = null;
    }
    pinnedList.value = [];
    list.value = [];
    total.value = 0;
    error.value = normalizeBoardError(e);
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
  router.push({ name: "post", query: { board: route.params.slug } });
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

<style scoped>
.board-page { display: flex; flex-direction: column; gap: 16px; }

.board-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.head-left { display: flex; gap: 14px; align-items: flex-start; min-width: 0; }
.head-left > div:last-child { min-width: 0; }
.head-icon {
  width: 56px; height: 56px; border-radius: 12px;
  display: grid; place-items: center;
  font-size: 28px; color: #fff;
  flex-shrink: 0;
}

.head-name { margin: 0; font-size: 22px; color: var(--cpu-text); }
.head-desc { margin: 4px 0 6px; font-size: 13px; color: var(--cpu-text-secondary); overflow-wrap: anywhere; }
.head-meta {
  display: flex;
  gap: 14px;
  font-size: 12px;
  color: var(--cpu-text-muted);
  align-items: center;
}
.ro-tag { color: var(--cpu-warn); background: rgba(245, 158, 11, 0.16); padding: 2px 8px; border-radius: 4px; }
.anon-tag { color: #a78bfa; background: rgba(124, 58, 237, 0.16); padding: 2px 8px; border-radius: 4px; }
.ro-link { color: var(--cpu-primary); text-decoration: none; }
.ro-link:hover { text-decoration: underline; }

.head-right { display: flex; gap: 10px; align-items: center; flex-shrink: 0; }

.topic-list { padding: 8px 6px; }
.cpu-card {
  background: var(--cpu-card);
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.04);
}
.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px 10px;
}
.section-head h3 {
  margin: 0;
  font-size: 15px;
  color: var(--cpu-text);
}
.section-head span {
  font-size: 12px;
  color: var(--cpu-text-muted);
}
.pinned-list {
  border: 1px solid rgba(239, 68, 68, 0.24);
  background: linear-gradient(180deg, rgba(239, 68, 68, 0.08) 0%, var(--cpu-card) 100%);
}
.board-error {
  padding: 24px 12px;
}

.pager { padding: 12px; display: flex; justify-content: center; }

@media (max-width: 700px) {
  .board-head {
    flex-direction: column;
  }

  .head-left {
    width: 100%;
  }

  .head-icon {
    width: 48px;
    height: 48px;
    border-radius: 10px;
    font-size: 24px;
  }

  .head-name {
    font-size: 20px;
  }

  .head-desc {
    line-height: 1.55;
  }

  .head-meta {
    gap: 8px;
    flex-wrap: wrap;
    line-height: 1.5;
  }

  .head-right {
    width: 100%;
    justify-content: space-between;
    gap: 8px;
  }

  .head-right .el-button {
    flex: 1;
  }

  .topic-list {
    border-radius: 10px;
    padding: 4px;
  }

  .section-head {
    padding: 8px 8px 10px;
  }

  .pager {
    padding: 10px 0 6px;
  }
}
</style>
