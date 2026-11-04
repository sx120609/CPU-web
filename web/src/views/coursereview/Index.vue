<template>
  <div class="cr-index">
    <header class="cr-head">
      <div class="cr-head-text">
        <h2>课程点评</h2>
        <p v-if="overview">收录 {{ overview.courseCount }} 门课，{{ overview.reviewedCourseCount }} 门有点评，共 {{ overview.reviewCount }} 篇</p>
        <p v-else>选课前看看上过的同学怎么说</p>
      </div>
      <el-button v-if="auth.canAccessForum" type="primary" @click="goWrite()">
        <el-icon><EditPen /></el-icon> 写点评
      </el-button>
    </header>

    <section v-if="auth.canAccessForum && showMinePanel" class="cr-mine">
      <template v-if="mineStats && mineStats.total">
        <div class="cr-mine-row">
          <div class="cr-mine-counts">
            <button type="button" :class="{ active: scope === 'mine' }" @click="setScope('mine')">
              <b>{{ mineStats.total }}</b><span>我的课程</span>
            </button>
            <button type="button" :class="{ active: scope === 'todo' }" @click="setScope('todo')">
              <b :class="{ accent: mineStats.todo > 0 }">{{ mineStats.todo }}</b><span>待评价</span>
            </button>
            <div class="cr-mine-static"><b>{{ mineStats.reviewed }}</b><span>已评价</span></div>
          </div>
          <div class="cr-mine-sync">
            <span>{{ syncing ? "正在从教务更新…" : syncedAgo(mineStats.syncedAt) }}</span>
            <button data-cpu-button="text" type="button" :disabled="syncing" @click="onSync(false)">更新</button>
          </div>
        </div>
      </template>
      <div v-else class="cr-mine-empty">
        <div>
          <b>导入我的课程</b>
          <p>从教务读取修过、在修和培养方案里的课，写点评时自动带上任课老师。</p>
        </div>
        <el-button :loading="syncing" :disabled="syncing" @click="onSync(false)">
          {{ syncing ? "正在导入" : "从教务导入" }}
        </el-button>
      </div>
    </section>

    <nav class="cr-tabs" role="tablist">
      <button
        v-for="tab in tabs"
        :key="tab.value"
        type="button"
        role="tab"
        :aria-selected="scope === tab.value"
        :class="{ active: scope === tab.value }"
        :disabled="tab.value !== 'all' && !auth.canAccessForum"
        @click="setScope(tab.value)"
      >{{ tab.label }}</button>
    </nav>

    <div class="cr-filters">
      <el-input
        v-model="q"
        class="cr-search"
        placeholder="课程名、代码或老师，空格分开多个词"
        clearable
        @input="onQueryInput"
        @clear="reload"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select v-model="sort" class="cr-sort" @change="reload">
        <el-option v-for="option in sortOptions" :key="option.value" :value="option.value" :label="option.label" />
      </el-select>
    </div>
    <div v-if="overview?.categories.length" class="cr-chips">
      <button type="button" :class="{ active: !category }" @click="setCategory('')">全部</button>
      <button
        v-for="name in overview.categories"
        :key="name"
        type="button"
        :class="{ active: category === name }"
        @click="setCategory(name)"
      >{{ name }}</button>
      <button type="button" :class="{ active: reviewedOnly }" @click="toggleReviewed">只看有点评</button>
    </div>

    <div v-if="error && !loading" class="cr-state">
      <p>{{ error }}</p>
      <el-button @click="reload">重试</el-button>
    </div>
    <div v-else-if="!loading && !items.length" class="cr-state">
      <template v-if="scope === 'todo' && mineStats?.total">
        <p>修过和在修的课都评过了，谢谢你。</p>
      </template>
      <template v-else-if="scope !== 'all' && !mineStats?.total">
        <p>还没有导入你的课程。</p>
        <el-button type="primary" :loading="syncing" @click="onSync(false)">从教务导入</el-button>
      </template>
      <template v-else>
        <p>没有找到匹配的课程。</p>
        <p v-if="q" class="cr-state-sub">换个关键词试试，或者先导入你的课程，系统会把课加进目录。</p>
      </template>
    </div>

    <ul v-else class="cr-list" v-loading="loading && !items.length">
      <li v-for="c in items" :key="c.id">
        <RouterLink class="cr-row" :to="`/coursereview/${c.id}`">
          <div class="cr-row-main">
            <div class="cr-row-title">
              <span class="cr-name">{{ c.name }}</span>
              <span v-if="c.mine" class="cr-tag" :data-source="c.mine.source">{{ COURSE_SOURCE_LABEL[c.mine.source] }}</span>
            </div>
            <div class="cr-row-meta">{{ courseMetaLine(c) }}</div>
            <div class="cr-row-teachers">{{ teacherLine(c) }}</div>
          </div>
          <div class="cr-row-side">
            <template v-if="c.stats.count">
              <div class="cr-score">{{ scoreText(c.stats.recommend) }}</div>
              <div class="cr-score-sub">{{ c.stats.count }} 篇 · {{ statSummary(c.stats) }}</div>
            </template>
            <div v-else class="cr-score-none">暂无点评</div>
            <button
              v-if="c.mine && c.mine.source !== 'pyfa' && !c.mine.review"
              type="button"
              class="cr-rate-btn"
              @click.prevent.stop="goWrite(c.id)"
            >去评价</button>
            <span v-else-if="c.mine?.review" class="cr-done">{{ c.mine.review.pending ? "审核中" : "已评价" }}</span>
          </div>
        </RouterLink>
      </li>
    </ul>

    <div v-if="items.length < total" class="cr-more">
      <el-button :loading="loadingMore" @click="loadMore">加载更多（还有 {{ total - items.length }} 门）</el-button>
    </div>

    <JwxtReauthDialog v-model="reauthOpen" @restored="onReauthRestored" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { EditPen, Search } from "@element-plus/icons-vue";
import { courseApi, COURSE_SOURCE_LABEL, type Course, type CourseOverview, type CourseScope, type CourseSort } from "@/api/course";
import { useAuthStore } from "@/stores/auth";
import JwxtReauthDialog from "@/components/jwxt/JwxtReauthDialog.vue";
import { AUTO_SYNC_AFTER_MS, courseMetaLine, scoreText, statSummary, syncedAgo } from "./courseReviewText";
import { useCourseSync } from "./useCourseSync";

const PAGE_SIZE = 20;

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const { syncing, needsReauth, canSync, sync } = useCourseSync();

const tabs: Array<{ value: CourseScope; label: string }> = [
  { value: "all", label: "全部课程" },
  { value: "mine", label: "我的课程" },
  { value: "todo", label: "待评价" },
];
const sortOptions: Array<{ value: CourseSort | "default"; label: string }> = [
  { value: "default", label: "默认排序" },
  { value: "recommend", label: "推荐度最高" },
  { value: "recent", label: "最近有点评" },
  { value: "easy", label: "轻松好拿分" },
  { value: "code", label: "按课程代码" },
];

function routeScope(): CourseScope {
  const value = route.query.scope;
  return value === "mine" || value === "todo" ? value : "all";
}

const scope = ref<CourseScope>(routeScope());
const q = ref(typeof route.query.q === "string" ? route.query.q : "");
const sort = ref<CourseSort | "default">("default");
const category = ref("");
const reviewedOnly = ref(false);
const items = ref<Course[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const loadingMore = ref(false);
const error = ref("");
const overview = ref<CourseOverview | null>(null);
const reauthOpen = ref(false);
let loadSeq = 0;
let queryTimer: ReturnType<typeof setTimeout> | null = null;

const mineStats = computed(() => overview.value?.mine ?? null);
const showMinePanel = computed(() => canSync() || Boolean(mineStats.value?.total));

watch(needsReauth, (value) => { if (value) reauthOpen.value = true; });

onMounted(async () => {
  await Promise.all([loadOverview(), reload()]);
  // 好几天没更新过就在后台悄悄更新一次，失败也不打扰。
  const syncedAt = mineStats.value?.syncedAt ? new Date(mineStats.value.syncedAt).getTime() : 0;
  if (auth.canAccessForum && canSync() && (!syncedAt || Date.now() - syncedAt > AUTO_SYNC_AFTER_MS)) {
    const result = await sync({ silent: true });
    if (result) await Promise.all([loadOverview(), reload()]);
  }
});

onBeforeUnmount(() => {
  if (queryTimer) clearTimeout(queryTimer);
});

function teacherLine(c: Course) {
  const mineTeachers = c.mine?.teacherNames ?? [];
  if (mineTeachers.length) return `我的老师：${mineTeachers.join("、")}`;
  if (!c.teachers.length) return "暂无老师信息";
  const names = c.teachers.slice(0, 4).map((t) => t.name).join("、");
  return c.teachers.length > 4 ? `${names} 等 ${c.teachers.length} 位老师` : names;
}

function syncRouteQuery() {
  const query: Record<string, string> = {};
  if (scope.value !== "all") query.scope = scope.value;
  if (q.value.trim()) query.q = q.value.trim();
  void router.replace({ query });
}

function setScope(value: CourseScope) {
  if (scope.value === value) return;
  scope.value = value;
  void reload();
}

function setCategory(value: string) {
  category.value = value;
  void reload();
}

function toggleReviewed() {
  reviewedOnly.value = !reviewedOnly.value;
  void reload();
}

function onQueryInput() {
  if (queryTimer) clearTimeout(queryTimer);
  queryTimer = setTimeout(() => { void reload(); }, 300);
}

async function loadOverview() {
  if (!auth.canAccessForum) return;
  try {
    overview.value = await courseApi.overview({ suppressErrorMessage: true, cacheTtlMs: 0 });
  } catch { /* 概况拿不到不影响列表 */ }
}

async function fetchPage(target: number) {
  return courseApi.list({
    q: q.value.trim(),
    scope: scope.value,
    sort: sort.value === "default" ? undefined : sort.value,
    category: category.value || undefined,
    reviewed: reviewedOnly.value,
    page: target,
    size: PAGE_SIZE,
  }, { suppressErrorMessage: true });
}

async function reload() {
  syncRouteQuery();
  const seq = ++loadSeq;
  loading.value = true;
  error.value = "";
  try {
    const result = await fetchPage(1);
    if (seq !== loadSeq) return;
    items.value = result.items;
    total.value = result.total;
    page.value = 1;
  } catch (e) {
    if (seq !== loadSeq) return;
    items.value = [];
    total.value = 0;
    error.value = listError(e);
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

async function loadMore() {
  if (loadingMore.value) return;
  const seq = loadSeq;
  loadingMore.value = true;
  try {
    const result = await fetchPage(page.value + 1);
    if (seq !== loadSeq) return;
    const seen = new Set(items.value.map((c) => c.id));
    items.value = [...items.value, ...result.items.filter((c) => !seen.has(c.id))];
    total.value = result.total;
    page.value += 1;
  } catch { /* 按钮还在，可以再点 */ } finally {
    loadingMore.value = false;
  }
}

async function onSync(silent: boolean) {
  const result = await sync({ silent });
  if (!result) return;
  await loadOverview();
  if (scope.value === "all") scope.value = result.taken + result.current > 0 ? "todo" : "mine";
  await reload();
}

function onReauthRestored() {
  void onSync(false);
}

function goWrite(courseId?: number) {
  void router.push({ path: "/coursereview/write", query: courseId ? { course: String(courseId) } : {} });
}

function listError(e: unknown) {
  const response = (e as { response?: { status?: number; data?: { message?: string } } })?.response;
  if (response?.status && response.status < 500) return response.data?.message || "课程列表加载失败";
  return "课程列表加载失败，请稍后再试";
}
</script>

<style scoped>
.cr-index { display: flex; flex-direction: column; gap: 12px; }

.cr-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
.cr-head h2 { margin: 0; font-size: var(--cpu-fs-xl); font-weight: 600; color: var(--cpu-text); }
.cr-head p { margin: 4px 0 0; font-size: var(--cpu-fs-s); color: var(--cpu-text-muted); }

.cr-mine {
  background: var(--cpu-card);
  border-radius: var(--cpu-radius-l);
  padding: 14px 16px;
}
.cr-mine-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.cr-mine-counts { display: flex; gap: 6px; }
.cr-mine-counts button,
.cr-mine-static {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-width: 76px;
  padding: 6px 12px;
  border: 0;
  border-radius: var(--cpu-radius-m);
  background: transparent;
  color: var(--cpu-text-secondary);
  font: inherit;
  text-align: left;
}
.cr-mine-counts button { cursor: pointer; }
.cr-mine-counts button:hover { background: var(--cpu-surface-soft); }
.cr-mine-counts button.active { background: var(--cpu-primary-soft); }
.cr-mine-counts b { font-size: var(--cpu-fs-xl); font-weight: 600; color: var(--cpu-text); line-height: 1.1; }
.cr-mine-counts b.accent { color: var(--cpu-primary); }
.cr-mine-counts span { font-size: var(--cpu-fs-xs); color: var(--cpu-text-muted); }
.cr-mine-sync { display: flex; align-items: center; gap: 8px; font-size: var(--cpu-fs-xs); color: var(--cpu-text-muted); }
.cr-mine-empty { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.cr-mine-empty b { font-size: var(--cpu-fs-m); color: var(--cpu-text); }
.cr-mine-empty p { margin: 4px 0 0; font-size: var(--cpu-fs-s); color: var(--cpu-text-muted); }

.cr-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--cpu-border-soft); }
.cr-tabs button {
  padding: 8px 12px;
  border: 0;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  background: transparent;
  color: var(--cpu-text-secondary);
  font: inherit;
  font-size: var(--cpu-fs-m);
  cursor: pointer;
}
.cr-tabs button.active { color: var(--cpu-text); font-weight: 600; border-bottom-color: var(--cpu-primary); }
.cr-tabs button:disabled { color: var(--cpu-text-muted); cursor: not-allowed; }

.cr-filters { display: flex; gap: 8px; }
.cr-search { flex: 1; }
.cr-sort { width: 140px; flex: none; }

.cr-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.cr-chips button {
  padding: 3px 10px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-pill);
  background: var(--cpu-card);
  color: var(--cpu-text-secondary);
  font: inherit;
  font-size: var(--cpu-fs-xs);
  cursor: pointer;
}
.cr-chips button.active { border-color: var(--cpu-primary); background: var(--cpu-primary-soft); color: var(--cpu-primary); }

.cr-list {
  list-style: none;
  margin: 0;
  padding: 0;
  min-height: 120px;
  background: var(--cpu-card);
  border-radius: var(--cpu-radius-l);
  overflow: hidden;
}
.cr-list li + li { border-top: 1px solid var(--cpu-border-soft); }
.cr-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  color: inherit;
  text-decoration: none;
}
.cr-row:hover { background: var(--cpu-surface-soft); }
.cr-row:focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: -2px; }
.cr-row-main { flex: 1; min-width: 0; }
.cr-row-title { display: flex; align-items: center; gap: 6px; min-width: 0; }
.cr-name { font-size: var(--cpu-fs-m); font-weight: 600; color: var(--cpu-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cr-tag {
  flex: none;
  padding: 0 6px;
  border-radius: var(--cpu-radius-s);
  background: var(--cpu-surface-soft);
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-xs);
  line-height: 18px;
}
.cr-tag[data-source="schedule"] { background: var(--cpu-primary-soft); color: var(--cpu-primary); }
.cr-row-meta,
.cr-row-teachers {
  margin-top: 2px;
  font-size: var(--cpu-fs-xs);
  color: var(--cpu-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cr-row-teachers { color: var(--cpu-text-secondary); }
.cr-row-side { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; max-width: 46%; text-align: right; }
.cr-score { font-size: var(--cpu-fs-xl); font-weight: 600; color: var(--cpu-text); line-height: 1; font-variant-numeric: tabular-nums; }
.cr-score-sub { font-size: var(--cpu-fs-xs); color: var(--cpu-text-muted); white-space: nowrap; }
.cr-score-none { font-size: var(--cpu-fs-xs); color: var(--cpu-text-muted); }
.cr-rate-btn {
  padding: 2px 10px;
  border: 1px solid var(--cpu-primary);
  border-radius: var(--cpu-radius-pill);
  background: transparent;
  color: var(--cpu-primary);
  font: inherit;
  font-size: var(--cpu-fs-xs);
  cursor: pointer;
}
.cr-rate-btn:hover { background: var(--cpu-primary-soft); }
.cr-done { font-size: var(--cpu-fs-xs); color: var(--cpu-text-muted); }

.cr-state {
  padding: 32px 16px;
  background: var(--cpu-card);
  border-radius: var(--cpu-radius-l);
  text-align: center;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-s);
}
.cr-state p { margin: 0 0 12px; }
.cr-state .cr-state-sub { color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
.cr-more { display: flex; justify-content: center; }

@media (max-width: 700px) {
  .cr-head h2 { font-size: var(--cpu-fs-l); }
  .cr-mine { padding: 12px; }
  .cr-mine-counts button, .cr-mine-static { min-width: 0; padding: 6px 8px; }
  .cr-mine-empty { flex-direction: column; align-items: stretch; }
  .cr-sort { width: 120px; }
  .cr-row { padding: 12px; align-items: flex-start; }
  .cr-score-sub { white-space: normal; }
}
</style>
