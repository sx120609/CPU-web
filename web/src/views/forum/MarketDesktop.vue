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
        <p class="safety-copy-full">不提供站内下单、支付、担保、退款或结算。请自行核验物品与对方身份，谨慎分享联系方式，优先选择安全的校内公共场所沟通。</p>
        <p class="safety-copy-compact">不提供交易担保，请当面核验，勿站内支付。</p>
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
          <el-radio-group v-model="sort" size="default" class="sort-switch" @change="changeSort">
            <el-radio-button value="new">最新</el-radio-button>
            <el-radio-button value="hot">最热</el-radio-button>
          </el-radio-group>
          <el-button v-if="appliedSearch" text type="primary" @click="clearSearch">清除搜索</el-button>
        </div>
      </header>

      <div class="market-filters" aria-label="二手帖子筛选">
        <div class="filter-group filter-group--kind">
          <div class="filter-label-row">
            <span>发布类型</span>
            <button
              type="button"
              class="mobile-filter-trigger"
              :aria-expanded="mobileFiltersOpen"
              @click="mobileFiltersOpen = !mobileFiltersOpen"
            >
              更多筛选<span v-if="advancedFilterCount"> · {{ advancedFilterCount }}</span>
              <el-icon :class="{ 'is-open': mobileFiltersOpen }"><ArrowDown /></el-icon>
            </button>
          </div>
          <el-radio-group v-model="kind" size="default" @change="changeFilter">
            <el-radio-button value="">全部</el-radio-button>
            <el-radio-button value="sell">出闲置</el-radio-button>
            <el-radio-button value="wanted">求购</el-radio-button>
            <el-radio-button value="discuss">讨论</el-radio-button>
          </el-radio-group>
        </div>
        <div class="filter-advanced" :class="{ 'is-open': mobileFiltersOpen }">
          <div class="filter-group">
            <span>物品分类</span>
            <el-select v-model="category" placeholder="全部分类" clearable @change="changeFilter">
              <el-option v-for="item in categoryOptions" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </div>
          <div class="filter-group">
            <span>所在校区</span>
            <el-select v-model="campus" placeholder="全部校区" clearable @change="changeFilter">
              <el-option label="江宁校区" value="江宁校区" />
              <el-option label="玄武门校区" value="玄武门校区" />
              <el-option label="不限校区" value="不限校区" />
            </el-select>
          </div>
          <el-button v-if="hasStructuredFilter" text type="primary" class="filter-reset" @click="clearFilters">重置筛选</el-button>
        </div>
      </div>

      <div v-if="error && !loading" class="load-state">
        <el-empty :description="error"><el-button type="primary" @click="reload">重试</el-button></el-empty>
      </div>
      <template v-else>
        <div v-if="pinnedList.length" class="pinned-block">
          <div class="list-label"><span>置顶</span><small>{{ pinnedList.length }} 条</small></div>
          <div class="market-card-flow">
            <TopicListItem v-for="topic in pinnedList" :key="`pinned-${topic.id}`" :topic="topic" variant="card" />
          </div>
        </div>
        <div class="topic-list" v-loading="loading">
          <div v-if="list.length" class="market-card-flow">
            <TopicListItem v-for="topic in list" :key="topic.id" :topic="topic" variant="card" />
          </div>
          <el-empty v-else-if="!loading" :description="hasActiveFilter ? '当前筛选条件下没有帖子，换个条件试试' : '还没有二手交流帖，来发布第一条吧'">
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
import { ArrowDown, ArrowRight, ChatDotRound, Goods, Search } from "@element-plus/icons-vue";
import TopicListItem from "@/components/forum/TopicListItem.vue";
import { boardApi, type Board } from "@/api/board";
import { topicApi, type Topic } from "@/api/topic";
import { useAuthStore } from "@/stores/auth";

type SecondHandPostKind = "sell" | "wanted" | "discuss";
type SecondHandCategory = "books" | "digital" | "dorm" | "fashion" | "sports" | "tickets" | "digital_goods" | "other";

const categoryOptions: Array<{ value: SecondHandCategory; label: string }> = [
  { value: "books", label: "教材书籍" },
  { value: "digital", label: "数码电器" },
  { value: "dorm", label: "宿舍生活" },
  { value: "fashion", label: "衣物日用" },
  { value: "sports", label: "运动户外" },
  { value: "tickets", label: "票券周边" },
  { value: "digital_goods", label: "电子资料" },
  { value: "other", label: "其他" },
];

function routeEnum<T extends string>(value: unknown, allowed: readonly T[]): T | "" {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : "";
}

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
const kind = ref<SecondHandPostKind | "">(routeEnum(route.query.kind, ["sell", "wanted", "discuss"]));
const category = ref<SecondHandCategory | "">(routeEnum(route.query.category, categoryOptions.map((item) => item.value)));
const campus = ref(routeEnum(route.query.campus, ["江宁校区", "玄武门校区", "不限校区"]));
const mobileFiltersOpen = ref(Boolean(category.value || campus.value));
const loading = ref(false);
const error = ref("");
let loadSequence = 0;

const hasStructuredFilter = computed(() => Boolean(kind.value || category.value || campus.value));
const hasActiveFilter = computed(() => Boolean(appliedSearch.value || hasStructuredFilter.value));
const advancedFilterCount = computed(() => Number(Boolean(category.value)) + Number(Boolean(campus.value)));

const routeQuery = computed(() => ({
  ...(appliedSearch.value ? { q: appliedSearch.value } : {}),
  ...(kind.value ? { kind: kind.value } : {}),
  ...(category.value ? { category: category.value } : {}),
  ...(campus.value ? { campus: campus.value } : {}),
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
      marketKind: kind.value || undefined,
      category: category.value || undefined,
      campus: campus.value || undefined,
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

function changeFilter() {
  page.value = 1;
  void syncRouteAndReload();
}

function clearFilters() {
  kind.value = "";
  category.value = "";
  campus.value = "";
  mobileFiltersOpen.value = false;
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
.entry-card--sell { border-color: color-mix(in srgb, #0d9488 28%, var(--cpu-border)); background: linear-gradient(135deg, color-mix(in srgb, #2dd4bf 16%, var(--cpu-card)), color-mix(in srgb, #60a5fa 14%, var(--cpu-card))); }
.entry-card--wanted { border-color: color-mix(in srgb, #f59e0b 28%, var(--cpu-border)); background: linear-gradient(135deg, color-mix(in srgb, #fbbf24 18%, var(--cpu-card)), color-mix(in srgb, #fb7185 12%, var(--cpu-card))); }
.entry-card--talk { border-color: color-mix(in srgb, #8b5cf6 25%, var(--cpu-border)); background: linear-gradient(135deg, color-mix(in srgb, #a78bfa 17%, var(--cpu-card)), color-mix(in srgb, #60a5fa 12%, var(--cpu-card))); }
.entry-icon { flex: 0 0 48px; height: 48px; display: grid; place-items: center; border-radius: 14px; background: color-mix(in srgb, var(--cpu-card) 84%, transparent); color: var(--cpu-primary); font-size: 23px; }
.entry-copy { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 5px; }
.entry-copy b { font-size: 16px; }
.entry-copy small { color: var(--cpu-text-secondary); line-height: 1.45; }
.entry-arrow { flex-shrink: 0; color: var(--cpu-text-muted); }

.safety-note { display: flex; align-items: flex-start; gap: 12px; padding: 14px 16px; border: 1px solid color-mix(in srgb, #f59e0b 28%, var(--cpu-border)); border-radius: 14px; background: color-mix(in srgb, #f59e0b 8%, var(--cpu-card)); }
.safety-icon { font-size: 20px; line-height: 1.4; }
.safety-note b { color: var(--cpu-text); font-size: 13px; }
.safety-note p { margin: 3px 0 0; color: var(--cpu-text-secondary); font-size: 12px; line-height: 1.65; }
.safety-copy-compact { display: none; }

.cpu-card { border: 1px solid var(--cpu-border-soft); border-radius: 18px; background: var(--cpu-card); box-shadow: var(--cpu-shadow-sm); }
.topic-panel { overflow: hidden; padding: 20px 18px 14px; }
.topic-panel-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; padding: 0 8px 15px; border-bottom: 1px solid var(--cpu-border-soft); }
.section-eyebrow { color: var(--cpu-primary); }
.topic-panel-head h2 { margin: 4px 0 0; color: var(--cpu-text); font-size: 21px; }
.topic-panel-head p { margin: 5px 0 0; color: var(--cpu-text-secondary); font-size: 12px; }
.topic-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-shrink: 0; flex-wrap: wrap; }
.topic-search { display: grid; grid-template-columns: minmax(220px, 320px) auto; gap: 8px; }
.market-filters { display: flex; align-items: flex-end; gap: 12px; padding: 13px 8px 7px; border-bottom: 1px solid var(--cpu-border-soft); flex-wrap: wrap; }
.filter-group { display: flex; flex-direction: column; gap: 6px; min-width: 142px; }
.filter-group > span,
.filter-label-row > span { color: var(--cpu-text-secondary); font-size: 11px; font-weight: 700; }
.filter-group :deep(.el-select) { width: 150px; }
.filter-group--kind { min-width: 0; }
.filter-label-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.mobile-filter-trigger { display: none; }
.filter-advanced { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
.filter-reset { align-self: flex-end; }
.topic-list { min-height: 120px; padding-top: 6px; }
.market-card-flow { columns: 4 220px; column-gap: 12px; padding: 10px 2px 0; }
.pinned-block { margin: 12px 0 4px; padding: 8px 8px 2px; border: 1px solid color-mix(in srgb, #ef4444 18%, var(--cpu-border)); border-radius: 12px; background: color-mix(in srgb, #ef4444 4%, var(--cpu-card)); }
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
  .second-hand-page { gap: 10px; }
  .entry-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
    padding: 6px;
    border: 1px solid var(--cpu-border-soft);
    border-radius: 14px;
    background: color-mix(in srgb, var(--cpu-card) 92%, transparent);
    box-shadow: var(--cpu-shadow-sm);
    backdrop-filter: blur(18px) saturate(140%);
  }
  .entry-card {
    min-height: 40px;
    align-items: center;
    justify-content: center;
    flex-direction: row;
    gap: 5px;
    padding: 0 7px;
    border: 1px solid var(--cpu-border-soft);
    border-radius: 999px;
    background: var(--cpu-surface-soft);
    box-shadow: none;
    color: var(--cpu-text-secondary);
    text-align: center;
  }
  .entry-card:hover,
  .entry-card:focus-visible { transform: none; box-shadow: none; }
  .entry-card--sell {
    border-color: var(--cpu-primary);
    background: var(--cpu-primary);
    color: #fff;
  }
  .entry-card--wanted,
  .entry-card--talk { border-color: var(--cpu-border-soft); background: var(--cpu-surface-soft); }
  .entry-icon {
    flex: 0 0 auto;
    width: auto;
    height: auto;
    border-radius: 0;
    background: transparent;
    color: currentColor;
    font-size: 16px;
  }
  .entry-copy { flex: 0 1 auto; gap: 0; }
  .entry-copy b { font-size: 12px; font-weight: 650; white-space: nowrap; }
  .entry-copy small, .entry-arrow { display: none; }
  .safety-note {
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-color: var(--cpu-border-soft);
    border-radius: 10px;
    background: var(--cpu-card);
  }
  .safety-icon { font-size: 15px; line-height: 1; }
  .safety-note b { font-size: 11px; font-weight: 650; }
  .safety-note p { margin-top: 1px; font-size: 10px; line-height: 1.4; }
  .safety-copy-full { display: none; }
  .safety-copy-compact { display: block; }
  .topic-panel { padding: 13px 10px 8px; border-radius: 10px; box-shadow: none; }
  .topic-panel-head { align-items: flex-start; flex-direction: column; gap: 9px; padding: 0 0 9px; border-bottom: 0; }
  .section-eyebrow,
  .topic-panel-head p { display: none; }
  .topic-panel-head h2 { margin: 0; font-size: 18px; line-height: 1.35; }
  .topic-actions { width: 100%; align-items: center; flex-direction: row; justify-content: flex-start; gap: 7px; }
  .topic-search { grid-template-columns: minmax(0, 1fr) auto; }
  .topic-search { flex: 1 1 100%; width: 100%; gap: 6px; }
  .topic-search :deep(.el-input__wrapper) { min-height: 40px; border-radius: 9px; box-shadow: 0 0 0 1px var(--cpu-border) inset; }
  .topic-search :deep(.el-button) { width: 56px; min-width: 56px; min-height: 40px; padding: 0 8px; border-radius: 9px; font-weight: 600; }
  .topic-actions .sort-switch { align-self: flex-start; }
  .topic-actions .sort-switch :deep(.el-radio-button__inner) { min-height: 34px; padding: 8px 14px; font-size: 12px; box-shadow: none; }
  .market-filters { align-items: stretch; gap: 8px; padding: 0 0 9px; }
  .filter-group { width: 100%; }
  .filter-group :deep(.el-select) { width: 100%; }
  .filter-group--kind { overflow: visible; padding-bottom: 0; }
  .filter-group--kind :deep(.el-radio-group) { display: flex; width: 100%; flex-wrap: nowrap; }
  .filter-group--kind :deep(.el-radio-button) { flex: 1 1 0; }
  .filter-group--kind :deep(.el-radio-button__inner) { width: 100%; min-height: 34px; padding: 8px 6px; font-size: 12px; box-shadow: none; }
  .mobile-filter-trigger {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--cpu-primary);
    font: inherit;
    font-size: 11px;
    font-weight: 650;
    cursor: pointer;
  }
  .mobile-filter-trigger .el-icon { transition: transform 0.18s ease; }
  .mobile-filter-trigger .el-icon.is-open { transform: rotate(180deg); }
  .mobile-filter-trigger:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--cpu-primary) 42%, transparent);
    outline-offset: 2px;
    border-radius: 4px;
  }
  .filter-advanced { display: none; }
  .filter-advanced.is-open {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    width: 100%;
    padding: 9px;
    border-radius: 10px;
    background: var(--cpu-surface-subtle);
  }
  .filter-advanced .filter-group { min-width: 0; }
  .filter-advanced :deep(.el-select__wrapper) { min-height: 36px; border-radius: 8px; }
  .filter-reset { grid-column: 1 / -1; justify-self: start; min-height: 28px; padding: 0 4px; }
  .market-card-flow { columns: 1; padding: 4px 0 0; }
  .market-card-flow :deep(.topic-row--card) {
    display: flex;
    align-items: stretch;
    gap: 10px;
    margin: 0;
    border: 0;
    border-bottom: 1px solid var(--cpu-border-soft);
    border-radius: 0;
    background: transparent;
    box-shadow: none;
  }
  .market-card-flow :deep(.market-card-image) {
    flex: 0 0 82px;
    width: 82px;
    height: 82px;
    margin: 10px 0;
    border-radius: 9px;
  }
  .market-card-flow :deep(.market-card-body) { flex: 1; min-width: 0; padding: 10px 0; }
  .market-card-flow :deep(.market-card-tags) { flex-wrap: nowrap; margin-bottom: 5px; overflow: hidden; }
  .market-card-flow :deep(.market-card-body h3) { font-size: 14px; line-height: 1.45; }
  .market-card-flow :deep(.market-card-excerpt) { margin-top: 4px; line-height: 1.45; -webkit-line-clamp: 2; }
  .market-card-flow :deep(.market-card-price) { display: inline-block; margin-top: 6px; font-size: 15px; }
  .market-card-flow :deep(.market-card-facts) { margin-top: 6px; }
  .market-card-flow :deep(.market-card-meta) { margin-top: 7px; padding-top: 0; border-top: 0; }
  .market-card-flow :deep(.market-card-stat) { display: none; }
  .pinned-block { margin: 8px 0 2px; padding: 7px 4px 0; border-color: var(--cpu-border-soft); background: transparent; }
  .topic-list { min-height: 80px; padding-top: 0; }
}

@media (max-width: 380px) {
  .entry-card { padding-inline: 4px; }
  .entry-copy b { font-size: 11px; }
}
</style>
