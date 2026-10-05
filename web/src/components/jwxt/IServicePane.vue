<template>
  <div class="iservice-pane" v-loading="loading">
    <div class="ctrl-bar" v-if="apps.length">
      <div class="ctrl-left">
        <el-input v-model="keyword" class="search-input" size="default" placeholder="搜索应用..." clearable>
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-radio-group v-model="filterFav" size="default">
          <el-radio-button value="">全部</el-radio-button>
          <el-radio-button value="fav"><AppIcon name="star" /> 我的收藏</el-radio-button>
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
        <div class="iservice-logo" :class="`iservice-logo--${darkAppIconTone(a)}`">
          <img
            v-if="hasAppIcon(a)"
            class="iservice-logo-light"
            :src="appIconSource(a)"
            :alt="a.name"
            loading="lazy"
            decoding="async"
            fetchpriority="low"
            @error="onIconError(a)"
            referrerpolicy="no-referrer"
          />
          <span v-else class="iservice-logo-light icon-fallback">{{ a.name.charAt(0) }}</span>
          <AppIcon
            class="iservice-logo-dark"
            :class="`iservice-logo-dark--${darkAppIconTone(a)}`"
            :name="darkAppIconName(a)"
          />
        </div>
        <div class="app-name">{{ a.name }}</div>
        <div v-if="a.types.length" class="app-types">
          <span v-for="t in a.types.slice(0, 1)" :key="t" class="type-pill">{{ t }}</span>
        </div>
        <button data-cpu-button="option"
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
import AppIcon from "@/components/common/AppIcon.vue";
import { Search, Star, StarFilled } from "@element-plus/icons-vue";
import { useIServiceApps } from "./iServiceApps";

const {
  apps,
  loading,
  error,
  keyword,
  activeCat,
  filterFav,
  categories,
  filtered,
  reload,
  hasAppIcon,
  appIconSource,
  onIconError,
  darkAppIconName,
  darkAppIconTone,
  toggleFavorite,
  openApp,
} = useIServiceApps();
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

.iservice-logo {
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  background: var(--cpu-surface-subtle);
  border: 1px solid transparent;
  border-radius: 12px;
  overflow: hidden;
}
.iservice-logo img {
  width: 38px;
  height: 38px;
  object-fit: contain;
}
.icon-fallback {
  font-size: 20px;
  color: var(--cpu-primary);
  font-weight: 600;
}

.iservice-logo-dark {
  display: none;
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

:global(html[data-theme="dark"] .iservice-logo) {
  background: color-mix(in srgb, var(--iservice-icon-color, var(--cpu-primary)) 13%, var(--cpu-surface-soft));
  border-color: color-mix(in srgb, var(--iservice-icon-color, var(--cpu-primary)) 30%, var(--cpu-border-soft));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .05);
}

:global(html[data-theme="dark"] .iservice-logo-light) {
  display: none;
}

:global(html[data-theme="dark"] .iservice-logo-dark) {
  display: inline-flex;
  color: var(--iservice-icon-color, var(--cpu-primary-light));
  font-size: 25px;
}

:global(html[data-theme="dark"] .iservice-logo--teal) { --iservice-icon-color: #5eead4; }
:global(html[data-theme="dark"] .iservice-logo--blue) { --iservice-icon-color: #93c5fd; }
:global(html[data-theme="dark"] .iservice-logo--cyan) { --iservice-icon-color: #67e8f9; }
:global(html[data-theme="dark"] .iservice-logo--green) { --iservice-icon-color: #86efac; }
:global(html[data-theme="dark"] .iservice-logo--amber) { --iservice-icon-color: #fcd34d; }
:global(html[data-theme="dark"] .iservice-logo--violet) { --iservice-icon-color: #c4b5fd; }
:global(html[data-theme="dark"] .iservice-logo--indigo) { --iservice-icon-color: #a5b4fc; }
:global(html[data-theme="dark"] .iservice-logo--rose) { --iservice-icon-color: #fda4af; }

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

  .iservice-logo {
    width: 42px;
    height: 42px;
    border-radius: 10px;
  }

  .iservice-logo img {
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
