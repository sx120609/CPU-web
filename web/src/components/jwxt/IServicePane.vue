<template>
  <div class="iservice-pane" v-loading="loading">
    <div class="ctrl-bar" v-if="apps.length">
      <div class="ctrl-left">
        <el-input v-model="keyword" class="search-input" size="default" placeholder="搜索应用..." clearable>
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
        role="button"
        tabindex="0"
        @click="openApp(a)"
        @keydown.enter.self.prevent="openApp(a)"
        @keydown.space.self.prevent="openApp(a)"
        :title="a.detail || a.name"
      >
        <div class="app-icon">
          <img
            v-if="a.icon"
            :src="proxiedIcon(a.icon)"
            :alt="a.name"
            loading="lazy"
            decoding="async"
            fetchpriority="low"
            @error="onIconError"
            referrerpolicy="no-referrer"
          />
          <span v-else class="icon-fallback">{{ a.name.charAt(0) }}</span>
        </div>
        <div class="app-name">{{ a.name }}</div>
        <div v-if="a.types.length" class="app-types">
          <span v-for="t in a.types.slice(0, 1)" :key="t" class="type-pill">{{ t }}</span>
        </div>
        <button
          class="fav-btn"
          :class="{ active: a.favorite }"
          type="button"
          :aria-label="a.favorite ? '取消收藏' : '收藏服务'"
          :title="a.favorite ? '取消收藏' : '收藏服务'"
          @click.stop="toggleFavorite(a)"
        >
          <el-icon><StarFilled v-if="a.favorite" /><Star v-else /></el-icon>
        </button>
      </div>
    </div>

    <el-empty v-if="!loading && apps.length && !filtered.length" description="没有符合条件的应用" />
    <div v-else-if="retrying" class="retry-card">
      <el-icon class="is-loading"><Refresh /></el-icon>
      <span>正在重新加载应用列表（{{ retryCount }} / {{ MAX_RETRIES }}）…</span>
    </div>
    <div v-else-if="!loading && error" class="error-card">
      <div>
        <h3>暂时没能加载出应用列表</h3>
        <p>{{ error }}。你可以稍后再试。</p>
      </div>
      <el-button type="primary" plain :loading="loading" :disabled="loading" @click="reload()">重新加载</el-button>
    </div>
    <el-empty v-else-if="!loading && !apps.length" description="暂时还没有拿到应用列表，请稍后再试" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount, onMounted } from "vue";
import { Refresh, Search, Star, StarFilled } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
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
const retrying = ref(false);
const retryCount = ref(0);
const error = ref("");
const keyword = ref("");
const activeCat = ref("");
const filterFav = ref<"" | "fav">("");
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2200, 4200];
const FAVORITES_KEY = "cpu-iservice-favorite-overrides";
const APPS_CACHE_KEY = "cpu-iservice-apps-cache-v1";
const CACHE_TTL = 12 * 60 * 60 * 1000;
let retryTimer: number | null = null;
let activeRequest: Promise<any> | null = null;
let disposed = false;

onMounted(() => {
  disposed = false;
  reload(false);
});

onBeforeUnmount(() => {
  disposed = true;
  if (retryTimer) {
    window.clearTimeout(retryTimer);
    retryTimer = null;
  }
});

async function reload(force = true) {
  if (disposed) return;
  if (retryTimer) {
    window.clearTimeout(retryTimer);
    retryTimer = null;
  }
  retryCount.value = 0;
  error.value = "";
  await loadApps(force);
}

async function loadApps(force = false) {
  if (disposed) return;
  const cached = restoreAppsCache();
  if (cached && !force && !isStale(cached.savedAt)) return;
  loading.value = force || !apps.value.length;
  retrying.value = retryCount.value > 0;
  try {
    const r: any = await fetchApps();
    if (disposed) return;
    const overrides = loadFavoriteOverrides();
    apps.value = (r.apps ?? []).map((a: IServiceApp) => ({
      ...a,
      favorite: favoriteFor(a, overrides),
    }));
    sortApps();
    writeAppsCache(r.apps ?? []);
    error.value = "";
  } catch (e: any) {
    if (disposed) return;
    error.value = e?.message || "网络请求失败";
    if (retryCount.value < MAX_RETRIES) {
      retryCount.value += 1;
      retrying.value = true;
      const delay = RETRY_DELAYS[retryCount.value - 1] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1];
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        if (disposed) return;
        loadApps(false);
      }, delay);
    } else {
      retrying.value = false;
    }
  } finally {
    if (!disposed) loading.value = false;
  }
}

function fetchApps() {
  if (activeRequest) return activeRequest;
  activeRequest = jwxtApi.iapps();
  activeRequest.then(
    () => { activeRequest = null; },
    () => { activeRequest = null; }
  );
  return activeRequest;
}

function isStale(savedAt: number) {
  return !savedAt || Date.now() - savedAt > CACHE_TTL;
}

function readAppsCache(): { savedAt: number; apps: IServiceApp[] } | null {
  try {
    const raw = localStorage.getItem(APPS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.savedAt !== "number" || !Array.isArray(parsed.apps)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeAppsCache(list: IServiceApp[]) {
  try {
    localStorage.setItem(APPS_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), apps: list }));
  } catch {
    /* ignore */
  }
}

function restoreAppsCache() {
  const cached = readAppsCache();
  if (!cached?.apps.length || apps.value.length) return cached;
  const overrides = loadFavoriteOverrides();
  apps.value = cached.apps.map((a) => ({ ...a, favorite: favoriteFor(a, overrides) }));
  sortApps();
  return cached;
}

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

function favoriteKey(a: IServiceApp) {
  return String(a.id || a.url || a.name);
}

function loadFavoriteOverrides(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveFavoriteOverrides(overrides: Record<string, boolean>) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(overrides));
}

function favoriteFor(a: IServiceApp, overrides = loadFavoriteOverrides()) {
  const key = favoriteKey(a);
  return Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : Boolean(a.favorite);
}

function sortApps() {
  apps.value.sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    return (b.clickNum ?? 0) - (a.clickNum ?? 0);
  });
}

function toggleFavorite(a: IServiceApp) {
  const overrides = loadFavoriteOverrides();
  const next = !a.favorite;
  overrides[favoriteKey(a)] = next;
  saveFavoriteOverrides(overrides);
  a.favorite = next;
  sortApps();
  ElMessage.success(next ? "已加入我的收藏" : "已取消收藏");
}

async function openApp(a: IServiceApp) {
  if (!a.url) {
    ElMessage.warning("该应用暂未配置链接");
    return;
  }
  openRawApp(a);
}

function openRawApp(a: IServiceApp) {
  const url = typeof a.url === "string" ? a.url.trim() : "";
  if (!/^https?:\/\//i.test(url)) {
    ElMessage.warning("该应用链接格式暂不支持");
    return;
  }
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) ElMessage.warning("浏览器阻止了新窗口，请允许弹窗后重试");
}
</script>

<style scoped>
.iservice-pane { display: flex; flex-direction: column; gap: 14px; }

.ctrl-bar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; }
.ctrl-left { display: flex; gap: 10px; align-items: center; }
.search-input { width: 240px; max-width: 100%; }
.ctrl-left :deep(.el-radio-group) {
  flex-shrink: 0;
}
.ctrl-left :deep(.el-radio-button__inner) {
  white-space: nowrap;
}
.stat { font-size: 13px; color: var(--cpu-primary); font-weight: 500; }
.retry-card,
.error-card {
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  background: var(--cpu-card);
}
.retry-card {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 18px 14px;
  color: var(--cpu-text-secondary);
  font-size: 13px;
}
.retry-card .is-loading {
  color: var(--cpu-primary);
  animation: spin 1.2s linear infinite;
}
.error-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 16px;
}
.error-card h3 {
  margin: 0 0 4px;
  font-size: 15px;
  color: var(--cpu-text);
}
.error-card p {
  margin: 0;
  color: var(--cpu-text-secondary);
  font-size: 13px;
  line-height: 1.6;
}
@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }

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
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 120px), 1fr));
  gap: 12px;
}

.app-card {
  position: relative;
  background: var(--cpu-card);
  border: 1px solid var(--cpu-border-soft);
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
.app-card:focus-visible {
  outline: 2px solid var(--cpu-primary);
  outline-offset: 2px;
}
.app-card.fav {
  border-color: #fcd34d;
  background: linear-gradient(180deg, rgba(251, 191, 36, 0.16) 0%, var(--cpu-card) 34%);
}

.app-icon {
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  background: var(--cpu-surface-subtle);
  border: 1px solid transparent;
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
  color: var(--cpu-text);
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
  color: var(--cpu-text-secondary);
  background: var(--cpu-surface-subtle);
  border-radius: 4px;
  padding: 1px 5px;
}

.fav-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 30px;
  height: 30px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 999px;
  background: color-mix(in srgb, var(--cpu-card) 92%, transparent);
  color: var(--cpu-text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s;
  touch-action: manipulation;
}
.fav-btn:hover {
  border-color: #f59e0b;
  color: #d97706;
  background: rgba(251, 191, 36, 0.14);
}
.fav-btn.active {
  border-color: #fcd34d;
  color: #f59e0b;
  background: rgba(251, 191, 36, 0.16);
}
.fav-btn :deep(.el-icon) {
  font-size: 15px;
}

:global(html[data-theme="dark"]) .app-icon {
  background: rgba(241, 245, 249, 0.92) !important;
  border-color: rgba(226, 232, 240, 0.86) !important;
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.18), inset 0 0 0 1px rgba(255, 255, 255, 0.72);
}

:global(html[data-theme="dark"]) .app-icon img {
  filter: saturate(1.05) contrast(1.08);
}

:global(html[data-theme="dark"]) .icon-fallback {
  color: #0f766e !important;
}

@media (max-width: 700px) {
  .ctrl-bar {
    align-items: stretch;
    flex-direction: column;
  }

  .ctrl-left {
    align-items: stretch;
    flex-direction: column;
  }

  .ctrl-left :deep(.el-input) {
    width: 100% !important;
  }

  .ctrl-left :deep(.el-radio-group) {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    width: 100%;
    gap: 8px;
    overflow: visible;
  }

  .ctrl-left :deep(.el-radio-button) {
    width: 100%;
  }

  .ctrl-left :deep(.el-radio-button__inner) {
    width: 100%;
    min-height: 38px;
    justify-content: center;
    border: 1px solid var(--cpu-border-soft);
    border-radius: 10px !important;
    box-shadow: none !important;
    display: inline-flex;
    align-items: center;
    padding: 0 10px;
  }

  .ctrl-left :deep(.el-radio-button.is-active .el-radio-button__inner) {
    border-color: var(--cpu-primary);
  }

  .ctrl-right {
    display: flex;
    justify-content: flex-end;
  }

  .error-card {
    align-items: stretch;
    flex-direction: column;
  }

  .error-card .el-button {
    width: 100%;
  }

  .cats {
    flex-wrap: nowrap;
    overflow-x: auto;
    padding-bottom: 2px;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }

  .cats::-webkit-scrollbar {
    display: none;
  }

  .cat-tag {
    flex: 0 0 auto;
  }

  .app-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }

  .app-card {
    min-height: 118px;
    border-radius: 10px;
    padding: 14px 8px 10px;
  }

  .app-icon {
    width: 42px;
    height: 42px;
    border-radius: 10px;
  }

  .app-icon img {
    width: 34px;
    height: 34px;
  }

  .app-name {
    font-size: 12px;
  }

  .fav-btn {
    top: 6px;
    right: 6px;
    width: 32px;
    height: 32px;
  }
}

@media (max-width: 390px) {
  .app-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
