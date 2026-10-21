<template>
  <!-- 日视图最上面：这一天自己的日程，每一种课表风格都放在课程上方。 -->
  <section v-if="entries.length" class="agenda-day-strip" aria-label="日程">
    <header>
      <span>日程</span>
      <span>{{ entries.length }} 项</span>
    </header>
    <div v-for="entry in entries" :key="entry.item.id" class="agenda-day-row" :class="{ done: entry.done }">
      <span class="agenda-day-time">{{ entry.item.start ? (entry.item.end ? `${entry.item.start}–${entry.item.end}` : entry.item.start) : "全天" }}</span>
      <button
        type="button"
        class="agenda-day-check"
        :class="{ on: entry.done }"
        :aria-label="entry.done ? '标为未完成' : '标为完成'"
        @click.stop="emit('toggle', entry.item, entry.date, !entry.done)"
      ><span v-if="entry.done">✓</span></button>
      <button type="button" class="agenda-day-title" @click.stop="emit('open', entry.item, entry.date)">
        <b>{{ entry.item.title }}</b>
        <small v-if="entry.item.location">{{ entry.item.location }}</small>
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { AgendaItem, AgendaOccurrence } from "@/utils/agenda";

defineProps<{ entries: AgendaOccurrence[] }>();

const emit = defineEmits<{
  (event: "open", item: AgendaItem, date: string): void;
  (event: "toggle", item: AgendaItem, date: string, done: boolean): void;
}>();
</script>

<style scoped lang="scss">
.agenda-day-strip {
  margin: 0 0 10px;
  padding: 4px 0;
  border-radius: 14px;
  background: var(--schedule-surface-bg, var(--cpu-card));
  border: 1px solid var(--schedule-border, var(--cpu-border-soft));
}
.agenda-day-strip header {
  display: flex;
  justify-content: space-between;
  padding: 6px 12px 2px;
  color: var(--schedule-text-muted, var(--cpu-text-muted));
  font-size: 11px;
  font-weight: 600;
}
.agenda-day-row {
  display: grid;
  grid-template-columns: 84px 28px minmax(0, 1fr);
  align-items: center;
  min-height: 38px;
  padding: 0 12px;
}
.agenda-day-row.done {
  opacity: 0.55;
}
.agenda-day-row.done b {
  text-decoration: line-through;
}
.agenda-day-time {
  color: var(--schedule-accent-strong, var(--cpu-primary-dark));
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.agenda-day-check {
  width: 16px;
  height: 16px;
  padding: 0;
  border: 1.5px solid var(--schedule-text-muted, var(--cpu-text-muted));
  border-radius: 50%;
  background: transparent;
  color: #fff;
  font-size: 10px;
  line-height: 1;
  cursor: pointer;
}
.agenda-day-check.on {
  border-color: var(--schedule-accent, var(--cpu-primary));
  background: var(--schedule-accent, var(--cpu-primary));
}
.agenda-day-title {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 8px 0;
  border: 0;
  background: transparent;
  text-align: left;
  font: inherit;
  cursor: pointer;
}
.agenda-day-title b {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--schedule-text, var(--cpu-text));
  font-size: 14px;
  font-weight: 500;
}
.agenda-day-title small {
  flex-shrink: 0;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--schedule-text-muted, var(--cpu-text-muted));
  font-size: 12px;
}
</style>
