<template>
  <div class="schedule-pane">
    <div class="ctrl-bar">
      <div class="ctrl-left">
        <label class="filter-field">
          <span class="lbl">学期</span>
          <el-select v-model="semester" size="small" @change="reload">
            <el-option v-for="s in semesters" :key="s.value" :value="s.value" :label="s.label" />
          </el-select>
        </label>
        <label class="filter-field compact">
          <span class="lbl">周次</span>
          <el-select v-model="week" size="small" clearable placeholder="全部" @change="reload">
            <el-option v-for="w in weeks" :key="w.value" :value="w.value" :label="w.label" />
          </el-select>
        </label>
        <el-button v-if="cal?.currentWeek" size="small" plain type="primary" class="this-week-btn" @click="jumpThisWeek">跳到本周</el-button>
      </div>
      <div class="ctrl-right" v-if="parsed">
        <span v-if="cal?.currentWeek" class="weekinfo">
          本学期 <b>第 {{ cal.currentWeek }} 周</b>
          <span v-if="cal.semesterStart && cal.semesterEnd" class="cpu-muted">
            · {{ shortDate(cal.semesterStart) }} ~ {{ shortDate(cal.semesterEnd) }}
          </span>
        </span>
        <span class="stat">{{ totalCourses }} 节课</span>
        <el-radio-group v-model="viewMode" size="small" class="view-toggle">
          <el-radio-button value="auto">自动</el-radio-button>
          <el-radio-button value="grid">网格</el-radio-button>
          <el-radio-button value="list">列表</el-radio-button>
        </el-radio-group>
      </div>
    </div>

    <!-- ===== 列表视图（移动端默认）===== -->
    <div v-if="effectiveView === 'list'" class="list-view" v-loading="loading">
      <!-- 周内日 chip 选择 -->
      <div class="day-chips">
        <button
          v-for="d in days"
          :key="d.idx"
          type="button"
          class="day-chip"
          :class="{ active: selectedDay === d.idx, today: weekDates[d.idx - 1] && isTodayLabel(weekDates[d.idx - 1]) }"
          @click="selectedDay = d.idx"
        >
          <div class="d-name">{{ d.label }}</div>
          <div class="d-date">{{ weekDates[d.idx - 1] || '—' }}</div>
          <div v-if="dayCourseCount(d.idx)" class="d-count">{{ dayCourseCount(d.idx) }} 节</div>
        </button>
      </div>

      <!-- 当日课程卡片 -->
      <div class="day-courses">
        <template v-for="bs in bigSlots" :key="'l-' + bs">
          <div
            v-for="(c, i) in getCourses(selectedDay, bs)"
            :key="`l-${bs}-${i}`"
            class="list-course"
            :style="{ borderLeftColor: accentFor(c.name) }"
          >
            <div class="lc-time">
              <div class="lc-bs">第 {{ bs }} 大节</div>
              <div class="lc-clock">{{ bigSlotTime(bs) }}</div>
            </div>
            <div class="lc-body">
              <div class="lc-name">{{ c.name }}</div>
              <div class="lc-meta">
                <span v-if="c.teacher">👨‍🏫 {{ c.teacher }}</span>
                <span v-if="c.location">📍 {{ c.location }}</span>
              </div>
              <div class="lc-week">
                <span>{{ c.weeks }}</span>
                <span v-if="c.slotNote">· {{ c.slotNote }}</span>
              </div>
            </div>
          </div>
        </template>
        <el-empty v-if="!loading && dayCourseCount(selectedDay) === 0" :image-size="80" description="这一天没课，休息一下" />
      </div>
    </div>

    <!-- ===== 网格视图（桌面默认）===== -->
    <div v-else class="grid" v-loading="loading">
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
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
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

// 视图模式：auto 跟随屏幕宽度，grid / list 强制
const viewMode = ref<"auto" | "grid" | "list">("auto");
const screenIsNarrow = ref(false);
function updateNarrow() {
  screenIsNarrow.value = window.matchMedia("(max-width: 760px)").matches;
}
const effectiveView = computed<"grid" | "list">(() => {
  if (viewMode.value === "grid") return "grid";
  if (viewMode.value === "list") return "list";
  return screenIsNarrow.value ? "list" : "grid";
});

// 选中的日（1-7，1=周一）
const selectedDay = ref(1);
function defaultSelectedDay(): number {
  const jsDay = new Date().getDay(); // 0=Sun
  return jsDay === 0 ? 7 : jsDay;
}

watch(() => props.data, (v) => {
  parsed.value = v?.parsed ?? null;
  if (parsed.value && !semester.value) {
    semester.value = parsed.value.currentSemester;
  }
}, { immediate: true });

onMounted(async () => {
  updateNarrow();
  window.addEventListener("resize", updateNarrow);
  selectedDay.value = defaultSelectedDay();
  try {
    const r: any = await jwxtApi.calendar();
    cal.value = r.parsed;
    if (cal.value?.currentWeek && !week.value) {
      week.value = String(cal.value.currentWeek);
      await reload();
    }
  } catch { /* ignore */ }
});
onBeforeUnmount(() => window.removeEventListener("resize", updateNarrow));

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

function dayCourseCount(day: number): number {
  let n = 0;
  for (const bs of bigSlots) n += getCourses(day, bs).length;
  return n;
}

function bigSlotTime(bs: number): string {
  return ["08:00–09:35", "10:00–11:35", "13:30–15:05", "15:25–17:00", "18:30–20:05"][bs - 1] ?? "";
}

function shortDate(d: string): string {
  if (!d) return "";
  const m = d.match(/-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}/${m[2]}` : d;
}

function isTodayLabel(mmdd: string): boolean {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return mmdd === `${m}/${d}`;
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
const accentPalette = ["#3b82f6", "#ec4899", "#10b981", "#f59e0b", "#8b5cf6", "#06b6d4", "#ef4444", "#14b8a6"];

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return h;
}
function colorFor(name: string): string { return palette[hashName(name) % palette.length]; }
function accentFor(name: string): string { return accentPalette[hashName(name) % accentPalette.length]; }

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
  selectedDay.value = defaultSelectedDay();
}
</script>

<style scoped lang="scss">
.schedule-pane { display: flex; flex-direction: column; gap: 12px; }

.ctrl-bar {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 10px;
}
.ctrl-left {
  display: grid;
  grid-template-columns: minmax(150px, 180px) minmax(120px, 150px) auto;
  gap: 10px;
  align-items: end;
  min-width: 0;
}
.filter-field {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.filter-field :deep(.el-select) {
  width: 100%;
}
.this-week-btn {
  min-width: 92px;
}
.lbl { font-size: 12px; color: #6b7280; }
.stat { font-size: 12px; color: var(--cpu-primary); font-weight: 500; }
.weekinfo {
  font-size: 13px;
  color: #4b5563;
  margin-right: 12px;
}
.weekinfo b { color: var(--cpu-primary); font-size: 15px; margin: 0 4px; }
.cpu-muted { color: #9ca3af; font-size: 12px; }
.view-toggle { margin-left: auto; }

.day-head .date-sub {
  font-size: 11px;
  color: #9ca3af;
  font-weight: normal;
  margin-top: 2px;
}

/* ===== 列表视图 ===== */
.list-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.day-chips {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
  padding: 6px;
  background: #f8fafc;
  border-radius: 10px;
}
.day-chip {
  border: 1px solid transparent;
  background: transparent;
  border-radius: 8px;
  padding: 6px 2px;
  text-align: center;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  font: inherit;
  min-height: 56px;
  -webkit-tap-highlight-color: rgba(22, 135, 118, 0.18);
}
.day-chip:hover { background: #fff; }
.day-chip.active {
  background: var(--cpu-primary);
  color: #fff;
}
.day-chip.active .d-date,
.day-chip.active .d-count { color: rgba(255, 255, 255, 0.85); }
.day-chip.today:not(.active) {
  border-color: var(--cpu-primary);
  color: var(--cpu-primary);
}
.d-name { font-size: 12px; font-weight: 600; }
.d-date { font-size: 11px; color: #6b7280; }
.d-count { font-size: 10px; color: #9ca3af; }

.day-courses {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.list-course {
  display: flex;
  gap: 12px;
  padding: 12px 14px;
  background: #fff;
  border: 1px solid #eef0f4;
  border-left: 4px solid #3b82f6;
  border-radius: 10px;
}
.lc-time {
  flex-shrink: 0;
  min-width: 78px;
  border-right: 1px dashed #f1f5f9;
  padding-right: 12px;
}
.lc-bs { font-size: 12px; font-weight: 600; color: #374151; }
.lc-clock { font-size: 11px; color: #9ca3af; margin-top: 2px; }
.lc-body { flex: 1; min-width: 0; }
.lc-name { font-size: 15px; font-weight: 600; color: #1f2937; }
.lc-meta {
  font-size: 12px;
  color: #4b5563;
  margin-top: 4px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.lc-week { font-size: 11px; color: #9ca3af; margin-top: 3px; }

/* ===== 网格视图 ===== */
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
    grid-template-columns: 1fr 1fr;
  }

  .ctrl-right {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
  }
  .view-toggle { margin-left: 0; }

  .weekinfo {
    margin-right: 0;
    line-height: 1.5;
  }

  .this-week-btn {
    grid-column: span 2;
    width: 100%;
  }

  /* 网格视图在 mobile 还是保留（用户选 grid 强制时也要能横滚） */
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

  /* 列表视图样式微调 */
  .day-chips {
    /* 周六周日太挤的话允许内容收紧 */
    gap: 2px;
    padding: 4px;
  }
  .d-name { font-size: 11px; }
  .d-date { font-size: 10px; }
  .d-count { display: none; } /* 移动端节省垂直空间 */

  .list-course {
    padding: 10px 12px;
  }
  .lc-time {
    min-width: 64px;
    padding-right: 10px;
  }
  .lc-name { font-size: 14px; }
}

@media (max-width: 430px) {
  .ctrl-left {
    grid-template-columns: 1fr;
  }

  .this-week-btn {
    grid-column: auto;
  }
}
</style>
