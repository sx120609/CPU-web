<template>
  <div class="second-hand-page">
    <section class="entry-grid" aria-label="二手交流快捷入口">
      <button type="button" class="entry-card entry-card--sell" @click="openPost('sell')">
        <span class="entry-icon"><el-icon><Goods /></el-icon></span>
        <span class="entry-copy"><b>发布闲置</b><small>写清物品状态与期望价格</small></span>
        <el-icon class="entry-arrow"><ArrowRight /></el-icon>
      </button>
      <button type="button" class="entry-card entry-card--wanted" @click="openPost('wanted')">
        <span class="entry-icon"><el-icon><Search /></el-icon></span>
        <span class="entry-copy"><b>发布求购</b><small>说清需求、预算与校区</small></span>
        <el-icon class="entry-arrow"><ArrowRight /></el-icon>
      </button>
      <button type="button" class="entry-card entry-card--talk" @click="openPost('discuss')">
        <span class="entry-icon"><el-icon><ChatDotRound /></el-icon></span>
        <span class="entry-copy"><b>发起讨论</b><small>询价、避坑或分享经验</small></span>
        <el-icon class="entry-arrow"><ArrowRight /></el-icon>
      </button>
    </section>

    <section class="safety-note" aria-label="二手交流说明">
      <span class="safety-icon">🛡️</span>
      <div>
        <b>本站只提供信息发布与公开交流</b>
        <p>不提供站内下单、支付、担保、退款或结算。请自行核验物品与对方身份，谨慎分享联系方式，优先选择安全的校内公共场所沟通。</p>
      </div>
    </section>

    <section class="topic-panel cpu-card">
      <header class="topic-panel-head">
        <div>
          <span class="section-eyebrow">COMMUNITY POSTS</span>
          <h2>{{ appliedSearch ? `“${appliedSearch}”的搜索结果` : '二手交流帖' }}</h2>
          <p v-if="board">{{ board.description }} · {{ total }} 条公开内容</p>
        </div>
        <div class="topic-actions">
          <form class="topic-search" role="search" @submit.prevent="applySearch">
            <el-input v-model="searchInput" clearable maxlength="80" placeholder="搜索闲置、求购或交流帖">
              <template #prefix><el-icon><Search /></el-icon></template>
            </el-input>
            <el-button native-type="submit" type="primary">搜索</el-button>
          </form>
          <el-radio-group v-model="sort" size="default" @change="changeSort">
            <el-radio-button value="new">最新</el-radio-button>
            <el-radio-button value="hot">最热</el-radio-button>
          </el-radio-group>
          <el-button v-if="appliedSearch" text type="primary" @click="clearSearch">清除搜索</el-button>
        </div>
      </header>

      <div v-if="error && !loading" class="load-state">
        <el-empty :description="error"><el-button type="primary" @click="reload">重试</el-button></el-empty>
      </div>
      <template v-else>
        <div v-if="pinnedList.length" class="pinned-block">
          <div class="list-label"><span>置顶</span><small>{{ pinnedList.length }} 条</small></div>
          <TopicListItem v-for="topic in pinnedList" :key="`pinned-${topic.id}`" :topic="topic" />
        </div>
        <div class="topic-list" v-loading="loading">
          <TopicListItem v-for="topic in list" :key="topic.id" :topic="topic" />
          <el-empty
            v-if="!loading && !list.length"
            :description="appliedSearch ? '没有找到相关帖子，换个关键词试试' : '还没有二手交流帖，来发布第一条吧'"
          >
            <el-button type="primary" @click="openPost('sell')">发布闲置</el-button>
          </el-empty>
        </div>
        <el-pagination
          v-if="total > pageSize"
          :current-page="page"
          :page-size="pageSize"
          :total="total"
          layout="prev, pager, next"
          class="pager"
          @current-change="changePage"
        />
      </template>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ArrowRight, ChatDotRound, Goods, Search } from "@element-plus/icons-vue";
import TopicListItem from "@/components/forum/TopicListItem.vue";
import { boardApi, type Board } from "@/api/board";
import { topicApi, type Topic } from "@/api/topic";
import { useAuthStore } from "@/stores/auth";

type SecondHandPostKind = "sell" | "wanted" | "discuss";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const board = ref<Board | null>(null);
const pinnedList = ref<Topic[]>([]);
const list = ref<Topic[]>([]);
const total = ref(0);
const page = ref(Math.max(1, Number(route.query.page ?? 1) || 1));
const pageSize = 20;
const sort = ref<"new" | "hot">(route.query.sort === "hot" ? "hot" : "new");
const searchInput = ref(typeof route.query.q === "string" ? route.query.q : "");
const appliedSearch = ref(searchInput.value.trim());
const loading = ref(false);
const error = ref("");
let loadSequence = 0;

const routeQuery = computed(() => ({
  ...(appliedSearch.value ? { q: appliedSearch.value } : {}),
  ...(sort.value === "hot" ? { sort: "hot" } : {}),
  ...(page.value > 1 ? { page: String(page.value) } : {}),
}));

void reload();

async function reload() {
  const sequence = ++loadSequence;
  loading.value = true;
  error.value = "";
  try {
    const params = {
      board: "market",
      q: appliedSearch.value || undefined,
      sort: sort.value,
    } as const;
    const [nextBoard, pins, topics] = await Promise.all([
      boardApi.detail("market", { suppressErrorMessage: true }),
      topicApi.list({ ...params, size: pageSize, pinned: "only" }, { suppressErrorMessage: true }),
      topicApi.list({ ...params, page: page.value, size: pageSize, pinned: "exclude" }, { suppressErrorMessage: true }),
    ]);
    if (sequence !== loadSequence) return;
    board.value = nextBoard;
    pinnedList.value = pins.list;
    list.value = topics.list;
    total.value = topics.total;
  } catch (requestError) {
    if (sequence !== loadSequence) return;
    const status = (requestError as { response?: { status?: number; data?: { message?: string } } })?.response?.status;
    if (status === 403) {
      await router.replace({ name: "forum", query: { redirect: route.fullPath } });
      return;
    }
    error.value = status === 404
      ? "二手交流板块不存在或已关闭"
      : (requestError as { response?: { data?: { message?: string } } })?.response?.data?.message || "内容加载失败，请稍后再试";
  } finally {
    if (sequence === loadSequence) loading.value = false;
  }
}

async function syncRouteAndReload() {
  await router.replace({ name: "market", query: routeQuery.value });
  await reload();
}

function applySearch() {
  appliedSearch.value = searchInput.value.trim().slice(0, 80);
  page.value = 1;
  void syncRouteAndReload();
}

function clearSearch() {
  searchInput.value = "";
  appliedSearch.value = "";
  page.value = 1;
  void syncRouteAndReload();
}

function changeSort() {
  page.value = 1;
  void syncRouteAndReload();
}

function changePage(nextPage: number) {
  page.value = nextPage;
  void syncRouteAndReload().then(() => window.scrollTo({ top: 0, behavior: "smooth" }));
}

function openPost(kind: SecondHandPostKind) {
  const target = { name: "post", query: { board: "market", kind } };
  if (!auth.isLoggedIn) {
    const redirect = router.resolve(target).fullPath;
    void router.push({ name: "login", query: { redirect } });
    return;
  }
  void router.push(target);
}
</script>

<style scoped>
.second-hand-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.section-eyebrow { font-size: 11px; font-weight: 800; letter-spacing: 0.12em; }

.entry-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.entry-card {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 20px;
  border: 1px solid transparent;
  border-radius: 17px;
  color: var(--cpu-text);
  text-align: left;
  cursor: pointer;
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
}
.entry-card:hover { transform: translateY(-2px); box-shadow: var(--cpu-shadow-md); }
.entry-card:focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: 2px; }
.entry-card--sell { border-color: rgba(13, 148, 136, 0.28); background: linear-gradient(135deg, rgba(45, 212, 191, 0.16), rgba(96, 165, 250, 0.14)); }
.entry-card--wanted { border-color: rgba(245, 158, 11, 0.28); background: linear-gradient(135deg, rgba(251, 191, 36, 0.18), rgba(251, 113, 133, 0.12)); }
.entry-card--talk { border-color: rgba(139, 92, 246, 0.25); background: linear-gradient(135deg, rgba(167, 139, 250, 0.17), rgba(96, 165, 250, 0.12)); }
.entry-icon { flex: 0 0 48px; height: 48px; display: grid; place-items: center; border-radius: 14px; background: rgba(255, 255, 255, 0.66); color: var(--cpu-primary); font-size: 23px; }
.entry-copy { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 5px; }
.entry-copy b { font-size: 16px; }
.entry-copy small { color: var(--cpu-text-secondary); line-height: 1.45; }
.entry-arrow { flex-shrink: 0; color: var(--cpu-text-muted); }

.safety-note { display: flex; align-items: flex-start; gap: 12px; padding: 14px 16px; border: 1px solid rgba(245, 158, 11, 0.28); border-radius: 14px; background: rgba(245, 158, 11, 0.08); }
.safety-icon { font-size: 20px; line-height: 1.4; }
.safety-note b { color: var(--cpu-text); font-size: 13px; }
.safety-note p { margin: 3px 0 0; color: var(--cpu-text-secondary); font-size: 12px; line-height: 1.65; }

.cpu-card { border: 1px solid var(--cpu-border-soft); border-radius: 18px; background: var(--cpu-card); box-shadow: var(--cpu-shadow-sm); }
.topic-panel { overflow: hidden; padding: 20px 18px 14px; }
.topic-panel-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; padding: 0 8px 15px; border-bottom: 1px solid var(--cpu-border-soft); }
.section-eyebrow { color: var(--cpu-primary); }
.topic-panel-head h2 { margin: 4px 0 0; color: var(--cpu-text); font-size: 21px; }
.topic-panel-head p { margin: 5px 0 0; color: var(--cpu-text-secondary); font-size: 12px; }
.topic-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-shrink: 0; flex-wrap: wrap; }
.topic-search { display: grid; grid-template-columns: minmax(220px, 320px) auto; gap: 8px; }
.topic-list { min-height: 120px; padding-top: 6px; }
.pinned-block { margin: 12px 0 4px; padding: 8px 4px 4px; border: 1px solid rgba(239, 68, 68, 0.18); border-radius: 12px; background: rgba(239, 68, 68, 0.04); }
.list-label { display: flex; justify-content: space-between; align-items: center; padding: 0 10px 5px; }
.list-label span { color: #dc2626; font-size: 13px; font-weight: 700; }
.list-label small { color: var(--cpu-text-muted); }
.load-state { padding: 28px 12px; }
.pager { display: flex; justify-content: center; padding: 14px 0 2px; }

@media (max-width: 1000px) {
  .topic-panel-head { align-items: flex-start; flex-direction: column; }
  .topic-actions { width: 100%; justify-content: flex-start; }
  .topic-search { flex: 1; }
}

@media (max-width: 720px) {
  .second-hand-page { gap: 14px; }
  .entry-grid { grid-template-columns: 1fr; gap: 10px; }
  .entry-card { padding: 15px; border-radius: 14px; }
  .entry-icon { flex-basis: 44px; height: 44px; border-radius: 12px; }
  .topic-panel { padding: 16px 8px 10px; border-radius: 14px; }
  .topic-panel-head { align-items: flex-start; flex-direction: column; padding: 0 6px 12px; }
  .topic-actions { width: 100%; align-items: stretch; flex-direction: column; }
  .topic-search { grid-template-columns: minmax(0, 1fr) auto; }
  .topic-actions :deep(.el-radio-group) { align-self: flex-start; }
}
</style>
