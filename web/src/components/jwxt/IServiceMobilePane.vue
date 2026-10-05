<template>
  <div class="iapps-m" :aria-busy="loading">
    <div v-if="apps.length && !searching" class="iapps-m-chips" role="group" aria-label="应用筛选">
      <button
        data-cpu-button="surface"
        type="button"
        class="iapps-m-chip"
        :class="{ active: !filterFav && !activeCat }"
        :aria-pressed="!filterFav && !activeCat"
        @click="selectScope('', '')"
      >
        全部<span>{{ apps.length }}</span>
      </button>
      <button
        v-if="favoriteCount"
        data-cpu-button="surface"
        type="button"
        class="iapps-m-chip iapps-m-chip--fav"
        :class="{ active: filterFav === 'fav' }"
        :aria-pressed="filterFav === 'fav'"
        @click="selectScope('fav', '')"
      >
        <el-icon aria-hidden="true"><StarFilled /></el-icon>收藏<span>{{ favoriteCount }}</span>
      </button>
      <button
        v-for="c in categories"
        :key="c.name"
        data-cpu-button="surface"
        type="button"
        class="iapps-m-chip"
        :class="{ active: activeCat === c.name }"
        :aria-pressed="activeCat === c.name"
        @click="selectScope('', c.name)"
      >
        {{ c.name }}<span>{{ c.count }}</span>
      </button>
    </div>

    <ul v-if="shown.length" class="iapps-m-list">
      <li v-for="a in shown" :key="a.id" class="iapps-m-row">
        <button data-cpu-button="surface" type="button" class="iapps-m-main" @click="openApp(a)">
          <span class="iapps-m-logo" :class="`iapps-m-logo--${darkAppIconTone(a)}`" aria-hidden="true">
            <img
              v-if="hasAppIcon(a)"
              class="iapps-m-logo-light"
              :src="appIconSource(a)"
              alt=""
              loading="lazy"
              decoding="async"
              fetchpriority="low"
              referrerpolicy="no-referrer"
              @error="onIconError(a)"
            />
            <span v-else class="iapps-m-logo-light iapps-m-logo-letter">{{ a.name.charAt(0) }}</span>
            <AppIcon class="iapps-m-logo-dark" :name="darkAppIconName(a)" />
          </span>
          <span class="iapps-m-copy">
            <b>{{ a.name }}</b>
            <small>{{ appMeta(a) }}</small>
          </span>
        </button>
        <button
          data-cpu-button="surface"
          type="button"
          class="iapps-m-fav"
          :class="{ active: a.favorite }"
          :aria-label="a.favorite ? `取消收藏${a.name}` : `收藏${a.name}`"
          :aria-pressed="a.favorite"
          @click="toggleFavorite(a)"
        >
          <el-icon><StarFilled v-if="a.favorite" /><Star v-else /></el-icon>
        </button>
      </li>
    </ul>
    <button v-if="hiddenCount" data-cpu-button="surface" type="button" class="iapps-m-more" @click="expanded = true">
      展开其余 {{ hiddenCount }} 个应用<el-icon aria-hidden="true"><ArrowDown /></el-icon>
    </button>

    <template v-if="!shown.length && !searching">
      <ul v-if="loading" class="iapps-m-list" aria-hidden="true">
        <li v-for="n in 4" :key="n" class="iapps-m-row iapps-m-row--skeleton"><i /><span><i /><i /></span></li>
      </ul>
      <div v-else-if="error" class="iapps-m-state" role="alert">
        <b>暂时没能加载出应用列表</b>
        <p>{{ error }}。你可以稍后再试。</p>
        <el-button type="primary" plain :loading="loading" @click="reload()">重新加载</el-button>
      </div>
      <div v-else class="iapps-m-state">
        <p>暂时还没有拿到应用列表，请稍后再试</p>
        <el-button plain @click="reload()">重新加载</el-button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRef, watch } from "vue";
import { ArrowDown, Star, StarFilled } from "@element-plus/icons-vue";
import AppIcon from "@/components/common/AppIcon.vue";
import { useIServiceApps, type IServiceApp } from "./iServiceApps";

// 未筛选时先只列最常用的几项，避免上百个应用把页面拉得很长。
const COLLAPSED_COUNT = 8;

const props = defineProps<{ keyword: string }>();
const emit = defineEmits<{ matches: [count: number] }>();

const {
  apps,
  loading,
  error,
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
} = useIServiceApps({ keyword: toRef(props, "keyword") });

const expanded = ref(false);
const searching = computed(() => Boolean(props.keyword.trim()));
const favoriteCount = computed(() => apps.value.filter((a) => a.favorite).length);
const collapsible = computed(() => !expanded.value && !searching.value && !filterFav.value && !activeCat.value
  && filtered.value.length > COLLAPSED_COUNT + 2);
const shown = computed(() => (collapsible.value ? filtered.value.slice(0, COLLAPSED_COUNT) : filtered.value));
const hiddenCount = computed(() => filtered.value.length - shown.value.length);

watch(() => filtered.value.length, (count) => emit("matches", count), { immediate: true });
// 整页搜索覆盖全部应用，不受之前选中的分类影响。
watch(searching, (active) => { if (active) selectScope("", ""); });
// 取消最后一个收藏后“收藏”筛选项会消失，回到全部。
watch(favoriteCount, (count) => { if (!count && filterFav.value) selectScope("", ""); });

function selectScope(fav: "" | "fav", category: string) {
  filterFav.value = fav;
  activeCat.value = category;
}

function appMeta(a: IServiceApp) {
  return [a.types[0], a.dept].filter(Boolean).join(" · ") || a.detail || "校园应用";
}
</script>

<style scoped>
.iapps-m { display: flex; min-width: 0; flex-direction: column; gap: 10px; }

.iapps-m-chips {
  display: flex;
  gap: 7px;
  padding: 1px;
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}
.iapps-m-chips::-webkit-scrollbar { display: none; }
.iapps-m-chip {
  display: inline-flex;
  flex: 0 0 auto;
  min-height: 34px;
  align-items: center;
  gap: 5px;
  padding: 0 12px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 999px;
  background: var(--cpu-card);
  color: var(--cpu-text-secondary);
  font: inherit;
  font-size: 13px;
  font-weight: 550;
  white-space: nowrap;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.iapps-m-chip span { color: var(--cpu-text-muted); font-size: 11px; font-weight: 500; font-variant-numeric: tabular-nums; }
.iapps-m-chip--fav .el-icon { color: #f59e0b; font-size: 14px; }
.iapps-m-chip.active { border-color: transparent; background: var(--cpu-button-primary); color: var(--cpu-button-on-primary); }
.iapps-m-chip.active span,
.iapps-m-chip.active .el-icon { color: inherit; opacity: .82; }
.iapps-m-chip:focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: 2px; }

.iapps-m-list {
  margin: 0;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 14px;
  background: var(--cpu-card);
  box-shadow: var(--cpu-shadow-sm);
  list-style: none;
}
.iapps-m-row { display: flex; min-width: 0; align-items: stretch; border-bottom: 1px solid var(--cpu-border-soft); }
.iapps-m-row:last-child { border-bottom: 0; }
.iapps-m-main {
  display: flex;
  min-width: 0;
  min-height: 58px;
  flex: 1;
  align-items: center;
  gap: 11px;
  padding: 9px 4px 9px 12px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.iapps-m-main:active { background: var(--cpu-surface-soft); }
.iapps-m-main:focus-visible,
.iapps-m-fav:focus-visible,
.iapps-m-more:focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: -2px; }

.iapps-m-logo {
  display: grid;
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  place-items: center;
  overflow: hidden;
  border: 1px solid transparent;
  border-radius: 10px;
  background: var(--cpu-surface-subtle);
}
.iapps-m-logo img { width: 30px; height: 30px; object-fit: contain; }
.iapps-m-logo-letter { color: var(--cpu-primary); font-size: 17px; font-weight: 650; }
.iapps-m-logo-dark { display: none; }

.iapps-m-copy { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
.iapps-m-copy b {
  overflow: hidden;
  color: var(--cpu-text);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.iapps-m-copy small {
  overflow: hidden;
  color: var(--cpu-text-muted);
  font-size: 11px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.iapps-m-fav {
  display: grid;
  width: 46px;
  flex: 0 0 auto;
  place-items: center;
  border: 0;
  background: transparent;
  color: var(--cpu-text-muted);
  font-size: 18px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.iapps-m-fav.active { color: #f59e0b; }
.iapps-m-fav:active { background: var(--cpu-surface-soft); }

.iapps-m-more {
  display: inline-flex;
  min-height: 42px;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  background: var(--cpu-card);
  color: var(--cpu-text-secondary);
  font: inherit;
  font-size: 13px;
  font-weight: 550;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.iapps-m-more:active { background: var(--cpu-surface-soft); }

.iapps-m-row--skeleton { min-height: 58px; align-items: center; gap: 11px; padding: 9px 12px; }
.iapps-m-row--skeleton > i { width: 38px; height: 38px; flex: 0 0 auto; border-radius: 10px; background: var(--cpu-surface-subtle); }
.iapps-m-row--skeleton > span { display: flex; flex: 1; flex-direction: column; gap: 7px; }
.iapps-m-row--skeleton > span i { height: 10px; border-radius: 5px; background: var(--cpu-surface-subtle); }
.iapps-m-row--skeleton > span i:first-child { width: 46%; }
.iapps-m-row--skeleton > span i:last-child { width: 28%; }
.iapps-m-row--skeleton i { animation: iapps-m-pulse 1.3s ease-in-out infinite; }
@keyframes iapps-m-pulse { 50% { opacity: .5; } }

.iapps-m-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 20px 16px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 14px;
  background: var(--cpu-card);
  text-align: center;
}
.iapps-m-state b { color: var(--cpu-text); font-size: 14px; }
.iapps-m-state p { margin: 0; color: var(--cpu-text-secondary); font-size: 12px; line-height: 1.6; }

/* 学校提供的应用图标多为浅色底图，暗色下改用按业务归类的线性图标。 */
:global(html[data-theme="dark"] .iapps-m-logo) {
  border-color: color-mix(in srgb, var(--iapps-m-tone, var(--cpu-primary)) 30%, var(--cpu-border-soft));
  background: color-mix(in srgb, var(--iapps-m-tone, var(--cpu-primary)) 13%, var(--cpu-surface-soft));
}
:global(html[data-theme="dark"] .iapps-m-logo-light) { display: none; }
:global(html[data-theme="dark"] .iapps-m-logo-dark) {
  display: inline-flex;
  color: var(--iapps-m-tone, var(--cpu-primary-light));
  font-size: 21px;
}
:global(html[data-theme="dark"] .iapps-m-logo--teal) { --iapps-m-tone: #5eead4; }
:global(html[data-theme="dark"] .iapps-m-logo--blue) { --iapps-m-tone: #93c5fd; }
:global(html[data-theme="dark"] .iapps-m-logo--cyan) { --iapps-m-tone: #67e8f9; }
:global(html[data-theme="dark"] .iapps-m-logo--green) { --iapps-m-tone: #86efac; }
:global(html[data-theme="dark"] .iapps-m-logo--amber) { --iapps-m-tone: #fcd34d; }
:global(html[data-theme="dark"] .iapps-m-logo--violet) { --iapps-m-tone: #c4b5fd; }
:global(html[data-theme="dark"] .iapps-m-logo--indigo) { --iapps-m-tone: #a5b4fc; }
:global(html[data-theme="dark"] .iapps-m-logo--rose) { --iapps-m-tone: #fda4af; }

@media (prefers-reduced-motion: reduce) {
  .iapps-m-row--skeleton i { animation: none; }
}
</style>
