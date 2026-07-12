<template>
  <div class="school-calendar-panel">
    <section class="calendar-overview">
      <div class="overview-main">
        <div class="calendar-kicker">官方校历</div>
        <h3>{{ calendar.title }} {{ calendar.academicYear }}</h3>
        <p>来源：中国药科大学教务处，发布时间 {{ formatDate(calendar.publishedAt) }}</p>
      </div>
      <div class="overview-status">
        <span>{{ status.label }}</span>
        <b>{{ status.detail }}</b>
      </div>
    </section>

    <section class="term-grid" aria-label="学期与假期">
      <article v-for="term in calendar.terms" :key="term.name" class="term-card" :class="term.tone">
        <span>{{ term.name }}</span>
        <b>{{ term.weeks }} 周</b>
        <small>{{ formatRange(term.start, term.end) }}</small>
      </article>
    </section>

    <section class="calendar-layout">
      <div class="event-panel">
        <div class="panel-title">
          <h3>关键节点</h3>
          <a :href="calendar.sourcePage" target="_blank" rel="noopener noreferrer">官方页面</a>
        </div>
        <div class="event-list">
          <div
            v-for="event in calendar.events"
            :key="`${event.title}-${event.date}`"
            class="event-item"
            :class="event.tone || 'muted'"
          >
            <div class="event-date">
              <b>{{ monthDay(event.date) }}</b>
              <span v-if="event.endDate">至 {{ monthDay(event.endDate) }}</span>
            </div>
            <div class="event-copy">
              <strong>{{ event.title }}</strong>
              <small>{{ formatRange(event.date, event.endDate || event.date) }}</small>
              <p v-if="event.description">{{ event.description }}</p>
            </div>
          </div>
        </div>
      </div>

      <div class="image-panel">
        <div class="panel-title">
          <h3>校历原图</h3>
          <div class="source-actions">
            <a :href="calendarImage" target="_blank" rel="noopener noreferrer">查看大图</a>
            <a :href="calendar.officialPdf" target="_blank" rel="noopener noreferrer">PDF</a>
          </div>
        </div>
        <div class="calendar-image-frame">
          <img :src="calendarImage" :alt="`${calendar.title}${calendar.academicYear}`" loading="lazy" />
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import calendarImage from "@/assets/school-calendar/cpu-school-calendar-2026-2027.png";
import { cpuSchoolCalendar as calendar } from "@/data/schoolCalendar";

const status = computed(() => {
  const today = startOfDay(new Date());
  const current = calendar.terms.find((term) => isWithin(today, parseYmd(term.start), parseYmd(term.end)));
  if (current) {
    const end = parseYmd(current.end);
    return {
      label: `当前：${current.name}`,
      detail: `距结束 ${Math.max(0, diffDays(today, end))} 天`,
    };
  }

  const upcoming = [
    ...calendar.terms.map((item) => ({ title: item.name, date: parseYmd(item.start) })),
    ...calendar.events.map((item) => ({ title: item.title, date: parseYmd(item.date) })),
  ]
    .filter((item) => item.date.getTime() >= today.getTime())
    .sort((a, b) => a.date.getTime() - b.date.getTime())[0];

  if (upcoming) {
    return {
      label: "下一个节点",
      detail: `${upcoming.title} · ${diffDays(today, upcoming.date)} 天后`,
    };
  }

  return {
    label: "校历已结束",
    detail: "等待学校发布新学年校历",
  };
});

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

function monthDay(value: string) {
  const d = parseYmd(value);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatRange(start: string, end: string) {
  if (start === end) return formatDate(start);
  return `${formatDate(start)} - ${formatDate(end)}`;
}
</script>

<style scoped>
.school-calendar-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.calendar-overview,
.term-card,
.event-panel,
.image-panel {
  border: 1px solid var(--cpu-border-soft);
  border-radius: 10px;
  background: var(--cpu-card);
}

.calendar-overview {
  display: flex;
  align-items: stretch;
  justify-content: space-between;
  gap: 14px;
  padding: 18px;
}

.overview-main {
  min-width: 0;
}

.calendar-kicker {
  color: var(--cpu-primary);
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 5px;
}

.overview-main h3,
.panel-title h3 {
  margin: 0;
  color: var(--cpu-text);
  font-size: 17px;
}

.overview-main p {
  margin: 6px 0 0;
  color: var(--cpu-text-secondary);
  font-size: 13px;
  line-height: 1.7;
}

.overview-status {
  min-width: 190px;
  padding: 13px 14px;
  border-radius: 10px;
  background: var(--cpu-surface-subtle);
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 5px;
}

.overview-status span {
  color: var(--cpu-text-secondary);
  font-size: 12px;
}

.overview-status b {
  color: var(--cpu-primary);
  font-size: 16px;
}

.term-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.term-card {
  min-height: 108px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: relative;
  overflow: hidden;
}

.term-card::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: 4px;
  background: var(--term-accent, var(--cpu-primary));
}

.term-card span {
  color: var(--cpu-text-secondary);
  font-size: 13px;
}

.term-card b {
  color: var(--cpu-text);
  font-size: 22px;
}

.term-card small {
  color: var(--cpu-text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.term-card.teaching {
  --term-accent: #168776;
}

.term-card.holiday {
  --term-accent: #d97706;
}

.term-card.exam {
  --term-accent: #dc2626;
}

.calendar-layout {
  display: grid;
  grid-template-columns: 360px minmax(0, 1fr);
  gap: 14px;
}

.event-panel,
.image-panel {
  padding: 16px;
  min-width: 0;
}

.panel-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}

.panel-title a,
.source-actions a {
  color: var(--cpu-primary);
  font-size: 13px;
  font-weight: 650;
  text-decoration: none;
}

.source-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.event-list {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.event-item {
  display: grid;
  grid-template-columns: 74px minmax(0, 1fr);
  gap: 11px;
  min-height: 76px;
  padding: 11px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  background: var(--cpu-surface);
}

.event-date {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: var(--event-bg, var(--cpu-surface-subtle));
  color: var(--event-color, var(--cpu-text-secondary));
}

.event-date b {
  font-size: 18px;
}

.event-date span {
  margin-top: 2px;
  font-size: 11px;
}

.event-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
}

.event-copy strong {
  color: var(--cpu-text);
  font-size: 14px;
}

.event-copy small,
.event-copy p {
  margin: 0;
  color: var(--cpu-text-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.event-item.primary {
  --event-bg: rgba(22, 135, 118, 0.11);
  --event-color: #168776;
}

.event-item.warning {
  --event-bg: rgba(217, 119, 6, 0.12);
  --event-color: #b45309;
}

.event-item.danger {
  --event-bg: rgba(220, 38, 38, 0.1);
  --event-color: #dc2626;
}

.calendar-image-frame {
  max-height: 74vh;
  overflow: auto;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  background: #eafdfb;
}

.calendar-image-frame img {
  display: block;
  width: 100%;
  min-width: 760px;
  height: auto;
}

@media (max-width: 980px) {
  .term-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .calendar-layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 620px) {
  .calendar-overview {
    flex-direction: column;
    padding: 15px;
  }

  .overview-status {
    min-width: 0;
  }

  .term-grid {
    grid-template-columns: 1fr;
  }

  .event-panel,
  .image-panel {
    padding: 14px;
  }

  .panel-title {
    align-items: flex-start;
    flex-direction: column;
  }

  .event-item {
    grid-template-columns: 68px minmax(0, 1fr);
  }

  .calendar-image-frame img {
    min-width: 640px;
  }
}
</style>
