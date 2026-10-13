<template>
  <div class="pk-page workshop-page">
    <header class="pk-head">
      <router-link class="pk-back" to="/services/tools"
        >‹ 校园小工具</router-link
      >
      <div class="pk-title">
        <span class="pk-tile" aria-hidden="true">✦</span>
        <div class="pk-title-copy">
          <h1>创意工坊<em class="pk-badge is-open">一起创造</em></h1>
          <p>发现同学制作的游戏、工具和站点扩展，也把你的创意分享给大家。</p>
        </div>
        <div class="pk-title-actions">
          <el-button v-if="auth.isLoggedIn" @click="savesOpen = true">云端存档</el-button>
          <router-link class="pk-pill" to="/workshop/mine">作者中心</router-link
          ><router-link
            v-if="auth.user?.role === 'admin'"
            class="pk-pill"
            to="/workshop/review"
            >审核管理</router-link
          >
        </div>
      </div>
    </header>
    <section class="pk-card ws-toolbar" aria-label="查找作品">
      <el-input
        v-model="search"
        class="ws-search"
        placeholder="搜索名称或介绍"
        clearable
        aria-label="搜索作品"
        @keyup.enter="filterChanged"
        @clear="filterChanged"
        ><template #append
          ><el-button @click="filterChanged">搜索</el-button></template
        ></el-input
      >
      <el-radio-group
        v-model="type"
        aria-label="作品类型"
        @change="filterChanged"
        ><el-radio-button value="">全部</el-radio-button
        ><el-radio-button value="game">游戏</el-radio-button
        ><el-radio-button value="tool">工具</el-radio-button
        ><el-radio-button value="extension"
          >站点扩展</el-radio-button
        ></el-radio-group
      >
      <el-checkbox
        v-if="auth.isLoggedIn"
        v-model="favorites"
        @change="filterChanged"
        >只看收藏</el-checkbox
      >
    </section>
    <div v-if="loading" class="pk-card" role="status" aria-live="polite">
      <el-skeleton :rows="5" animated />
    </div>
    <div v-else-if="error" class="pk-empty ws-error" role="alert">
      <p>{{ error }}</p>
      <el-button @click="load">重试</el-button>
    </div>
    <template v-else>
      <div v-if="works.length" class="ws-grid">
        <WorkCard
          v-for="work in works"
          :key="work.id"
          :work="work"
          :busy="favoriteBusy.has(work.id)"
          @favorite="toggleFavorite"
        />
      </div>
      <div v-else class="pk-empty">
        <p>
          {{
            favorites
              ? "还没有收藏的作品"
              : search || type
                ? "没有找到匹配的作品，试试其他条件"
                : "工坊正在等待第一个创意作品"
          }}
        </p>
      </div>
      <div v-if="total > pageSize" class="ws-pagination">
        <el-pagination
          v-model:current-page="page"
          :page-size="pageSize"
          :total="total"
          layout="prev, pager, next"
          @current-change="load"
        />
      </div>
    </template>
    <SaveManager v-if="savesOpen" @close="savesOpen = false" />
  </div>
</template>
<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import {
  workshopApi,
  type WorkshopType,
  type WorkshopWork,
} from "@/api/workshop";
import { useAuthStore } from "@/stores/auth";
import WorkCard from "./WorkCard.vue";
import SaveManager from "./SaveManager.vue";
import { workshopError } from "./shared";
import "./workshop.css";

const auth = useAuthStore();
const savesOpen = ref(false);
const router = useRouter();
const route = useRoute();
const search = ref("");
const type = ref<WorkshopType | "">(
  route.query.type === "game" ||
    route.query.type === "tool" ||
    route.query.type === "extension"
    ? route.query.type
    : "",
);
const favorites = ref(false);
const page = ref(1);
const pageSize = 12;
const total = ref(0);
const works = ref<WorkshopWork[]>([]);
const loading = ref(true);
const error = ref("");
const favoriteBusy = ref(new Set<string>());
let requestId = 0;
async function load() {
  const id = ++requestId;
  loading.value = true;
  error.value = "";
  try {
    const data = await workshopApi.list({
      q: search.value.trim() || undefined,
      type: type.value || undefined,
      favorites: favorites.value ? "1" : undefined,
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
    if (id === requestId)
      error.value = workshopError(e, "作品暂时加载失败，请重试");
  } finally {
    if (id === requestId) loading.value = false;
  }
}
function filterChanged() {
  page.value = 1;
  void load();
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
    work.favoriteCount = Math.max(
      0,
      work.favoriteCount + (work.isFavorited ? 1 : -1),
    );
    if (favorites.value && !work.isFavorited) await load();
  } catch (e) {
    ElMessage.error(workshopError(e));
  } finally {
    favoriteBusy.value.delete(work.id);
  }
}
onMounted(load);
</script>
