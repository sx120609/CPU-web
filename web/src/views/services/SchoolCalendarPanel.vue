<template>
  <div class="cal">
    <div class="cal-switch" role="tablist" aria-label="校历与地图">
      <button
        v-for="view in views"
        :id="`${view.name}-tab`"
        :key="view.name"
        data-cpu-button="surface"
        type="button"
        role="tab"
        :aria-selected="activeView === view.name"
        :aria-controls="`${view.name}-panel`"
        :class="{ active: activeView === view.name }"
        @click="activeView = view.name"
      >
        <el-icon aria-hidden="true"><component :is="view.icon" /></el-icon>{{ view.label }}
      </button>
    </div>

    <div v-if="activeView === 'calendar'" id="calendar-panel" class="cal-panel" role="tabpanel" aria-labelledby="calendar-tab">
      <section class="pk-card cal-status" :class="currentTerm ? `is-${currentTerm.tone}` : ''">
        <div class="cal-status-main">
          <span class="cal-eyebrow">{{ status.label }}</span>
          <h2>{{ status.headline }}</h2>
          <p>{{ status.detail }}</p>
        </div>
        <div v-if="currentTerm" class="cal-status-progress">
          <div class="cal-bar" role="progressbar" :aria-valuenow="progress.percent" aria-valuemin="0" aria-valuemax="100" :aria-label="`${currentTerm.name}进度`">
            <span :style="{ width: `${progress.percent}%` }" />
          </div>
          <div class="cal-bar-labels">
            <span>{{ shortDate(currentTerm.start) }}</span>
            <b>已过 {{ progress.percent }}%</b>
            <span>{{ shortDate(currentTerm.end) }}</span>
          </div>
        </div>
        <p class="cal-source">{{ calendar.academicYear }} · 中国药科大学教务处 {{ formatDate(calendar.publishedAt) }} 发布</p>
      </section>

      <section class="cal-terms" aria-label="学期与假期概览">
        <article
          v-for="term in calendar.terms"
          :key="term.name"
          class="cal-term"
          :class="[`is-${term.tone}`, { current: currentTerm?.name === term.name }]"
        >
          <b>{{ term.name }}<em v-if="currentTerm?.name === term.name">当前</em></b>
          <span>{{ term.weeks }} 周</span>
          <small>{{ shortRange(term.start, term.end) }}</small>
        </article>
      </section>

      <section class="pk-card" aria-labelledby="cal-events-title">
        <header class="pk-card-head">
          <div>
            <h2 id="cal-events-title" class="pk-h2">重要日期</h2>
            <p class="pk-muted">摘自官方校历，具体安排以学校后续通知为准</p>
          </div>
        </header>
        <ol class="cal-events">
          <li v-for="event in events" :key="event.title" :class="[`is-${event.state}`, { next: event.next }]">
            <time>{{ event.dateLabel }}</time>
            <div>
              <b>{{ event.title }}</b>
              <small v-if="event.description">{{ event.description }}</small>
            </div>
            <span class="pk-badge" :class="{ 'is-primary': event.state !== 'past' }">{{ event.stateLabel }}</span>
          </li>
        </ol>
      </section>

      <section class="pk-card cal-media">
        <header class="pk-card-head">
          <div>
            <h2 class="pk-h2">校历原图</h2>
            <p class="pk-muted">完整教学安排以学校发布的原图和后续通知为准</p>
          </div>
          <div class="cal-actions">
            <button data-cpu-button="surface" type="button" class="pk-pill" @click="openImageViewer('calendar')"><el-icon aria-hidden="true"><ZoomIn /></el-icon>放大查看</button>
            <a class="pk-pill" :href="calendar.sourcePage" target="_blank" rel="noopener noreferrer">官方页面</a>
            <a class="pk-pill" :href="calendar.officialPdf" target="_blank" rel="noopener noreferrer">PDF</a>
          </div>
        </header>
        <button data-cpu-button="media" class="cal-frame cal-frame--calendar" type="button" aria-label="放大查看校历原图" @click="openImageViewer('calendar')">
          <img :src="calendarImage" :alt="`${calendar.title}${calendar.academicYear}`" loading="lazy" />
        </button>
      </section>
    </div>

    <div v-else id="map-panel" class="cal-panel" role="tabpanel" aria-labelledby="map-tab">
      <section class="pk-card cal-media">
        <header class="pk-card-head">
          <div>
            <h2 class="pk-h2">中国药科大学校园地图</h2>
            <p class="pk-muted">包含教学楼、宿舍分区、主要出入口与常用校园设施。点击地图可放大拖动查看，实际位置与通行安排以校内指引为准。</p>
          </div>
          <div class="cal-actions">
            <button data-cpu-button="surface" type="button" class="pk-pill" @click="openImageViewer('map')"><el-icon aria-hidden="true"><ZoomIn /></el-icon>放大查看</button>
            <a
              class="pk-pill"
              :href="campusMapOriginalDownloadUrl"
              download="中国药科大学校园地图-原图.png"
              aria-label="下载校园地图原图（5000 × 4551，20.34 MB）"
              title="5000 × 4551 · 20.34 MB"
            ><el-icon aria-hidden="true"><Download /></el-icon>下载原图</a>
          </div>
        </header>
        <button data-cpu-button="media" class="cal-frame cal-frame--map" type="button" aria-label="放大查看校园地图" @click="openImageViewer('map')">
          <img :src="campusMapOriginalViewUrl" alt="中国药科大学校园地图，含教学楼、宿舍区、出入口和校园设施" loading="lazy" />
        </button>
        <p class="cal-credit">静态导览图 · 图片来自用户提供素材，图中署名：药学卷王。</p>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { Calendar, Download, MapLocation, ZoomIn } from "@element-plus/icons-vue";
import calendarImage from "@/assets/school-calendar/cpu-school-calendar-2026-2027.png";
import { cpuSchoolCalendar as calendar } from "@/data/schoolCalendar";
import { openImageGallery } from "@/utils/imageViewer";
import "@/styles/page-kit.css";

type ViewName = "calendar" | "map";

const campusMapOriginalDownloadUrl = "/api/site/downloads/campus-map-original";
const campusMapOriginalViewUrl = "/api/site/media/campus-map-original";
const views = [
  { name: "calendar", label: "校历", icon: Calendar },
  { name: "map", label: "校园地图", icon: MapLocation },
] as const;
const activeView = ref<ViewName>("calendar");
const today = startOfDay(new Date());

const currentTerm = computed(() => (
  calendar.terms.find((term) => isWithin(today, parseYmd(term.start), parseYmd(term.end))) ?? null
));

// 学期从周一开始，校历里的“第 N 周”就是从开学日起每 7 天一周。
const progress = computed(() => {
  const term = currentTerm.value;
  if (!term) return { percent: 0, week: 0, daysLeft: 0 };
  const start = parseYmd(term.start);
  const end = parseYmd(term.end);
  const total = diffDays(start, end) + 1;
  const elapsed = diffDays(start, today) + 1;
  return {
    percent: Math.min(100, Math.max(0, Math.round((elapsed / total) * 100))),
    week: Math.min(term.weeks, Math.floor(diffDays(start, today) / 7) + 1),
    daysLeft: Math.max(0, diffDays(today, end)),
  };
});

const status = computed(() => {
  const term = currentTerm.value;
  if (term) {
    return {
      label: term.tone === "holiday" ? "假期中" : "学期进行中",
      headline: `${term.name} · 第 ${progress.value.week} 周`,
      detail: `共 ${term.weeks} 周，距结束 ${progress.value.daysLeft} 天`,
    };
  }

  const upcoming = calendar.terms
    .map((item) => ({ title: item.name, date: parseYmd(item.start) }))
    .filter((item) => item.date.getTime() >= today.getTime())
    .sort((a, b) => a.date.getTime() - b.date.getTime())[0];

  if (upcoming) {
    return { label: "即将开始", headline: upcoming.title, detail: `${diffDays(today, upcoming.date)} 天后开始` };
  }
  return { label: "本学年已结束", headline: "请关注新校历", detail: "新学年校历发布后会在这里更新" };
});

const events = computed(() => {
  let nextMarked = false;
  return calendar.events.map((event) => {
    const endYmd = "endDate" in event && event.endDate ? event.endDate : event.date;
    const start = parseYmd(event.date);
    const end = parseYmd(endYmd);
    const state = today.getTime() < start.getTime() ? "upcoming" : today.getTime() > end.getTime() ? "past" : "ongoing";
    const next = state !== "past" && !nextMarked;
    if (next) nextMarked = true;
    const days = diffDays(today, start);
    return {
      title: event.title,
      description: "description" in event ? event.description : "",
      dateLabel: endYmd === event.date ? shortDate(event.date) : `${shortDate(event.date)} — ${shortDate(endYmd)}`,
      state,
      next,
      stateLabel: state === "past" ? "已过" : state === "ongoing" ? "进行中" : days === 0 ? "今天" : `${days} 天后`,
    };
  });
});

function openImageViewer(kind: ViewName) {
  openImageGallery([
    {
      src: calendarImage,
      title: `${calendar.title}${calendar.academicYear}`,
      alt: `${calendar.title}${calendar.academicYear}`,
      fileName: `${calendar.academicYear}中国药科大学校历.png`,
    },
    {
      src: campusMapOriginalViewUrl,
      title: "中国药科大学校园地图",
      alt: "中国药科大学校园地图，含教学楼、宿舍区、出入口和校园设施",
      fileName: "中国药科大学校园地图.png",
    },
  ], kind === "map" ? 1 : 0, { className: "cpu-calendar-image-viewer" });
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
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

function formatDate(value: string) {
  const d = parseYmd(value);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function shortDate(value: string) {
  const d = parseYmd(value);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function shortRange(start: string, end: string) {
  const from = parseYmd(start);
  const to = parseYmd(end);
  return `${from.getMonth() + 1}/${from.getDate()} — ${to.getMonth() + 1}/${to.getDate()}`;
}
</script>

<style scoped>
.cal,
.cal-panel { display: flex; min-width: 0; flex-direction: column; gap: 14px; }
.cal :is(h2, p) { margin: 0; }

.cal-switch { display: inline-flex; align-self: flex-start; gap: 4px; padding: 4px; border-radius: var(--cpu-radius-l); background: var(--cpu-surface-subtle); }
.cal-switch button {
  display: inline-flex;
  min-height: 38px;
  align-items: center;
  gap: 6px;
  padding: 0 18px;
  border: 0;
  border-radius: var(--cpu-radius-m);
  background: transparent;
  color: var(--cpu-text-secondary);
  font: inherit;
  font-size: var(--cpu-fs-m);
  font-weight: 500;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.cal-switch button.active { background: var(--cpu-card); box-shadow: var(--cpu-shadow-sm); color: var(--cpu-primary); }
.cal-switch button:focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: 2px; }

/* 当前学期状态：标题、进度条和来源说明。 */
.cal-status {
  --cal-tone: var(--cpu-primary);
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
  align-items: center;
  gap: 14px 28px;
  border-color: color-mix(in srgb, var(--cal-tone) 26%, var(--cpu-border-soft));
  background: color-mix(in srgb, var(--cal-tone) 6%, var(--cpu-card));
}
.cal-status.is-holiday { --cal-tone: var(--cpu-gold); }
.cal-eyebrow { color: color-mix(in srgb, var(--cal-tone) 78%, var(--cpu-text)); font-size: var(--cpu-fs-xs); font-weight: 500; }
.cal-status h2 { margin-top: 4px; font-size: 26px; font-weight: 700; line-height: 1.3; letter-spacing: -.01em; }
.cal-status-main p { margin-top: 4px; color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); }
.cal-bar { height: 10px; overflow: hidden; border-radius: var(--cpu-radius-pill); background: color-mix(in srgb, var(--cal-tone) 14%, var(--cpu-card)); }
.cal-bar span { display: block; height: 100%; border-radius: inherit; background: var(--cal-tone); }
.cal-bar-labels { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); font-variant-numeric: tabular-nums; }
.cal-bar-labels b { color: color-mix(in srgb, var(--cal-tone) 78%, var(--cpu-text)); font-weight: 500; }
.cal-source { grid-column: 1 / -1; padding-top: 12px; border-top: 1px solid color-mix(in srgb, var(--cal-tone) 16%, var(--cpu-border-soft)); color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }

.cal-terms { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.cal-term {
  --cal-tone: var(--cpu-primary);
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  padding: 12px 14px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-card);
  box-shadow: var(--cpu-shadow-sm);
}
.cal-term.is-holiday { --cal-tone: var(--cpu-gold); }
.cal-term b { display: flex; align-items: center; gap: 6px; font-size: var(--cpu-fs-m); font-weight: 500; }
.cal-term b::before { width: 8px; height: 8px; flex: 0 0 auto; border-radius: 50%; background: var(--cal-tone); content: ""; }
.cal-term em { padding: 0 6px; border-radius: var(--cpu-radius-pill); background: color-mix(in srgb, var(--cal-tone) 14%, var(--cpu-card)); color: color-mix(in srgb, var(--cal-tone) 78%, var(--cpu-text)); font-size: var(--cpu-fs-xs); font-style: normal; font-weight: 500; line-height: 1.7; }
.cal-term span { color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); }
.cal-term small { color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); font-variant-numeric: tabular-nums; }
.cal-term.current { border-color: color-mix(in srgb, var(--cal-tone) 46%, var(--cpu-border-soft)); }

.cal-events { margin: 0; padding: 0; list-style: none; }
.cal-events li {
  display: grid;
  grid-template-columns: 132px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-height: 52px;
  padding: 8px 0;
  border-bottom: 1px solid var(--cpu-border-soft);
}
.cal-events li:last-child { padding-bottom: 0; border-bottom: 0; }
.cal-events time { color: var(--cpu-text-secondary); font-size: var(--cpu-fs-s); font-variant-numeric: tabular-nums; }
.cal-events div { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
.cal-events b { font-size: var(--cpu-fs-m); font-weight: 500; }
.cal-events small { color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
.cal-events li.is-past :is(time, b) { color: var(--cpu-text-muted); font-weight: 500; }
.cal-events li.next b { color: var(--cpu-primary); }

.cal-actions { display: flex; flex: 0 0 auto; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.cal-frame {
  display: block;
  width: 100%;
  max-height: 72vh;
  padding: 0;
  overflow: auto;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: #eef7f0;
  cursor: zoom-in;
}
.cal-frame:focus-visible { outline: 2px solid var(--cpu-primary); outline-offset: 2px; }
.cal-frame img { display: block; width: 100%; height: auto; }
.cal-frame--calendar img { min-width: 720px; }
.cal-frame--map { background: #3f7458; }
.cal-credit { margin-top: 10px; color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }

@media (max-width: 768px) {
  .cal,
  .cal-panel { gap: 12px; }
  .cal-switch { align-self: stretch; }
  .cal-switch button { flex: 1; justify-content: center; }
  .cal-status { grid-template-columns: minmax(0, 1fr); }
  .cal-status h2 { font-size: var(--cpu-fs-xl); }
  .cal-terms { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .cal-events li { grid-template-columns: minmax(0, 1fr) auto; gap: 2px 10px; }
  .cal-events time { grid-column: 1 / -1; font-size: var(--cpu-fs-xs); }
  .cal-media .pk-card-head { flex-direction: column; }
  .cal-actions { justify-content: flex-start; }
  .cal-frame { max-height: 62vh; }
  .cal-frame--calendar img { min-width: 0; }
}
</style>
