<template>
  <div class="wk-page wk-index">
    <router-link class="wk-back" to="/services/tools">
      <el-icon aria-hidden="true"><ArrowLeft /></el-icon>校园小工具
    </router-link>
    <header class="wk-head">
      <div class="wk-head-copy">
        <h1>创意工坊</h1>
        <p>同学做的游戏和小工具，点开就能用。</p>
      </div>
      <div class="wk-actions">
        <el-button v-if="auth.isLoggedIn" text @click="savesOpen = true">云端存档</el-button>
        <el-button v-if="auth.user?.role === 'admin'" @click="router.push('/workshop/review')">审核</el-button>
        <el-button type="primary" @click="router.push('/workshop/mine')">我的作品</el-button>
      </div>
    </header>

    <div class="wk-index-bar">
      <div class="wk-seg" role="group" aria-label="筛选作品">
        <button
          v-for="item in filters"
          :key="item.value"
          type="button"
          :aria-pressed="filter === item.value"
          @click="setFilter(item.value)"
        >
          <el-icon v-if="item.value === 'favorites'" aria-hidden="true"><StarFilled /></el-icon>{{ item.label }}
        </button>
      </div>
      <el-input
        v-model="search"
        class="wk-index-search"
        placeholder="搜索作品"
        clearable
        aria-label="搜索作品"
        :prefix-icon="Search"
        @input="queueSearch"
        @keyup.enter="applySearch"
        @clear="applySearch"
      />
    </div>

    <div v-if="loading" class="wk-index-grid" role="status" aria-label="正在加载作品">
      <div v-for="n in 6" :key="n" class="wk-index-skeleton" />
    </div>
    <div v-else-if="error" class="wk-group wk-empty" role="alert">
      <p>{{ error }}</p>
      <el-button @click="load">重试</el-button>
    </div>
    <template v-else>
      <div v-if="works.length" class="wk-index-grid">
        <WorkCard
          v-for="work in works"
          :key="work.id"
          :work="work"
          :busy="favoriteBusy.has(work.id)"
          @favorite="toggleFavorite"
        />
      </div>
      <div v-else class="wk-group wk-empty">
        <el-icon aria-hidden="true"><Box /></el-icon>
        <p>{{ emptyText }}</p>
        <el-button v-if="filter || search" @click="reset">查看全部作品</el-button>
      </div>
      <div v-if="total > pageSize" class="wk-pagination">
        <el-pagination
          v-model:current-page="page"
          :page-size="pageSize"
          :total="total"
          layout="prev, pager, next"
          @current-change="load"
        />
      </div>
    </template>

    <router-link class="wk-index-create" to="/workshop/develop" data-hue="violet">
      <span class="wk-index-create-mark" aria-hidden="true"><el-icon><Opportunity /></el-icon></span>
      <span class="wk-index-create-copy">
        <b>做一个自己的</b>
        <small>有现成模板，也可以把想法交给 AI 来写，审核通过就上架。</small>
      </span>
      <el-icon aria-hidden="true"><ArrowRight /></el-icon>
    </router-link>

    <SaveManager v-if="savesOpen" @close="savesOpen = false" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { ArrowLeft, ArrowRight, Box, Opportunity, Search, StarFilled } from "@element-plus/icons-vue";
import { workshopApi, type WorkshopType, type WorkshopWork } from "@/api/workshop";
import { useAuthStore } from "@/stores/auth";
import WorkCard from "./WorkCard.vue";
import SaveManager from "./SaveManager.vue";
import { workshopError } from "./shared";
import "./workshop.css";

type Filter = "" | WorkshopType | "favorites";
const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const savesOpen = ref(false);
const search = ref("");
const queryType = route.query.type;
const filter = ref<Filter>(
  queryType === "game" || queryType === "tool" || queryType === "extension" ? queryType : "",
);
const filters = computed(() => [
  { value: "" as Filter, label: "全部" },
  { value: "game" as Filter, label: "游戏" },
  { value: "tool" as Filter, label: "工具" },
  { value: "extension" as Filter, label: "扩展" },
  ...(auth.isLoggedIn ? [{ value: "favorites" as Filter, label: "收藏" }] : []),
]);
const page = ref(1);
const pageSize = 12;
const total = ref(0);
const works = ref<WorkshopWork[]>([]);
const loading = ref(true);
const error = ref("");
const favoriteBusy = ref(new Set<string>());
const emptyText = computed(() => {
  if (filter.value === "favorites") return "还没有收藏的作品";
  if (search.value.trim() || filter.value) return "没有找到匹配的作品";
  return "工坊里还没有作品，来做第一个吧";
});
let requestId = 0;
let searchTimer = 0;

async function load() {
  const id = ++requestId;
  loading.value = true;
  error.value = "";
  try {
    const data = await workshopApi.list({
      q: search.value.trim() || undefined,
      type: filter.value && filter.value !== "favorites" ? filter.value : undefined,
      favorites: filter.value === "favorites" ? "1" : undefined,
      page: page.value,
      pageSize,
    });
    if (id !== requestId) return;
    if (page.value > Math.max(1, data.pagination.totalPages)) {
      page.value = Math.max(1, data.pagination.totalPages);
      await load();
      return;
    }
    works.value = data.items;
    total.value = data.pagination.total;
  } catch (e) {
    if (id === requestId) error.value = workshopError(e, "作品暂时加载失败，请重试");
  } finally {
    if (id === requestId) loading.value = false;
  }
}
function applySearch() {
  window.clearTimeout(searchTimer);
  page.value = 1;
  void load();
}
function queueSearch() {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(applySearch, 350);
}
function setFilter(value: Filter) {
  if (filter.value === value) return;
  filter.value = value;
  applySearch();
}
function reset() {
  filter.value = "";
  search.value = "";
  applySearch();
}
async function toggleFavorite(work: WorkshopWork) {
  if (!auth.isLoggedIn) {
    await router.push({ name: "login", query: { redirect: route.fullPath } });
    return;
  }
  if (favoriteBusy.value.has(work.id)) return;
  favoriteBusy.value.add(work.id);
  try {
    if (work.isFavorited) await workshopApi.unfavorite(work.id);
    else await workshopApi.favorite(work.id);
    work.isFavorited = !work.isFavorited;
    work.favoriteCount = Math.max(0, work.favoriteCount + (work.isFavorited ? 1 : -1));
    if (filter.value === "favorites" && !work.isFavorited) await load();
  } catch (e) {
    ElMessage.error(workshopError(e));
  } finally {
    favoriteBusy.value.delete(work.id);
  }
}
onMounted(load);
onBeforeUnmount(() => window.clearTimeout(searchTimer));
</script>

<style scoped>
.wk-index-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 16px;
}
.wk-index-search { width: 240px; }
.wk-index-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 12px;
}
.wk-index-skeleton {
  height: 98px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-card);
}
.wk-index-create {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-hue-bg);
  color: var(--cpu-hue-ink);
  text-decoration: none;
}
.wk-index-create-mark {
  display: grid;
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: var(--cpu-radius-m);
  background: color-mix(in srgb, var(--cpu-hue-ink) 14%, transparent);
  font-size: 20px;
}
.wk-index-create-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}
.wk-index-create-copy b { font-size: var(--cpu-fs-m); font-weight: 600; }
.wk-index-create-copy small { font-size: var(--cpu-fs-s); opacity: 0.85; }
@media (max-width: 600px) {
  .wk-index-search { width: 100%; order: -1; }
  .wk-index-grid { grid-template-columns: minmax(0, 1fr); gap: 10px; }
}
</style>
