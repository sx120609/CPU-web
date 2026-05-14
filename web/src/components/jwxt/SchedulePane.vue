<template>
  <div class="schedule-pane">
    <div class="ctrl-bar">
      <div class="ctrl-left">
        <span class="lbl">学期</span>
        <el-select v-model="semester" size="small" style="width:160px" @change="reload">
          <el-option v-for="s in semesters" :key="s.value" :value="s.value" :label="s.label" />
        </el-select>
        <span class="lbl">周次</span>
        <el-select v-model="week" size="small" clearable style="width:140px" placeholder="全部" @change="reload">
          <el-option v-for="w in weeks" :key="w.value" :value="w.value" :label="w.label" />
        </el-select>
        <el-button v-if="cal?.currentWeek" size="small" text type="primary" @click="jumpThisWeek">📍 跳到本周</el-button>
      </div>
      <div class="ctrl-right" v-if="parsed">
        <span v-if="cal?.currentWeek" class="weekinfo">
          本学期 <b>第 {{ cal.currentWeek }} 周</b>
          <span v-if="cal.semesterStart && cal.semesterEnd" class="cpu-muted">
            · {{ shortDate(cal.semesterStart) }} ~ {{ shortDate(cal.semesterEnd) }}
          </span>
        </span>
        <span class="stat">{{ totalCourses }} 节课</span>
      </div>
    </div>

    <div class="grid" v-loading="loading">
      <div class="corner"></div>
      <div v-for="d in days" :key="'h-' + d.idx" class="day-head">
        <div>{{ d.label }}</div>
        <div v-if="weekDates[d.idx - 1]" class="date-sub">{{ weekDates[d.idx - 1] }}</div>
      </div>

      <template v-for="bs in bigSlots" :key="'r-' + bs">
        <div class="slot-label">
          <div class="bs-no">第 {{ bs }} 大节</div>
          <div class="bs-sub">{{ bigSlotTime(bs) }}</div>
        </div>
        <div
          v-for="d in days"
          :key="`c-${bs}-${d.idx}`"
          class="cell"
        >
          <div
            v-for="(c, i) in getCourses(d.idx, bs)"
            :key="i"
            class="course"
            :style="{ background: colorFor(c.name) }"
            :title="`${c.name}\n${c.teacher ?? ''}\n${c.weeks} ${c.slotNote ?? ''}\n@ ${c.location ?? ''}`"
          >
            <div class="cn">{{ c.name }}</div>
            <div v-if="c.teacher" class="meta">👨‍🏫 {{ c.teacher }}</div>
            <div v-if="c.location" class="meta">📍 {{ c.location }}</div>
            <div class="meta tiny">{{ c.weeks }}</div>
            <div v-if="c.slotNote" class="meta tiny">{{ c.slotNote }}</div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import { jwxtApi } from "@/api/jwxt";

interface ScheduleCourse {
  name: string;
  teacher?: string;
  weeks: string;
  weekList: number[];
  location?: string;
  slotNote?: string;
}
interface ScheduleCell { day: number; bigSlot: number; courses: ScheduleCourse[] }
interface ScheduleResult {
  title: string;
  semesters: { value: string; label: string; current: boolean }[];
  weeks: { value: string; label: string; current: boolean }[];
  currentSemester: string;
  currentWeek: string;
  cells: ScheduleCell[];
}
interface CalendarWeek { week: number; days: string[]; monday: string; sunday: string }
interface CalendarResult { currentWeek: number; semesterStart: string; semesterEnd: string; weeks: CalendarWeek[] }

const props = defineProps<{ data: any; loading?: boolean }>();
const loading = ref(props.loading ?? false);
const parsed = ref<ScheduleResult | null>(props.data?.parsed ?? null);
const semester = ref<string>("");
const week = ref<string>("");
const cal = ref<CalendarResult | null>(null);

watch(() => props.data, (v) => {
  parsed.value = v?.parsed ?? null;
  if (parsed.value && !semester.value) {
    semester.value = parsed.value.currentSemester;
  }
}, { immediate: true });

onMounted(async () => {
  try {
    const r: any = await jwxtApi.calendar();
    cal.value = r.parsed;
    if (cal.value?.currentWeek && !week.value) {
      week.value = String(cal.value.currentWeek);
      await reload();
    }
  } catch { /* ignore */ }
});

const semesters = computed(() => parsed.value?.semesters ?? []);
const weeks = computed(() => parsed.value?.weeks ?? []);
const days = [
  { idx: 1, label: "周一" }, { idx: 2, label: "周二" }, { idx: 3, label: "周三" },
  { idx: 4, label: "周四" }, { idx: 5, label: "周五" }, { idx: 6, label: "周六" }, { idx: 7, label: "周日" },
];
const bigSlots = [1, 2, 3, 4, 5];

const cellsByPos = computed(() => {
  const map = new Map<string, ScheduleCell>();
  if (!parsed.value) return map;
  for (const c of parsed.value.cells) map.set(`${c.day}-${c.bigSlot}`, c);
  return map;
});

const totalCourses = computed(() => parsed.value?.cells.reduce((s, c) => s + c.courses.length, 0) ?? 0);

const weekDates = computed<string[]>(() => {
  if (!week.value || !cal.value) return Array(7).fill("");
  const w = cal.value.weeks.find((x) => x.week === Number(week.value));
  if (!w) return Array(7).fill("");
  // w.days: [周日, 周一, ..., 周六] → [周一 ~ 周六, 周日]
  const arr = [...w.days];
  const mondayToSat = arr.slice(1);
  const sunday = arr[0];
  return [...mondayToSat, sunday].map(shortDate);
});

function getCourses(day: number, bs: number): ScheduleCourse[] {
  return cellsByPos.value.get(`${day}-${bs}`)?.courses ?? [];
}

function bigSlotTime(bs: number): string {
  return ["08:00–09:35", "10:00–11:35", "13:30–15:05", "15:25–17:00", "18:30–20:05"][bs - 1] ?? "";
}

function shortDate(d: string): string {
  if (!d) return "";
  const m = d.match(/-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}/${m[2]}` : d;
}

const palette = [
  "linear-gradient(135deg,#dbeafe,#bfdbfe)",
  "linear-gradient(135deg,#fce7f3,#fbcfe8)",
  "linear-gradient(135deg,#dcfce7,#bbf7d0)",
  "linear-gradient(135deg,#fef3c7,#fde68a)",
  "linear-gradient(135deg,#ede9fe,#ddd6fe)",
  "linear-gradient(135deg,#cffafe,#a5f3fc)",
  "linear-gradient(135deg,#fee2e2,#fecaca)",
  "linear-gradient(135deg,#d1fae5,#a7f3d0)",
];
function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return palette[h % palette.length];
}

async function reload() {
  loading.value = true;
  try {
    const tk = sessionStorage.getItem("cpu-jwxt-token") ?? "";
    const u = new URL("/api/jwxt/schedule", window.location.origin);
    if (semester.value) u.searchParams.set("semester", semester.value);
    if (week.value) u.searchParams.set("week", week.value);
    const resp = await fetch(u, { headers: { "X-Jwxt-Token": tk } });
    const body = await resp.json();
    if (body.code === 0) parsed.value = body.data.parsed;
  } finally { loading.value = false; }
}

async function jumpThisWeek() {
  if (!cal.value?.currentWeek) return;
  week.value = String(cal.value.currentWeek);
  await reload();
}
</script>

<style scoped lang="scss">
.schedule-pane { display: flex; flex-direction: column; gap: 12px; }

.ctrl-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.ctrl-left { display: flex; gap: 8px; align-items: center; }
.lbl { font-size: 12px; color: #6b7280; }
.stat { font-size: 12px; color: var(--cpu-primary); font-weight: 500; }
.weekinfo {
  font-size: 13px;
  color: #4b5563;
  margin-right: 12px;
}
.weekinfo b { color: var(--cpu-primary); font-size: 15px; margin: 0 4px; }
.cpu-muted { color: #9ca3af; font-size: 12px; }

.day-head .date-sub {
  font-size: 11px;
  color: #9ca3af;
  font-weight: normal;
  margin-top: 2px;
}

.grid {
  display: grid;
  grid-template-columns: 90px repeat(7, minmax(120px, 1fr));
  border: 1px solid #eef0f4;
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
}

.corner, .day-head {
  background: #f8fafc;
  border-bottom: 1px solid #eef0f4;
  padding: 10px 4px;
  text-align: center;
  font-size: 13px;
  font-weight: 500;
  color: #374151;
}
.day-head + .day-head, .corner + .day-head { border-left: 1px solid #eef0f4; }

.slot-label {
  background: #f9fafb;
  border-bottom: 1px solid #eef0f4;
  padding: 12px 8px;
  font-size: 11px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.bs-no { font-weight: 600; color: #374151; }
.bs-sub { color: #9ca3af; margin-top: 2px; font-size: 10px; }

.cell {
  border-bottom: 1px solid #eef0f4;
  border-left: 1px solid #eef0f4;
  padding: 4px;
  min-height: 60px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.course {
  background: #dbeafe;
  border-radius: 6px;
  padding: 6px 8px;
  cursor: pointer;
  flex: 1;
  min-height: 50px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  transition: transform 0.15s, box-shadow 0.15s;
}
.course:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.08);
  z-index: 1;
  position: relative;
}

.cn {
  font-size: 12px;
  font-weight: 600;
  color: #1f2937;
  line-height: 1.3;
  word-break: break-word;
}
.meta {
  font-size: 11px;
  color: #4b5563;
  line-height: 1.3;
  word-break: break-word;
}
.meta.tiny { font-size: 10px; color: #6b7280; }

/* 最后一行不要 border-bottom */
.grid > .slot-label:last-of-type,
.grid > .slot-label:last-of-type ~ .cell {
  border-bottom: none;
}

@media (max-width: 760px) {
  .ctrl-bar {
    align-items: stretch;
    flex-direction: column;
  }

  .ctrl-left {
    align-items: stretch;
    flex-wrap: wrap;
  }

  .ctrl-left .lbl {
    align-self: center;
  }

  .ctrl-left :deep(.el-select) {
    flex: 1 1 140px;
    width: auto !important;
  }

  .ctrl-right {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .weekinfo {
    margin-right: 0;
    line-height: 1.5;
  }

  .grid {
    grid-template-columns: 76px repeat(7, minmax(96px, 1fr));
    overflow-x: auto;
    overflow-y: hidden;
    -webkit-overflow-scrolling: touch;
  }

  .corner,
  .day-head {
    padding: 9px 3px;
    font-size: 12px;
  }

  .slot-label {
    padding: 10px 6px;
  }

  .course {
    padding: 6px;
  }

  .cn {
    font-size: 11px;
  }
}
</style>
