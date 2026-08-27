<template>
  <div class="calendar-map-panel">
    <div class="view-switcher" role="tablist" aria-label="校历与地图">
      <button
        id="calendar-tab"
        type="button"
        role="tab"
        :aria-selected="activeView === 'calendar'"
        aria-controls="calendar-panel"
        :class="{ active: activeView === 'calendar' }"
        @click="activeView = 'calendar'"
      >
        <el-icon><Calendar /></el-icon>
        校历
      </button>
      <button
        id="map-tab"
        type="button"
        role="tab"
        :aria-selected="activeView === 'map'"
        aria-controls="map-panel"
        :class="{ active: activeView === 'map' }"
        @click="activeView = 'map'"
      >
        <el-icon><MapLocation /></el-icon>
        校园地图
      </button>
    </div>

    <div
      v-if="activeView === 'calendar'"
      id="calendar-panel"
      class="view-panel"
      role="tabpanel"
      aria-labelledby="calendar-tab"
    >
      <section class="overview-card">
        <div class="overview-copy">
          <span class="eyebrow">官方校历</span>
          <h3>{{ calendar.academicYear }}</h3>
          <p>中国药科大学教务处 · {{ formatDate(calendar.publishedAt) }} 发布</p>
        </div>
        <div class="status-pill">
          <span>{{ status.label }}</span>
          <b>{{ status.detail }}</b>
        </div>
      </section>

      <section class="term-strip" aria-label="学期与假期概览">
        <article
          v-for="term in calendar.terms"
          :key="term.name"
          class="term-item"
          :class="[term.tone, { current: currentTerm?.name === term.name }]"
        >
          <div>
            <strong>{{ term.name }}</strong>
            <span>{{ term.weeks }} 周</span>
          </div>
          <small>{{ shortRange(term.start, term.end) }}</small>
        </article>
      </section>

      <section class="media-card">
        <div class="media-head">
          <div>
            <h3>校历原图</h3>
            <p>完整教学安排以学校发布的原图和后续通知为准</p>
          </div>
          <div class="media-actions">
            <button type="button" @click="openImageViewer('calendar')">放大查看</button>
            <a :href="calendar.sourcePage" target="_blank" rel="noopener noreferrer">官方页面</a>
            <a :href="calendar.officialPdf" target="_blank" rel="noopener noreferrer">PDF</a>
          </div>
        </div>
        <button class="image-frame calendar-image" type="button" aria-label="放大查看校历原图" @click="openImageViewer('calendar')">
          <img :src="calendarImage" :alt="`${calendar.title}${calendar.academicYear}`" loading="lazy" />
        </button>
      </section>
    </div>

    <div
      v-else
      id="map-panel"
      class="view-panel"
      role="tabpanel"
      aria-labelledby="map-tab"
    >
      <section class="overview-card map-overview">
        <div class="overview-copy">
          <span class="eyebrow">校园导览</span>
          <h3>中国药科大学校园地图</h3>
          <p>包含教学楼、宿舍分区、主要出入口与常用校园设施</p>
        </div>
        <div class="map-note">静态导览图</div>
      </section>

      <section class="media-card">
        <div class="media-head">
          <div>
            <h3>校园地图</h3>
            <p>点击地图可放大拖动查看，实际位置与通行安排以校内指引为准</p>
          </div>
          <div class="media-actions">
            <button type="button" @click="openImageViewer('map')">放大查看</button>
            <a :href="campusMapImage" target="_blank" rel="noopener noreferrer">查看大图</a>
            <a :href="campusMapImage" download="中国药科大学校园地图.png">下载地图</a>
          </div>
        </div>
        <button class="image-frame map-image" type="button" aria-label="放大查看校园地图" @click="openImageViewer('map')">
          <img :src="campusMapImage" alt="中国药科大学校园地图，含教学楼、宿舍区、出入口和校园设施" loading="lazy" />
        </button>
        <p class="image-credit">图片来自用户提供素材，图中署名：药学卷王。</p>
      </section>
    </div>

    <Teleport to="body">
      <div
        v-if="imageViewerOpen"
        class="image-viewer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="viewer-title"
        @click.self="closeImageViewer"
      >
        <div class="viewer-toolbar">
          <div>
            <b id="viewer-title">{{ viewer.title }}</b>
            <span>{{ Math.round(viewerZoom * 100) }}%</span>
          </div>
          <div class="viewer-actions">
            <button type="button" @click="setViewerZoom(1)">适屏</button>
            <button type="button" @click="setViewerZoom(2)">清晰</button>
            <button type="button" aria-label="缩小" @click="zoomViewer(-0.25)">−</button>
            <button type="button" aria-label="放大" @click="zoomViewer(0.25)">＋</button>
            <button type="button" @click="closeImageViewer">关闭</button>
          </div>
        </div>
        <div class="viewer-scroll">
          <img :src="viewer.src" :alt="viewer.alt" :style="{ width: `${viewerZoom * 100}%` }" />
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { Calendar, MapLocation } from "@element-plus/icons-vue";
import calendarImage from "@/assets/school-calendar/cpu-school-calendar-2026-2027.png";
import campusMapImage from "@/assets/school-calendar/cpu-campus-map.png";
import { cpuSchoolCalendar as calendar } from "@/data/schoolCalendar";

type ViewName = "calendar" | "map";

const activeView = ref<ViewName>("calendar");
const imageViewerOpen = ref(false);
const viewerZoom = ref(1);
const viewerKind = ref<ViewName>("calendar");

const currentTerm = computed(() => {
  const today = startOfDay(new Date());
  return calendar.terms.find((term) => isWithin(today, parseYmd(term.start), parseYmd(term.end))) ?? null;
});

const status = computed(() => {
  const today = startOfDay(new Date());
  if (currentTerm.value) {
    return {
      label: `当前：${currentTerm.value.name}`,
      detail: `距结束 ${Math.max(0, diffDays(today, parseYmd(currentTerm.value.end)))} 天`,
    };
  }

  const upcoming = calendar.terms
    .map((term) => ({ title: term.name, date: parseYmd(term.start) }))
    .filter((item) => item.date.getTime() >= today.getTime())
    .sort((a, b) => a.date.getTime() - b.date.getTime())[0];

  if (upcoming) {
    return {
      label: "即将开始",
      detail: `${upcoming.title} · ${diffDays(today, upcoming.date)} 天后`,
    };
  }

  return {
    label: "本学年已结束",
    detail: "请关注新校历",
  };
});

const viewer = computed(() => viewerKind.value === "map"
  ? {
      title: "校园地图",
      src: campusMapImage,
      alt: "中国药科大学校园地图，含教学楼、宿舍区、出入口和校园设施",
    }
  : {
      title: "校历原图",
      src: calendarImage,
      alt: `${calendar.title}${calendar.academicYear}`,
    });

function openImageViewer(kind: ViewName) {
  viewerKind.value = kind;
  viewerZoom.value = window.innerWidth <= 620 ? 1.75 : 1;
  imageViewerOpen.value = true;
}

function closeImageViewer() {
  imageViewerOpen.value = false;
}

function setViewerZoom(value: number) {
  viewerZoom.value = clampZoom(value);
}

function zoomViewer(delta: number) {
  viewerZoom.value = clampZoom(viewerZoom.value + delta);
}

function clampZoom(value: number) {
  return Math.min(3.5, Math.max(0.75, Number(value.toFixed(2))));
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && imageViewerOpen.value) closeImageViewer();
}

function parseYmd(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return startOfDay(new Date(year, month - 1, day));
}

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function isWithin(value: Date, start: Date, end: Date) {
  const time = value.getTime();
  return time >= start.getTime() && time <= end.getTime();
}

function diffDays(from: Date, to: Date) {
  return Math.ceil((to.getTime() - from.getTime()) / 86400000);
}

function formatDate(value: string) {
  const d = parseYmd(value);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function shortRange(start: string, end: string) {
  const from = parseYmd(start);
  const to = parseYmd(end);
  return `${from.getMonth() + 1}/${from.getDate()} — ${to.getMonth() + 1}/${to.getDate()}`;
}

onMounted(() => window.addEventListener("keydown", handleKeydown));
onUnmounted(() => window.removeEventListener("keydown", handleKeydown));
</script>

<style scoped>
.calendar-map-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.view-switcher {
  width: fit-content;
  max-width: 100%;
  display: grid;
  grid-template-columns: repeat(2, minmax(128px, 1fr));
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 10px;
  background: var(--cpu-surface-subtle);
}

.view-switcher button {
  min-height: 42px;
  padding: 0 18px;
  border: 0;
  border-radius: 7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  background: transparent;
  color: var(--cpu-text-secondary);
  cursor: pointer;
  font: inherit;
  font-size: 14px;
  font-weight: 650;
}

.view-switcher button.active {
  background: var(--cpu-card);
  color: var(--cpu-primary);
  box-shadow: 0 1px 5px rgba(15, 23, 42, 0.08);
}

.view-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.overview-card,
.term-item,
.media-card {
  border: 1px solid var(--cpu-border-soft);
  border-radius: 10px;
  background: var(--cpu-card);
}

.overview-card {
  min-height: 96px;
  padding: 16px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.overview-copy {
  min-width: 0;
}

.eyebrow {
  display: block;
  margin-bottom: 4px;
  color: var(--cpu-primary);
  font-size: 12px;
  font-weight: 700;
}

.overview-copy h3,
.media-head h3 {
  margin: 0;
  color: var(--cpu-text);
  font-size: 17px;
}

.overview-copy p,
.media-head p {
  margin: 5px 0 0;
  color: var(--cpu-text-secondary);
  font-size: 13px;
  line-height: 1.65;
}

.status-pill {
  min-width: 180px;
  padding: 11px 13px;
  border-radius: 9px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  background: var(--cpu-surface-subtle);
}

.status-pill span {
  color: var(--cpu-text-secondary);
  font-size: 12px;
}

.status-pill b {
  color: var(--cpu-primary);
  font-size: 15px;
}

.term-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.term-item {
  min-width: 0;
  padding: 11px 12px;
  border-left: 3px solid var(--term-accent, var(--cpu-border));
}

.term-item > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.term-item strong {
  color: var(--cpu-text);
  font-size: 14px;
}

.term-item span,
.term-item small {
  color: var(--cpu-text-secondary);
  font-size: 12px;
}

.term-item small {
  display: block;
  margin-top: 5px;
}

.term-item.teaching { --term-accent: #168776; }
.term-item.holiday { --term-accent: #d97706; }
.term-item.current {
  border-color: rgba(22, 135, 118, 0.42);
  border-left-color: var(--term-accent);
  background: rgba(22, 135, 118, 0.05);
}

.map-overview {
  background: linear-gradient(135deg, var(--cpu-card) 55%, rgba(22, 135, 118, 0.09));
}

.map-note {
  flex: 0 0 auto;
  padding: 8px 11px;
  border: 1px solid rgba(22, 135, 118, 0.2);
  border-radius: 999px;
  color: var(--cpu-primary);
  background: rgba(22, 135, 118, 0.08);
  font-size: 12px;
  font-weight: 650;
}

.media-card {
  min-width: 0;
  padding: 15px;
}

.media-head {
  margin-bottom: 12px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.media-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.media-actions button,
.media-actions a {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--cpu-primary);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 650;
  text-decoration: none;
}

.image-frame {
  width: 100%;
  max-height: 72vh;
  padding: 0;
  overflow: auto;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  display: block;
  background: #eef7f0;
  cursor: zoom-in;
}

.image-frame img {
  width: 100%;
  height: auto;
  display: block;
}

.calendar-image img {
  min-width: 720px;
}

.map-image {
  background: #3f7458;
}

.image-credit {
  margin: 9px 2px 0;
  color: var(--cpu-text-muted);
  font-size: 11px;
  line-height: 1.5;
}

.image-viewer {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  flex-direction: column;
  background: rgba(15, 23, 42, 0.88);
}

.viewer-toolbar {
  min-height: 58px;
  padding: 10px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: #fff;
  background: rgba(15, 23, 42, 0.94);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.12);
}

.viewer-toolbar > div:first-child {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.viewer-toolbar b { font-size: 15px; }
.viewer-toolbar span {
  color: rgba(255, 255, 255, 0.72);
  font-size: 12px;
}

.viewer-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.viewer-actions button {
  min-width: 42px;
  height: 36px;
  padding: 0 11px;
  border: 1px solid rgba(255, 255, 255, 0.24);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 650;
}

.viewer-actions button:hover { background: rgba(255, 255, 255, 0.18); }

.viewer-scroll {
  flex: 1;
  padding: 14px;
  overflow: auto;
  overscroll-behavior: contain;
  text-align: center;
  -webkit-overflow-scrolling: touch;
}

.viewer-scroll img {
  min-width: 0;
  max-width: none;
  height: auto;
  margin: 0 auto;
  display: block;
  background: #eef7f0;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28);
}

@media (max-width: 900px) {
  .term-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 620px) {
  .view-switcher {
    width: 100%;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .view-switcher button {
    min-width: 0;
    padding: 0 10px;
  }

  .overview-card,
  .media-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .overview-card { padding: 14px; }
  .status-pill { width: 100%; min-width: 0; }
  .term-strip { grid-template-columns: 1fr 1fr; }
  .term-item { padding: 10px; }
  .term-item > div { align-items: flex-start; flex-direction: column; gap: 2px; }
  .media-card { padding: 12px; }
  .media-actions { justify-content: flex-start; }

  .image-frame {
    max-height: none;
    overflow: hidden;
  }

  .calendar-image img { min-width: 0; }

  .viewer-toolbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .viewer-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .viewer-actions button {
    min-width: 48px;
    height: 38px;
  }

  .viewer-scroll {
    padding: 10px;
    text-align: left;
  }

  .viewer-scroll img { margin: 0; }
}
</style>
