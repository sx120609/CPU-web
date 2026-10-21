<template>
  <div class="pk-page agenda-page">
    <header class="pk-head">
      <div class="pk-title">
        <span class="pk-tile" aria-hidden="true"><el-icon><Calendar /></el-icon></span>
        <div class="pk-title-copy">
          <h1>日程</h1>
          <p>课表以外自己安排的事。网页、手机 App 和药大拾间 NEXT 用的是同一份，在哪里改都会同步。</p>
        </div>
      </div>
    </header>

    <section v-if="!auth.isLoggedIn" class="agenda-panel agenda-signed-out">
      <p>登录后就能记日程，并在课表里看到它们。</p>
      <el-button type="primary" @click="router.push({ path: '/login', query: { redirect: route.fullPath } })">登录</el-button>
    </section>

    <template v-else>
      <form class="agenda-quick" @submit.prevent="quickAdd">
        <input
          v-model="quickText"
          maxlength="120"
          placeholder="一句话记下，例如「明天下午3点 实验报告」「每周三晚上7点 羽毛球 @体育馆」"
          aria-label="一句话记下日程"
        />
        <button type="submit" :disabled="!quickText.trim()">添加</button>
      </form>
      <p v-if="quickPreview" class="agenda-quick-hint">{{ quickPreview }}</p>

      <section class="agenda-panel">
        <div class="agenda-week-head">
          <h2>{{ monthTitle }}</h2>
          <div class="agenda-week-actions">
            <button v-if="selected !== today" type="button" class="agenda-text-button" @click="selected = today">今天</button>
            <button type="button" class="agenda-icon-button" aria-label="新建日程" @click="openNew(selected)"><el-icon><Plus /></el-icon></button>
          </div>
        </div>
        <div class="agenda-week">
          <button type="button" class="agenda-week-step" aria-label="上一周" @click="shiftWeek(-1)"><el-icon><ArrowLeft /></el-icon></button>
          <button
            v-for="day in weekDays"
            :key="day.date"
            type="button"
            class="agenda-day-cell"
            :class="{ selected: day.date === selected, today: day.date === today }"
            :aria-label="`${day.label} ${day.date}${day.busy ? '，有安排' : ''}`"
            :aria-pressed="day.date === selected"
            @click="selected = day.date"
          >
            <small>{{ day.label }}</small>
            <b>{{ day.number }}</b>
            <i :class="{ on: day.busy }" aria-hidden="true" />
          </button>
          <button type="button" class="agenda-week-step" aria-label="下一周" @click="shiftWeek(1)"><el-icon><ArrowRight /></el-icon></button>
        </div>

        <div class="agenda-day-title">{{ selectedTitle }}</div>
        <ul v-if="dayEntries.length" class="agenda-list">
          <li v-for="entry in dayEntries" :key="entry.item.id" :class="{ done: entry.done }">
            <span class="agenda-time">{{ timeText(entry.item) }}</span>
            <button
              type="button"
              class="agenda-check"
              :class="{ on: entry.done }"
              :aria-label="entry.done ? '标为未完成' : '标为完成'"
              @click="agenda.setDone(entry.item.id, entry.date, !entry.done)"
            ><el-icon v-if="entry.done"><Check /></el-icon></button>
            <button type="button" class="agenda-entry" @click="openItem(entry.item)">
              <b>{{ entry.item.title }}</b>
              <span v-if="entryMeta(entry.item)">{{ entryMeta(entry.item) }}</span>
            </button>
          </li>
        </ul>
        <p v-else class="agenda-empty">这一天没有安排</p>
        <button type="button" class="agenda-add-row" @click="openNew(selected)"><el-icon><Plus /></el-icon>添加到{{ shortDay(selected) }}</button>
      </section>

      <section class="agenda-panel">
        <div class="agenda-section-title">待办</div>
        <ul v-if="openTodos.length" class="agenda-list">
          <li v-for="item in openTodos" :key="item.id">
            <span class="agenda-time" :class="{ late: Boolean(item.date) }">{{ item.date ? shortDay(item.date) : "" }}</span>
            <button type="button" class="agenda-check" aria-label="标为完成" @click="agenda.setDone(item.id, item.date || today, true)" />
            <button type="button" class="agenda-entry" @click="openItem(item)">
              <b>{{ item.title }}</b>
              <span v-if="item.date">已过日期，还没完成</span>
            </button>
          </li>
        </ul>
        <p v-else class="agenda-empty">没有没日期的待办</p>
        <button type="button" class="agenda-add-row" @click="openNew('')"><el-icon><Plus /></el-icon>添加不设日期的待办</button>
      </section>

      <section class="agenda-panel">
        <label class="agenda-switch-row">
          <span>
            <b>微信和 QQ 也提醒</b>
            <small>设了提醒的日程到点时，服务器发一条站内通知，并转到你绑定的微信和 QQ。手机 App 更新后也会在通知栏提醒。</small>
          </span>
          <el-switch :model-value="agenda.relay" @change="(on: string | number | boolean) => agenda.setRelay(Boolean(on))" />
        </label>
        <router-link class="agenda-link" to="/messages?tab=settings">绑定微信、QQ</router-link>
      </section>

      <p class="agenda-foot">
        <span v-if="agenda.error" class="warn">{{ agenda.error }}</span>
        <span v-else-if="agenda.syncing">正在同步…</span>
        <span v-else-if="agenda.dirtyCount">有 {{ agenda.dirtyCount }} 处改动还没同步</span>
        <span v-else-if="agenda.syncedAt">已同步</span>
      </p>
    </template>

    <AgendaEditor :open="editorOpen" :draft="editorDraft" @close="editorOpen = false" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { ArrowLeft, ArrowRight, Calendar, Check, Plus } from "@element-plus/icons-vue";
import AgendaEditor, { type AgendaEditorDraft } from "@/views/agenda/AgendaEditor.vue";
import { useAuthStore } from "@/stores/auth";
import { useAgendaStore } from "@/stores/agenda";
import {
  agendaAddDays,
  agendaChinaClock,
  agendaOn,
  agendaOpen,
  agendaRepeatLabel,
  agendaWeekday,
  parseAgendaText,
  type AgendaItem,
} from "@/utils/agenda";

const auth = useAuthStore();
const agenda = useAgendaStore();
const route = useRoute();
const router = useRouter();

const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const now = ref(Date.now());
const today = computed(() => agendaChinaClock(now.value).date);
const selected = ref(agendaChinaClock(Date.now()).date);
const quickText = ref("");
const editorOpen = ref(false);
const editorDraft = ref<AgendaEditorDraft | null>(null);
let clock = 0;

const monday = computed(() => agendaAddDays(selected.value, 1 - agendaWeekday(selected.value)));
const weekDays = computed(() => Array.from({ length: 7 }, (_, index) => {
  const date = agendaAddDays(monday.value, index);
  return {
    date,
    label: WEEKDAYS[index],
    number: Number(date.slice(8)),
    busy: agendaOn(agenda.items, date).some((entry) => !entry.done),
  };
}));
const monthTitle = computed(() => {
  const [year, month] = selected.value.split("-").map(Number);
  return year === Number(today.value.slice(0, 4)) ? `${month}月` : `${year}年${month}月`;
});
const dayEntries = computed(() => agendaOn(agenda.items, selected.value));
const openTodos = computed(() => agendaOpen(agenda.items, today.value));
const selectedTitle = computed(() => `${shortDay(selected.value)} · ${WEEKDAYS[agendaWeekday(selected.value) - 1]}`);

const quickPreview = computed(() => {
  const text = quickText.value.trim();
  if (!text) return "";
  const draft = parseAgendaText(text, now.value);
  const when = [
    draft.date ? shortDay(draft.date) : "不设日期",
    draft.start ? (draft.end ? `${draft.start}–${draft.end}` : draft.start) : "",
    draft.repeat !== "none" ? agendaRepeatLabel(draft.repeat) : "",
    draft.remind >= 0 ? "提醒" : "",
    draft.location ? `@${draft.location}` : "",
  ].filter(Boolean).join(" · ");
  return `会记作「${draft.title}」：${when}`;
});

function shortDay(date: string) {
  if (!date) return "";
  if (date === today.value) return "今天";
  if (date === agendaAddDays(today.value, 1)) return "明天";
  if (date === agendaAddDays(today.value, -1)) return "昨天";
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`;
}

function timeText(item: AgendaItem) {
  if (!item.start) return "全天";
  return item.end ? `${item.start}–${item.end}` : item.start;
}

function entryMeta(item: AgendaItem) {
  return [item.location, item.repeat !== "none" ? agendaRepeatLabel(item.repeat) : ""].filter(Boolean).join(" · ");
}

function shiftWeek(weeks: number) {
  selected.value = agendaAddDays(selected.value, weeks * 7);
}

function openNew(date: string, start = "") {
  editorDraft.value = { date, start };
  editorOpen.value = true;
}

function openItem(item: AgendaItem) {
  editorDraft.value = { ...item };
  editorOpen.value = true;
}

function quickAdd() {
  const text = quickText.value.trim();
  if (!text) return;
  const draft = parseAgendaText(text, Date.now());
  const saved = agenda.save({ ...draft, title: draft.title });
  if (!saved) {
    ElMessage.warning(agenda.error || "没能记下来，换个说法试试");
    return;
  }
  quickText.value = "";
  if (saved.date) selected.value = saved.date;
  ElMessage.success(saved.date ? `已添加到${shortDay(saved.date)}` : "已添加到待办");
}

/** 原生 App 从课表打开的：`?item=<id>` 打开那一条，`?new=1&date=&start=` 新建。 */
function applyRouteQuery() {
  const { item, date, start } = route.query;
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(date)) selected.value = date;
  if (typeof item === "string" && item) {
    const found = agenda.find(item);
    if (found) {
      openItem(found);
      void router.replace({ query: { ...route.query, item: undefined } });
    }
    return;
  }
  if (route.query.new) {
    openNew(typeof date === "string" ? date : selected.value, typeof start === "string" && /^\d{2}:\d{2}$/u.test(start) ? start : "");
    void router.replace({ query: { ...route.query, new: undefined, start: undefined } });
  }
}

function syncNow() {
  if (!agenda.attach()) return;
  void agenda.sync().then(applyRouteQuery);
}

function onVisibility() {
  if (document.visibilityState === "visible") {
    now.value = Date.now();
    syncNow();
  }
}

watch(() => auth.user?.id, () => syncNow());
watch(() => route.query, () => applyRouteQuery());

onMounted(() => {
  agenda.attach();
  applyRouteQuery();
  syncNow();
  document.addEventListener("visibilitychange", onVisibility);
  clock = window.setInterval(() => { now.value = Date.now(); }, 60_000);
});

onBeforeUnmount(() => {
  document.removeEventListener("visibilitychange", onVisibility);
  clearInterval(clock);
});
</script>

<style scoped lang="scss">
.agenda-page {
  max-width: 720px;
  margin: 0 auto;
}
.agenda-panel {
  margin-top: 12px;
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-card);
  border: 1px solid var(--cpu-border-soft);
  padding: 12px 14px;
}
.agenda-signed-out {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-m);
}
.agenda-signed-out p {
  margin: 0;
}
.agenda-quick {
  margin-top: 12px;
  display: flex;
  gap: 8px;
}
.agenda-quick input {
  flex: 1;
  min-width: 0;
  height: 40px;
  padding: 0 12px;
  border: 1px solid var(--cpu-border);
  border-radius: var(--cpu-radius-m);
  background: var(--cpu-card);
  color: var(--cpu-text);
  font: inherit;
  font-size: var(--cpu-fs-m);
}
.agenda-quick input:focus {
  outline: 0;
  border-color: var(--cpu-primary);
}
.agenda-quick button {
  height: 40px;
  padding: 0 16px;
  border: 0;
  border-radius: var(--cpu-radius-m);
  background: var(--cpu-primary);
  color: var(--cpu-on-primary);
  font: inherit;
  font-size: var(--cpu-fs-m);
  font-weight: 560;
  cursor: pointer;
}
.agenda-quick button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.agenda-quick-hint {
  margin: 6px 2px 0;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-xs);
}
.agenda-week-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.agenda-week-head h2 {
  margin: 0;
  font-size: var(--cpu-fs-xl);
  color: var(--cpu-text);
}
.agenda-week-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.agenda-text-button,
.agenda-icon-button,
.agenda-week-step {
  border: 0;
  background: transparent;
  color: var(--cpu-primary);
  font: inherit;
  font-size: var(--cpu-fs-s);
  font-weight: 560;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.agenda-icon-button {
  width: 32px;
  height: 32px;
  font-size: var(--cpu-fs-l);
}
.agenda-week {
  display: grid;
  grid-template-columns: 24px repeat(7, minmax(0, 1fr)) 24px;
  align-items: center;
  gap: 2px;
  margin: 10px 0 6px;
}
.agenda-week-step {
  color: var(--cpu-text-muted);
  height: 44px;
}
.agenda-day-cell {
  height: 56px;
  border: 0;
  border-radius: var(--cpu-radius-m);
  background: transparent;
  color: var(--cpu-text);
  display: grid;
  justify-items: center;
  align-content: center;
  gap: 2px;
  cursor: pointer;
  font: inherit;
}
.agenda-day-cell small {
  font-size: var(--cpu-fs-xs);
  color: var(--cpu-text-muted);
}
.agenda-day-cell b {
  font-size: var(--cpu-fs-l);
  font-weight: 600;
}
.agenda-day-cell i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: transparent;
}
.agenda-day-cell i.on {
  background: var(--cpu-primary);
}
.agenda-day-cell.today b {
  color: var(--cpu-primary);
}
.agenda-day-cell.selected {
  background: var(--cpu-primary);
}
.agenda-day-cell.selected small,
.agenda-day-cell.selected b {
  color: var(--cpu-on-primary);
}
.agenda-day-cell.selected i.on {
  background: var(--cpu-on-primary);
}
.agenda-day-title,
.agenda-section-title {
  padding: 10px 0 4px;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-s);
  font-weight: 600;
}
.agenda-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.agenda-list li {
  display: grid;
  grid-template-columns: 100px 32px minmax(0, 1fr);
  align-items: center;
  min-height: 48px;
  border-bottom: 1px solid var(--cpu-border-soft);
}
.agenda-list li.done {
  opacity: 0.55;
}
.agenda-list li.done .agenda-entry b {
  text-decoration: line-through;
}
.agenda-time {
  font-size: var(--cpu-fs-s);
  font-weight: 600;
  color: var(--cpu-text);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.agenda-time.late {
  color: var(--cpu-danger);
}
.agenda-check {
  width: 18px;
  height: 18px;
  padding: 0;
  border: 1.5px solid var(--cpu-text-muted);
  border-radius: 50%;
  background: transparent;
  color: var(--cpu-on-primary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  cursor: pointer;
}
.agenda-check.on {
  border-color: var(--cpu-primary);
  background: var(--cpu-primary);
}
.agenda-entry {
  min-width: 0;
  border: 0;
  background: transparent;
  padding: 8px 0;
  text-align: left;
  font: inherit;
  cursor: pointer;
  display: grid;
  gap: 2px;
}
.agenda-entry b {
  font-size: var(--cpu-fs-m);
  font-weight: 500;
  color: var(--cpu-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agenda-entry span {
  font-size: var(--cpu-fs-xs);
  color: var(--cpu-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agenda-empty {
  margin: 0;
  padding: 12px 0;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-s);
}
.agenda-add-row {
  width: 100%;
  min-height: 44px;
  border: 0;
  background: transparent;
  color: var(--cpu-primary);
  font: inherit;
  font-size: var(--cpu-fs-m);
  font-weight: 560;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  padding: 0;
}
.agenda-switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.agenda-switch-row > span {
  display: grid;
  gap: 4px;
}
.agenda-switch-row b {
  font-size: var(--cpu-fs-m);
  color: var(--cpu-text);
  font-weight: 560;
}
.agenda-switch-row small {
  font-size: var(--cpu-fs-xs);
  color: var(--cpu-text-muted);
  line-height: 1.5;
}
.agenda-link {
  display: inline-block;
  margin-top: 8px;
  color: var(--cpu-primary);
  font-size: var(--cpu-fs-s);
}
.agenda-foot {
  margin: 10px 2px 24px;
  min-height: 18px;
  color: var(--cpu-text-muted);
  font-size: var(--cpu-fs-xs);
}
.agenda-foot .warn {
  color: var(--cpu-danger);
}
@media (max-width: 420px) {
  .agenda-list li {
    grid-template-columns: 92px 30px minmax(0, 1fr);
  }
}
</style>
