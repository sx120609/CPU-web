<template>
  <div class="iservice-pane" v-loading="loading">
    <div class="ctrl-bar" v-if="apps.length">
      <div class="ctrl-left">
        <el-input v-model="keyword" size="default" placeholder="搜索应用..." clearable style="width:240px">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-radio-group v-model="filterFav" size="default">
          <el-radio-button value="">全部</el-radio-button>
          <el-radio-button value="fav">⭐ 我的收藏</el-radio-button>
        </el-radio-group>
      </div>
      <div class="ctrl-right">
        <span class="stat">{{ filtered.length }} / {{ apps.length }} 应用</span>
      </div>
    </div>

    <!-- 分类筛选 chips -->
    <div v-if="categories.length" class="cats">
      <el-tag
        :type="activeCat === '' ? undefined : 'info'"
        :effect="activeCat === '' ? 'dark' : 'plain'"
        @click="activeCat = ''"
        class="cat-tag"
      >
        全部 {{ apps.length }}
      </el-tag>
      <el-tag
        v-for="c in categories"
        :key="c.name"
        :type="activeCat === c.name ? undefined : 'info'"
        :effect="activeCat === c.name ? 'dark' : 'plain'"
        @click="activeCat = c.name"
        class="cat-tag"
      >
        {{ c.name }} {{ c.count }}
      </el-tag>
    </div>

    <!-- 应用网格 -->
    <div class="app-grid">
      <div
        v-for="a in filtered"
        :key="a.id"
        class="app-card"
        :class="{ fav: a.favorite }"
        @click="openApp(a)"
        :title="a.detail || a.name"
      >
        <div class="app-icon">
          <img
            v-if="a.icon"
            :src="proxiedIcon(a.icon)"
            :alt="a.name"
            @error="onIconError"
            referrerpolicy="no-referrer"
          />
          <span v-else class="icon-fallback">{{ a.name.charAt(0) }}</span>
        </div>
        <div class="app-name">{{ a.name }}</div>
        <div v-if="a.types.length" class="app-types">
          <span v-for="t in a.types.slice(0, 1)" :key="t" class="type-pill">{{ t }}</span>
        </div>
        <div v-if="a.favorite" class="fav-mark">⭐</div>
      </div>
    </div>

    <el-empty v-if="!loading && apps.length && !filtered.length" description="没有符合条件的应用" />
    <el-empty v-else-if="!loading && !apps.length" description="未拿到应用列表 — 教务会话可能已失效" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { Search } from "@element-plus/icons-vue";
import { jwxtApi } from "@/api/jwxt";

interface IServiceApp {
  id: number;
  name: string;
  detail: string;
  url: string;
  icon: string;
  types: string[];
  clickNum: number;
  favorite: boolean;
  favCount: number;
  dept: string;
  scope: string[];
}

const apps = ref<IServiceApp[]>([]);
const loading = ref(false);
const keyword = ref("");
const activeCat = ref("");
const filterFav = ref<"" | "fav">("");

onMounted(async () => {
  loading.value = true;
  try {
    const r: any = await jwxtApi.iapps();
    apps.value = r.apps ?? [];
    // 按收藏优先 + 热度排序
    apps.value.sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      return (b.clickNum ?? 0) - (a.clickNum ?? 0);
    });
  } finally { loading.value = false; }
});

const categories = computed(() => {
  const m = new Map<string, number>();
  for (const a of apps.value) {
    for (const t of a.types) m.set(t, (m.get(t) ?? 0) + 1);
  }
  return Array.from(m.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
});

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  return apps.value.filter((a) => {
    if (activeCat.value && !a.types.includes(activeCat.value)) return false;
    if (filterFav.value === "fav" && !a.favorite) return false;
    if (kw) {
      const hit =
        a.name.toLowerCase().includes(kw) ||
        a.detail.toLowerCase().includes(kw) ||
        a.types.some((t) => t.toLowerCase().includes(kw)) ||
        a.dept.toLowerCase().includes(kw);
      if (!hit) return false;
    }
    return true;
  });
});

/** 学校图标走 https，但默认配的 referrer 会让学校 CDN 误判 → 用 referrerpolicy=no-referrer */
function proxiedIcon(url: string): string {
  return url; // 直接走原 URL；SSO Cookie 不需要，svg/png 是公开静态资源
}

function onIconError(e: Event) {
  const img = e.target as HTMLImageElement;
  img.style.display = "none";
}

function openApp(a: IServiceApp) {
  if (!a.url) return;
  window.open(a.url, "_blank", "noopener");
}
</script>

<style scoped>
.iservice-pane { display: flex; flex-direction: column; gap: 14px; }

.ctrl-bar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; }
.ctrl-left { display: flex; gap: 10px; align-items: center; }
.stat { font-size: 13px; color: var(--cpu-primary); font-weight: 500; }

.cats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 4px 0;
}
.cat-tag {
  cursor: pointer;
  transition: transform 0.15s;
}
.cat-tag:hover { transform: translateY(-1px); }

.app-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 12px;
}

.app-card {
  position: relative;
  background: #fff;
  border: 1px solid #eef0f4;
  border-radius: 12px;
  padding: 16px 10px 12px;
  text-align: center;
  cursor: pointer;
  transition: all 0.15s;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  min-height: 130px;
}
.app-card:hover {
  border-color: var(--cpu-primary);
  box-shadow: 0 6px 20px rgba(22, 135, 118, 0.12);
  transform: translateY(-2px);
}
.app-card.fav {
  border-color: #fcd34d;
  background: linear-gradient(180deg, #fffbeb 0%, #fff 30%);
}

.app-icon {
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  background: #f9fafb;
  border-radius: 12px;
  overflow: hidden;
}
.app-icon img {
  width: 38px;
  height: 38px;
  object-fit: contain;
}
.icon-fallback {
  font-size: 20px;
  color: var(--cpu-primary);
  font-weight: 600;
}

.app-name {
  font-size: 13px;
  color: #1f2937;
  font-weight: 500;
  line-height: 1.3;
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.app-types {
  display: flex;
  gap: 3px;
  justify-content: center;
  flex-wrap: wrap;
}
.type-pill {
  font-size: 10px;
  color: #6b7280;
  background: #f3f4f6;
  border-radius: 4px;
  padding: 1px 5px;
}

.fav-mark {
  position: absolute;
  top: 6px;
  right: 6px;
  font-size: 12px;
}
</style>
