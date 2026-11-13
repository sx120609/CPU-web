<template>
  <div class="gd-page cl-page">
    <header class="gd-head">
      <div class="gd-head-copy">
        <h1>更新日志</h1>
        <p>{{ site.brandName }} App 每个版本带来了什么。</p>
      </div>
      <button v-if="releases.length > 1" type="button" class="cl-toggle" @click="toggleAll">
        {{ allOpen ? "全部收起" : "全部展开" }}
      </button>
    </header>

    <div v-if="platforms.length > 1" class="cl-tabs" role="tablist" aria-label="客户端">
      <button
        v-for="item in platforms"
        :key="item"
        type="button"
        role="tab"
        class="cl-tab"
        :class="{ 'is-active': item === platform }"
        :aria-selected="item === platform"
        @click="selectPlatform(item)"
      >
        {{ PLATFORM_LABELS[item] }}
      </button>
    </div>

    <p v-if="!platforms.length && site.loaded" class="gd-empty">这里还没有可以查看的版本记录。</p>
    <p v-else-if="failed" class="gd-empty">
      更新日志没有加载出来。
      <button type="button" class="cl-retry" @click="load">再试一次</button>
    </p>
    <p v-else-if="!changelog" class="gd-empty">正在加载…</p>
    <p v-else-if="!releases.length" class="gd-empty">这个客户端还没有版本记录。</p>

    <template v-else>
      <p v-if="behind" class="cl-behind">
        你用的是 {{ behind.current }}，最新是 {{ behind.latest }}。
        <template v-if="platform === 'android'">App 会自己提示更新，装上就能用到新功能。</template>
        <template v-else>到{{ platform === 'harmony' ? '应用市场' : ' App Store ' }}更新后就能用上新功能。</template>
      </p>
      <div class="gd-card">
        <details
          v-for="(release, index) in releases"
          :key="release.build"
          class="cl-release"
          :open="opened.has(release.build)"
          @toggle="onToggle(release.build, $event)"
        >
          <summary>
            <span class="cl-version">{{ release.version }}</span>
            <span v-if="index === 0" class="cl-badge">最新</span>
            <span v-if="release.build === usingBuild" class="cl-badge cl-badge--using">你在用</span>
            <span class="cl-meta">{{ release.date ? formatDate(release.date) : `${release.notes.length} 项` }}</span>
            <el-icon class="cl-chevron" aria-hidden="true"><ArrowRight /></el-icon>
          </summary>
          <ul class="cl-notes">
            <li v-for="note in release.notes" :key="note">{{ text(note) }}</li>
          </ul>
        </details>
      </div>
      <p class="cl-foot">
        只列出已经发布的版本，更早的没有留下记录。
        <template v-if="!hidesClientDownloads()">
          还没装？去 <router-link to="/download">客户端下载</router-link>。
        </template>
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ArrowRight } from "@element-plus/icons-vue";
import { siteApi, type AppChangelog, type ChangelogPlatform } from "@/api/site";
import { useSiteStore } from "@/stores/site";
import {
  getAndroidNativeVersionCode,
  getHarmonyNativeVersionCode,
  hidesClientDownloads,
  isAndroidNativeApp,
  isAndroidNextApp,
  isHarmonyNativeApp,
  isIosNativeApp,
  isLikelyHarmonyDevice,
  isLikelyIosDevice,
} from "@/utils/clientInfo";
import { iosNativeAppVersion } from "@/utils/nativeAppUpdatePrompt";
import { schoolizeText } from "@/utils/schoolText";
import "../guide/guide.css";

const PLATFORM_LABELS: Record<ChangelogPlatform, string> = { android: "安卓", harmony: "鸿蒙", ios: "iOS" };

const site = useSiteStore();
const route = useRoute();
const router = useRouter();

const changelog = ref<AppChangelog | null>(null);
const failed = ref(false);
const opened = ref(new Set<number>());

// 上架的 iOS、鸿蒙 App 里只讲自己这个客户端；本校没有客户端时什么都不列。
const platforms = computed<ChangelogPlatform[]>(() => {
  if (!site.clientAppsAvailable) return [];
  if (isHarmonyNativeApp()) return ["harmony"];
  if (isIosNativeApp()) return ["ios"];
  return ["android", "harmony", "ios"];
});

function ownPlatform(): ChangelogPlatform {
  if (isHarmonyNativeApp() || isLikelyHarmonyDevice()) return "harmony";
  if (isIosNativeApp() || isLikelyIosDevice()) return "ios";
  return "android";
}

const platform = computed<ChangelogPlatform | null>(() => {
  const list = platforms.value;
  if (!list.length) return null;
  const asked = String(route.query.app ?? "") as ChangelogPlatform;
  if (list.includes(asked)) return asked;
  const own = ownPlatform();
  return list.includes(own) ? own : list[0];
});

const releases = computed(() => (platform.value && changelog.value?.[platform.value]) || []);

/** 在对应的 App 里打开时，标出手上这一版。NEXT 是另一个 App，版本号不通用。 */
const usingBuild = computed(() => {
  const list = releases.value;
  if (platform.value === "android" && isAndroidNativeApp() && !isAndroidNextApp()) return getAndroidNativeVersionCode();
  if (platform.value === "harmony" && isHarmonyNativeApp()) return getHarmonyNativeVersionCode();
  if (platform.value === "ios" && isIosNativeApp()) {
    const version = iosNativeAppVersion(navigator.userAgent);
    return list.find((release) => release.version === version)?.build ?? 0;
  }
  return 0;
});

const behind = computed(() => {
  const list = releases.value;
  const current = list.find((release) => release.build === usingBuild.value);
  if (!current || current === list[0]) return null;
  return { current: current.version, latest: list[0].version };
});

const allOpen = computed(() => releases.value.every((release) => opened.value.has(release.build)));

// 每次换客户端都只展开最新一版，其余点开再看。
watch(releases, (list) => {
  opened.value = new Set(list.slice(0, 1).map((release) => release.build));
}, { immediate: true });

function onToggle(build: number, event: Event) {
  const open = (event.target as HTMLDetailsElement).open;
  if (open === opened.value.has(build)) return;
  const next = new Set(opened.value);
  if (open) next.add(build);
  else next.delete(build);
  opened.value = next;
}

function toggleAll() {
  opened.value = allOpen.value ? new Set() : new Set(releases.value.map((release) => release.build));
}

function selectPlatform(item: ChangelogPlatform) {
  void router.replace({ query: { ...route.query, app: item } });
}

function formatDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return day ? `${year} 年 ${month} 月 ${day} 日` : `${year} 年 ${month} 月`;
}

/** 更新内容按默认学校的叫法写；别的学校换成本校的品牌名和简称。 */
function text(value: string) {
  if (site.isDefaultSchool) return value;
  return schoolizeText(value.replaceAll("药大拾间", site.brandName), false, site.schoolShortName);
}

async function load() {
  failed.value = false;
  try {
    changelog.value = await siteApi.changelog();
  } catch {
    failed.value = true;
  }
}

onMounted(() => {
  if (!site.loaded) void site.fetch();
  void load();
});
</script>

<style scoped>
.cl-toggle,
.cl-retry {
  padding: 0;
  border: 0;
  background: none;
  color: var(--cpu-primary);
  font: inherit;
  font-size: var(--cpu-fs-s);
  cursor: pointer;
}
.cl-toggle { min-height: 32px; font-weight: 600; }

.cl-tabs {
  display: flex;
  align-self: flex-start;
  gap: 2px;
  padding: 3px;
  border-radius: var(--cpu-radius-pill);
  background: var(--cpu-surface-soft);
}
.cl-tab {
  min-width: 64px;
  min-height: 30px;
  padding: 0 16px;
  border: 0;
  border-radius: var(--cpu-radius-pill);
  background: none;
  color: var(--cpu-text-secondary);
  font: inherit;
  font-size: var(--cpu-fs-s);
  cursor: pointer;
}
.cl-tab.is-active {
  background: var(--cpu-card);
  color: var(--cpu-text);
  font-weight: 600;
  box-shadow: 0 1px 2px rgb(0 0 0 / 8%);
}

.cl-behind {
  margin: 0;
  padding: 10px 14px;
  border-radius: var(--cpu-radius-m);
  background: var(--cpu-primary-soft);
  color: var(--cpu-text);
  font-size: var(--cpu-fs-s);
}

.cl-release { border-top: 1px solid var(--cpu-border-soft); }
.cl-release:first-child { border-top: 0; }
.cl-release > summary {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  list-style: none;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.cl-release > summary::-webkit-details-marker { display: none; }
.cl-version {
  font-size: var(--cpu-fs-l);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.4;
}
.cl-badge {
  flex: 0 0 auto;
  padding: 0 8px;
  border-radius: var(--cpu-radius-pill);
  background: var(--cpu-primary-soft);
  color: var(--cpu-primary);
  font-size: var(--cpu-fs-xs);
  font-weight: 600;
  line-height: 20px;
  white-space: nowrap;
}
.cl-badge--using {
  background: var(--cpu-surface-soft);
  color: var(--cpu-text-secondary);
}
.cl-meta {
  min-width: 0;
  margin-left: auto;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-xs);
  white-space: nowrap;
}
.cl-chevron {
  flex: 0 0 auto;
  color: var(--cpu-text-muted);
  transition: transform .16s ease;
}
.cl-release[open] .cl-chevron { transform: rotate(90deg); }
@media (hover: hover) {
  .cl-release > summary:hover { background: var(--cpu-surface-soft); }
}
@media (prefers-reduced-motion: reduce) {
  .cl-chevron { transition: none; }
}

.cl-notes {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0 14px 14px 32px;
  color: var(--cpu-text);
  font-size: var(--cpu-fs-m);
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.cl-notes li::marker { color: var(--cpu-text-muted); }

.cl-foot {
  margin: 0;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-xs);
  text-align: center;
}
.cl-foot a { color: var(--cpu-primary); text-decoration: none; }
</style>
