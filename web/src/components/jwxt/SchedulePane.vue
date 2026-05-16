<template>
  <div class="schedule-pane" :class="{ 'theme-color-glass': scheduleTheme === 'color-glass' }">
    <header class="top">
      <el-select
        v-if="parsed"
        v-model="semester"
        size="small"
        class="sem-select"
        @change="onSemesterChange"
      >
        <el-option v-for="s in semesters" :key="s.value" :value="s.value" :label="s.label" />
      </el-select>
      <div v-else class="top-placeholder">课表</div>

      <div class="top-actions">
        <div v-if="parsed" class="view-switch" aria-label="切换课表视图">
          <button type="button" :class="{ active: viewMode === 'day' }" @click="setViewMode('day')">日</button>
          <button type="button" :class="{ active: viewMode === 'week' }" @click="setViewMode('week')">周</button>
        </div>
        <button
          v-if="parsed"
          type="button"
          class="icon-btn"
          :class="{ active: scheduleTheme === 'color-glass' }"
          :aria-label="scheduleTheme === 'color-glass' ? '切换为简洁课表主题' : '切换为彩色课表主题'"
          :title="scheduleTheme === 'color-glass' ? '简洁主题' : '彩色主题'"
          @click="toggleScheduleTheme"
        >
          <el-icon><Brush /></el-icon>
        </button>
        <button
          v-if="parsed"
          type="button"
          class="icon-btn"
          aria-label="加入用户QQ群"
          title="加入用户QQ群"
          @click="joinUserGroup"
        >
          <el-icon><ChatDotRound /></el-icon>
        </button>
        <button
          type="button"
          class="icon-btn"
          :class="{ spinning: loading }"
          aria-label="刷新课表"
          title="刷新课表"
          @click="loadSchedule(true)"
        >
          <el-icon><Refresh /></el-icon>
        </button>
      </div>
    </header>

    <section v-if="parsed" class="week-switcher">
      <button type="button" class="week-btn" :disabled="!canChangeWeek(-1)" @click="changeWeek(-1)">
        <el-icon><ArrowLeft /></el-icon>
        上一周
      </button>
      <button type="button" class="week-title clickable" @click="weekDialogOpen = true">
        <b>第 {{ week || parsed?.currentWeek || "--" }} 周</b>
        <span v-if="currentWeekRange">{{ currentWeekRange }}</span>
      </button>
      <button type="button" class="week-btn" :disabled="!canChangeWeek(1)" @click="changeWeek(1)">
        下一周
        <el-icon><ArrowRight /></el-icon>
      </button>
    </section>

    <section v-if="parsed && viewMode === 'day'" class="week-strip">
      <button
        v-for="d in dayTabs"
        :key="d.day"
        type="button"
        class="day-pill"
        :class="{ active: activeDay === d.day, today: d.isToday }"
        @click="onDayClick(d.day)"
      >
        <span>{{ d.label }}</span>
        <b>{{ d.date || "--" }}</b>
      </button>
    </section>

    <section
      v-if="parsed"
      ref="contentRef"
      class="content"
      v-loading="loading && !parsed"
      @pointerdown="onSchedulePointerDown"
      @pointermove="onSchedulePointerMove"
      @pointerup="onSchedulePointerEnd"
      @pointercancel="onSchedulePointerCancel"
    >
      <div class="carousel-viewport">
        <div ref="carouselTrackRef" class="carousel-track" @transitionend="onCarouselTrackTransitionEnd">
          <article
            v-for="page in carouselPages"
            :key="page.key"
            class="schedule-panel"
            :class="{ active: page.delta === 0 }"
            :aria-hidden="page.delta !== 0"
          >
            <div class="summary">
              <div>
                <span>第 {{ page.weekValue || parsed?.currentWeek || "--" }} 周</span>
                <b>{{ page.title }}</b>
                <small v-if="cacheText">{{ cacheText }}</small>
              </div>
              <em>{{ page.courseCount }} 节课</em>
            </div>

            <section v-if="viewMode === 'week'" class="week-overview" aria-label="整周课表">
              <div class="week-grid-head">
                <div class="time-head">节次</div>
                <div
                  v-for="d in page.dayTabs"
                  :key="d.day"
                  class="week-day-head"
                  :class="{ today: d.isToday }"
                  @click="page.delta === 0 && onDayClick(d.day)"
                >
                  <span>{{ d.label.replace("周", "") }}</span>
                  <b>{{ d.date || "--" }}</b>
                </div>
              </div>
              <div class="week-grid-body">
                <template v-for="slot in smallSlots" :key="`axis-${page.key}-${slot.no}`">
                  <div class="slot-axis" :style="{ gridRow: `${slot.no} / ${slot.no + 1}` }">
                    <b>{{ slot.no }}</b>
                    <span>{{ slot.start }}</span>
                    <span>{{ slot.end }}</span>
                  </div>
                  <div
                    v-for="day in 7"
                    :key="`bg-${page.key}-${slot.no}-${day}`"
                    class="week-slot-cell"
                    :style="{ gridColumn: `${day + 1} / ${day + 2}`, gridRow: `${slot.no} / ${slot.no + 1}` }"
                    :class="{ today: page.dayTabs[day - 1]?.isToday }"
                  />
                </template>
                <article
                  v-for="block in page.weekCourseBlocks"
                  :key="`${page.weekValue}-${block.day}-${block.startSlot}-${block.endSlot}-${block.index}-${block.course.name}`"
                  class="week-course"
                  :style="courseBlockStyle(block)"
                  :title="courseTitle(block.course)"
                  @click="onWeekCourseClick($event, block.day, page.weekValue)"
                >
                  <strong>{{ block.course.name }}</strong>
                  <span v-if="block.course.location">@{{ block.course.location }}</span>
                  <em>{{ block.course.slotNote || block.course.weeks }}</em>
                </article>
              </div>
            </section>

            <div v-else class="day-pane">
              <section v-if="page.dayCourseBlocks.length" class="day-timeline" aria-label="当日课表">
                <div class="day-grid-body">
                  <template v-for="slot in smallSlots" :key="`day-axis-${page.key}-${slot.no}`">
                    <div class="slot-axis day-axis" :style="{ gridRow: `${slot.no} / ${slot.no + 1}` }">
                      <b>{{ slot.no }}</b>
                      <span>{{ slot.start }}</span>
                      <span>{{ slot.end }}</span>
                    </div>
                    <div class="day-slot-cell" :style="{ gridColumn: '2 / 3', gridRow: `${slot.no} / ${slot.no + 1}` }" />
                  </template>
                  <article
                    v-for="block in page.dayCourseBlocks"
                    :key="`${page.weekValue}-${page.day}-${block.startSlot}-${block.endSlot}-${block.index}-${block.course.name}`"
                    class="day-course-block"
                    :style="dayCourseBlockStyle(block)"
                    :title="courseTitle(block.course)"
                  >
                    <div class="day-course-name">{{ block.course.name }}</div>
                    <div class="day-course-meta">
                      <span v-if="block.course.location">@{{ block.course.location }}</span>
                      <span v-if="block.course.teacher">{{ block.course.teacher }}</span>
                    </div>
                    <div class="day-course-note">{{ block.course.slotNote || block.course.weeks }}</div>
                  </article>
                </div>
              </section>

              <div v-else class="empty-day">
                <el-icon><Moon /></el-icon>
                <p>这一天没有课程</p>
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>

    <el-empty v-else-if="!loading" :image-size="80" description="暂无课表数据" />

    <el-dialog
      v-model="weekDialogOpen"
      title="选择周次"
      :width="320"
      align-center
      :show-close="true"
    >
      <div class="week-grid-pick">
        <button
          v-for="w in weeks"
          :key="w.value"
          type="button"
          class="week-cell"
          :class="{ active: String(w.value) === week, current: Number(w.value) === calendar?.currentWeek }"
          @click="selectWeek(w.value)"
        >
          {{ w.value }}
        </button>
      </div>
      <template #footer>
        <el-button v-if="canJumpToCurrentWeek" type="primary" @click="onJumpAndClose">回到本周</el-button>
        <el-button @click="weekDialogOpen = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { ArrowLeft, ArrowRight, Brush, ChatDotRound, Moon, Refresh } from "@element-plus/icons-vue";
import { jwxtApi } from "@/api/jwxt";
import { copyText, openUserGroup, USER_QQ_GROUP, USER_QQ_GROUP_HINT_KEY } from "@/utils/userGroup";

interface ScheduleCourse {
  name: string;
  teacher?: string;
  weeks: string;
  weekList: number[];
  location?: string;
  slotNote?: string;
  startSlot?: number;
  endSlot?: number;
}
interface ScheduleCell { day: number; bigSlot: number; courses: ScheduleCourse[] }
interface ScheduleResult {
  title?: string;
  semesters: { value: string; label: string; current: boolean }[];
  weeks: { value: string; label: string; current: boolean }[];
  currentSemester: string;
  currentWeek: string;
  cells: ScheduleCell[];
}
interface CalendarWeek { week: number; days: string[]; monday: string; sunday: string }
interface CalendarResult { currentWeek: number; semesterStart: string; semesterEnd: string; weeks: CalendarWeek[] }
interface FlatCourse { bigSlot: number; index: number; course: ScheduleCourse }
interface CacheEnvelope<T> { savedAt: number; data: T }
type ViewMode = "day" | "week";
type ScheduleTheme = "simple" | "color-glass";
interface LastState { semester: string; week: string; activeDay: number; viewMode?: ViewMode }
interface WeekCourseBlock { day: number; startSlot: number; endSlot: number; index: number; course: ScheduleCourse }
interface SchedulePageModel {
  delta: number;
  key: string;
  weekValue: string;
  day: number;
  title: string;
  dayTabs: Array<{ day: number; label: string; date: string; isToday: boolean }>;
  courseCount: number;
  dayCourseBlocks: WeekCourseBlock[];
  weekCourseBlocks: WeekCourseBlock[];
}

const props = defineProps<{ data: any; loading?: boolean }>();

const parsed = ref<ScheduleResult | null>(props.data?.parsed ?? null);
const calendar = ref<CalendarResult | null>(null);
const semester = ref("");
const week = ref("");
const activeDay = ref(dayOfWeek());
const viewMode = ref<ViewMode>("day");
const scheduleTheme = ref<ScheduleTheme>("simple");
const loading = ref(Boolean(props.loading));
const scheduleSavedAt = ref(0);
const CACHE_TTL = 12 * 60 * 60 * 1000;
const CALENDAR_CACHE_KEY = "cpu-schedule-calendar-v1";
const LAST_STATE_KEY = "cpu-jwxt-schedule-view-state-v1";
const LAST_CACHE_KEY = "cpu-schedule-last-cache-key-v1";
const THEME_KEY = "cpu-schedule-theme-v1";
const scheduleCacheStore = new Map<string, CacheEnvelope<ScheduleResult>>();
const prewarmingScheduleKeys = new Set<string>();
const smallSlots = [
  { no: 1, start: "08:00", end: "08:45" },
  { no: 2, start: "08:55", end: "09:40" },
  { no: 3, start: "09:55", end: "10:40" },
  { no: 4, start: "10:50", end: "11:35" },
  { no: 5, start: "13:30", end: "14:15" },
  { no: 6, start: "14:25", end: "15:10" },
  { no: 7, start: "15:25", end: "16:10" },
  { no: 8, start: "16:20", end: "17:05" },
  { no: 9, start: "18:30", end: "19:15" },
  { no: 10, start: "19:25", end: "20:10" },
  { no: 11, start: "20:20", end: "21:05" },
];
const MAX_SMALL_SLOT = smallSlots[smallSlots.length - 1]?.no ?? 10;

const weekDialogOpen = ref(false);
const slideDirection = ref<"next" | "prev">("next");
const contentRef = ref<HTMLElement | null>(null);
const carouselTrackRef = ref<HTMLElement | null>(null);
const dragState = reactive({
  tracking: false,
  dragging: false,
  settling: false,
  pointerId: -1,
  startX: 0,
  startY: 0,
  offsetX: 0,
  width: 0,
  suppressClick: false,
});
let dragOffsetX = 0;
let dragLastX = 0;
let dragLastTime = 0;
let dragVelocityX = 0;
let dragFrame = 0;
let pendingTrackOffset = 0;
let dragCommitDelta = 0;
let dragCommitTimer = 0;
let dragCaptureTarget: HTMLElement | null = null;

watch(() => props.loading, (v) => {
  loading.value = Boolean(v);
}, { immediate: true });

watch(() => props.data, (v) => {
  const next: ScheduleResult | null = v?.parsed ?? null;
  if (!next) return;
  parsed.value = next;
  if (!semester.value || !next.semesters.some((s) => s.value === semester.value)) {
    semester.value = next.currentSemester || "";
  }
  if (!week.value || !next.weeks.some((w) => String(w.value) === week.value)) {
    week.value = String(calendar.value?.currentWeek || next.currentWeek || "");
  }
  scheduleSavedAt.value = Date.now();
  saveScheduleCache();
  saveLastState();
  prewarmAdjacentWeekCaches();
  if (selectedScheduleDiffers(next)) void loadSchedule(false);
}, { immediate: true });

onMounted(async () => {
  restoreScheduleTheme();
  restoreLastState();
  restoreCachedCalendar();
  if (!parsed.value) restoreLastScheduleCache();
  if (!semester.value && parsed.value?.currentSemester) semester.value = parsed.value.currentSemester;
  if (!week.value && parsed.value?.currentWeek) week.value = String(parsed.value.currentWeek);
  await loadCalendar();
  if (parsed.value && selectedScheduleDiffers(parsed.value)) {
    await loadSchedule(false);
  } else if (!parsed.value) {
    await loadSchedule(false);
  }
});

const semesters = computed(() => parsed.value?.semesters ?? []);
const weeks = computed(() => parsed.value?.weeks ?? []);
const currentWeekInfo = computed(() => weekInfoFor(week.value));
const currentWeekRange = computed(() => weekRangeFor(week.value));
const dayTabs = computed(() => dayTabsForWeek(week.value));
const activeDayLabel = computed(() => dayTabs.value.find((d) => d.day === activeDay.value)?.label ?? "今日");
const cacheText = computed(() => scheduleSavedAt.value ? `本地缓存 ${formatCacheTime(scheduleSavedAt.value)}` : "");
const activeWeekNumber = computed(() => {
  const value = Number(week.value || parsed.value?.currentWeek || calendar.value?.currentWeek || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
});
const currentCells = computed<ScheduleCell[]>(() => cellsForWeek(activeWeekNumber.value, parsed.value));
const dayCourses = computed<FlatCourse[]>(() => dayCoursesFor(activeWeekNumber.value, activeDay.value, parsed.value));
const weekCourseBlocks = computed<WeekCourseBlock[]>(() => weekCourseBlocksFor(activeWeekNumber.value, parsed.value));
const dayCourseBlocks = computed<WeekCourseBlock[]>(() => (
  dayCourseBlocksFor(activeWeekNumber.value, activeDay.value, parsed.value)
));
const carouselPages = computed<SchedulePageModel[]>(() => [-1, 0, 1].map((delta) => (
  viewMode.value === "week" ? weekPageModel(delta) : dayPageModel(delta)
)));
const canJumpToCurrentWeek = computed(() => {
  const cur = calendar.value?.currentWeek;
  return Boolean(cur && String(cur) !== week.value);
});

async function loadCalendar() {
  restoreCachedCalendar();
  try {
    const r: any = await jwxtApi.calendar();
    calendar.value = r.parsed;
    writeCache(CALENDAR_CACHE_KEY, calendar.value);
    if (calendar.value?.currentWeek && !week.value) week.value = String(calendar.value.currentWeek);
  } catch {
    /* calendar is best effort */
  }
}

async function loadSchedule(force = false, background = false) {
  if (loading.value && !force && !background) return;
  const hadCache = !force && restoreScheduleCache();
  if (hadCache) {
    saveLastState();
    if (!isStale(scheduleSavedAt.value)) return;
  }
  if (!background) loading.value = true;
  try {
    const r: any = await jwxtApi.schedule({ semester: semester.value, week: week.value });
    parsed.value = r.parsed;
    if (!semester.value) semester.value = parsed.value?.currentSemester ?? "";
    if (!week.value) week.value = String(calendar.value?.currentWeek || parsed.value?.currentWeek || "");
    scheduleSavedAt.value = Date.now();
    saveScheduleCache();
    saveLastState();
    prewarmAdjacentWeekCaches();
    maybeShowUserGroupHint();
  } finally {
    if (!background) loading.value = false;
  }
}

async function onSemesterChange() {
  await loadSchedule(true);
}

function selectWeek(v: string | number) {
  const next = String(v);
  if (next === week.value) {
    weekDialogOpen.value = false;
    return;
  }
  slideDirection.value = Number(next) > Number(week.value || 0) ? "next" : "prev";
  week.value = next;
  saveLastState();
  weekDialogOpen.value = false;
  const key = scheduleCacheKey(semester.value || parsed.value?.currentSemester, next);
  const cached = scheduleCacheStore.get(key) ?? readCache<ScheduleResult>(key);
  if (cached?.data) {
    applyScheduleCache(key);
    if (isStale(cached.savedAt)) void loadSchedule(false, true);
    return;
  }
  void loadSchedule(false);
}

async function onJumpAndClose() {
  weekDialogOpen.value = false;
  await jumpToCurrentWeek();
}

function canChangeWeek(delta: number) {
  const next = nextWeekValue(delta);
  return Boolean(next && next !== week.value);
}

async function changeWeek(delta: number) {
  const next = nextWeekValue(delta);
  if (!next) return;
  slideDirection.value = delta > 0 ? "next" : "prev";
  week.value = next;
  saveLastState();
  const key = scheduleCacheKey(semester.value || parsed.value?.currentSemester, next);
  const cached = scheduleCacheStore.get(key) ?? readCache<ScheduleResult>(key);
  if (cached?.data) {
    applyScheduleCache(key);
    if (isStale(cached.savedAt)) void loadSchedule(false, true);
    return;
  }
  await loadSchedule(false);
  prewarmAdjacentWeekCaches();
}

async function jumpToCurrentWeek() {
  const cur = calendar.value?.currentWeek;
  if (!cur || String(cur) === week.value) return;
  slideDirection.value = Number(week.value || cur) > cur ? "prev" : "next";
  week.value = String(cur);
  activeDay.value = dayOfWeek();
  saveLastState();
  const key = scheduleCacheKey(semester.value || parsed.value?.currentSemester, week.value);
  const cached = scheduleCacheStore.get(key) ?? readCache<ScheduleResult>(key);
  if (cached?.data) {
    applyScheduleCache(key);
    if (isStale(cached.savedAt)) void loadSchedule(false, true);
    return;
  }
  await loadSchedule(false);
}

async function prevDay() {
  slideDirection.value = "prev";
  if (activeDay.value > 1) {
    activeDay.value -= 1;
    saveLastState();
    return;
  }
  if (!canChangeWeek(-1)) return;
  activeDay.value = 7;
  await changeWeek(-1);
}

async function nextDay() {
  slideDirection.value = "next";
  if (activeDay.value < 7) {
    activeDay.value += 1;
    saveLastState();
    return;
  }
  if (!canChangeWeek(1)) return;
  activeDay.value = 1;
  await changeWeek(1);
}

function onDayClick(day: number) {
  slideDirection.value = day > activeDay.value ? "next" : "prev";
  activeDay.value = day;
  saveLastState();
}

function setViewMode(mode: ViewMode) {
  viewMode.value = mode;
  saveLastState();
}

function openDayFromWeek(day: number) {
  onDayClick(day);
  setViewMode("day");
}

function onWeekCourseClick(event: MouseEvent, day: number, targetWeek = week.value) {
  if (dragState.suppressClick || dragState.dragging || dragState.settling) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (targetWeek && targetWeek !== week.value) {
    week.value = targetWeek;
    saveLastState();
  }
  openDayFromWeek(day);
}

function onSchedulePointerDown(event: PointerEvent) {
  if ((viewMode.value !== "day" && viewMode.value !== "week") || loading.value) return;
  if (dragState.settling) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;
  dragState.tracking = true;
  dragState.dragging = false;
  dragState.settling = false;
  dragState.pointerId = event.pointerId;
  dragState.startX = event.clientX;
  dragState.startY = event.clientY;
  dragState.offsetX = 0;
  dragState.width = (event.currentTarget as HTMLElement | null)?.clientWidth || window.innerWidth || 1;
  dragOffsetX = 0;
  dragVelocityX = 0;
  dragLastX = event.clientX;
  dragLastTime = performance.now();
  setDragClasses(false, false);
  clearTrackOffset();
}

function onSchedulePointerMove(event: PointerEvent) {
  if (!dragState.tracking || event.pointerId !== dragState.pointerId) return;
  const now = performance.now();
  const dx = event.clientX - dragState.startX;
  const dy = event.clientY - dragState.startY;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  const likelyHorizontal = absDx >= 4 && absDx >= absDy * 0.55;
  const dt = Math.max(1, now - dragLastTime);
  dragVelocityX = (event.clientX - dragLastX) / dt;
  dragLastX = event.clientX;
  dragLastTime = now;
  if (likelyHorizontal && event.cancelable) event.preventDefault();
  if (!dragState.dragging) {
    if (absDy > 18 && absDy > absDx * 1.8) {
      resetDrag();
      return;
    }
    if (absDx < 5 || !likelyHorizontal) return;
    dragState.dragging = true;
    dragState.suppressClick = true;
    captureDragPointer(event);
    setDragClasses(true, false);
  }
  if (event.cancelable) event.preventDefault();
  const canMove = dx > 0 ? canChangeByDrag(-1) : canChangeByDrag(1);
  dragOffsetX = canMove ? dx : dx * 0.28;
  scheduleTrackOffset(dragOffsetX);
}

async function onSchedulePointerEnd(event: PointerEvent) {
  if (!dragState.tracking || event.pointerId !== dragState.pointerId) return;
  releaseDragPointer(event.pointerId);
  if (!dragState.dragging) {
    resetDrag();
    return;
  }
  const offset = dragOffsetX;
  const threshold = Math.min(72, Math.max(34, dragState.width * 0.14));
  const direction = offset > 0 ? -1 : 1;
  const fastSwipe = Math.abs(dragVelocityX) >= 0.42 && Math.abs(offset) >= 22;
  const shouldChange = (Math.abs(offset) >= threshold || fastSwipe) && canChangeByDrag(direction);
  if (!shouldChange) {
    animateDragTo(0);
    window.setTimeout(resetDrag, 180);
    return;
  }
  dragCommitDelta = direction;
  if (dragCommitTimer) {
    window.clearTimeout(dragCommitTimer);
    dragCommitTimer = 0;
  }
  dragCommitTimer = window.setTimeout(() => {
    void flushDragCommit();
  }, 260);
  animateDragTo(direction > 0 ? -dragState.width : dragState.width);
}

function onSchedulePointerCancel() {
  if (!dragState.tracking) return;
  releaseDragPointer();
  animateDragTo(0);
  window.setTimeout(resetDrag, 180);
}

function canChangeDay(delta: number) {
  if (delta < 0) return activeDay.value > 1 || canChangeWeek(-1);
  return activeDay.value < 7 || canChangeWeek(1);
}

function canChangeByDrag(delta: number) {
  return viewMode.value === "week" ? canChangeWeek(delta) : canChangeDay(delta);
}

async function applyDragChange(delta: number) {
  if (viewMode.value === "week") {
    await changeWeek(delta);
    return;
  }
  await (delta > 0 ? nextDay() : prevDay());
}

async function flushDragCommit() {
  if (!dragCommitDelta) return;
  const delta = dragCommitDelta;
  dragCommitDelta = 0;
  if (dragCommitTimer) {
    window.clearTimeout(dragCommitTimer);
    dragCommitTimer = 0;
  }
  try {
    await applyDragChange(delta);
    await nextTick();
  } finally {
    resetDrag();
  }
}

function onCarouselTrackTransitionEnd(event: TransitionEvent) {
  if (event.propertyName !== "transform" || !dragState.settling || !dragCommitDelta) return;
  void flushDragCommit();
}

function animateDragTo(targetX: number) {
  if (dragFrame) {
    window.cancelAnimationFrame(dragFrame);
    dragFrame = 0;
  }
  dragState.tracking = false;
  dragState.dragging = false;
  dragState.settling = true;
  dragOffsetX = targetX;
  setDragClasses(false, true);
  window.requestAnimationFrame(() => setTrackOffset(targetX));
}

function resetDrag() {
  releaseDragPointer();
  if (dragFrame) {
    window.cancelAnimationFrame(dragFrame);
    dragFrame = 0;
  }
  if (dragCommitTimer) {
    window.clearTimeout(dragCommitTimer);
    dragCommitTimer = 0;
  }
  dragCommitDelta = 0;
  dragState.tracking = false;
  dragState.dragging = false;
  dragState.settling = false;
  dragState.pointerId = -1;
  dragState.offsetX = 0;
  dragOffsetX = 0;
  dragVelocityX = 0;
  setDragClasses(false, false);
  clearTrackOffset();
  window.setTimeout(() => {
    dragState.suppressClick = false;
  }, 220);
}

function captureDragPointer(event: PointerEvent) {
  const target = event.currentTarget as HTMLElement | null;
  if (!target || dragCaptureTarget === target) return;
  try {
    target.setPointerCapture?.(event.pointerId);
    dragCaptureTarget = target;
  } catch {
    dragCaptureTarget = null;
  }
}

function releaseDragPointer(pointerId = dragState.pointerId) {
  if (!dragCaptureTarget || pointerId < 0) {
    dragCaptureTarget = null;
    return;
  }
  try {
    if (!dragCaptureTarget.hasPointerCapture || dragCaptureTarget.hasPointerCapture(pointerId)) {
      dragCaptureTarget.releasePointerCapture?.(pointerId);
    }
  } catch {
    // Safari can drop pointer capture before pointercancel reaches Vue.
  }
  dragCaptureTarget = null;
}

function setDragClasses(dragging: boolean, settling: boolean) {
  const content = contentRef.value;
  if (!content) return;
  content.classList.toggle("dragging", dragging);
  content.classList.toggle("settling", settling);
}

function scheduleTrackOffset(offsetX: number) {
  pendingTrackOffset = offsetX;
  if (dragFrame) return;
  dragFrame = window.requestAnimationFrame(() => {
    dragFrame = 0;
    setTrackOffset(pendingTrackOffset);
  });
}

function setTrackOffset(offsetX: number) {
  const track = carouselTrackRef.value;
  if (!track) return;
  track.style.transform = `translate3d(calc(-33.333333% + ${offsetX}px), 0, 0)`;
}

function clearTrackOffset() {
  const track = carouselTrackRef.value;
  if (!track) return;
  track.style.transform = "";
}

async function copyUserGroup() {
  await copyText(USER_QQ_GROUP);
  ElMessage.success(`已复制QQ群号 ${USER_QQ_GROUP}`);
}

async function joinUserGroup() {
  try {
    await ElMessageBox.confirm(
      `即将跳转加入用户QQ群 ${USER_QQ_GROUP}，用于反馈课表问题和接收公告。是否继续？`,
      "加入用户群",
      { confirmButtonText: "去加群", cancelButtonText: "再想想", type: "info" },
    );
  } catch {
    return;
  }
  openUserGroup();
}

function maybeShowUserGroupHint() {
  try {
    if (localStorage.getItem(USER_QQ_GROUP_HINT_KEY)) return;
    localStorage.setItem(USER_QQ_GROUP_HINT_KEY, "1");
  } catch {
    return;
  }
  ElMessage.info({
    message: `课表加载成功。遇到问题或想提建议，可以加入用户QQ群 ${USER_QQ_GROUP}`,
    duration: 6000,
    showClose: true,
  });
}

function dayOfWeek() {
  const d = new Date().getDay();
  return d === 0 ? 7 : d;
}

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function shortDate(value: string) {
  const m = value.match(/-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}/${m[2]}` : "";
}

function plusOneDay(ymd: string): string {
  if (!ymd) return "";
  const d = new Date(ymd + "T00:00:00");
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatCacheTime(ts: number) {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function weekInfoFor(value: string | number) {
  return calendar.value?.weeks.find((w) => w.week === Number(value)) ?? null;
}

function weekRangeFor(value: string | number) {
  const w = weekInfoFor(value);
  if (!w || w.days.length < 7) return "";
  const monday = w.days[1];
  const sunday = plusOneDay(w.days[6]);
  return `${shortDate(monday)} - ${shortDate(sunday)}`;
}

function dayTabsForWeek(value: string | number) {
  const labels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const raw = weekInfoFor(value)?.days ?? [];
  const dates = raw.length >= 7 ? [...raw.slice(1, 7), plusOneDay(raw[6])] : [];
  const today = todayKey();
  return labels.map((label, i) => ({
    day: i + 1,
    label,
    date: shortDate(dates[i] ?? ""),
    isToday: dates[i] === today,
  }));
}

function scheduleForWeek(weekValue: string | number) {
  const requested = String(weekValue || "");
  if (requested && requested === currentWeekValue() && parsed.value) return parsed.value;
  const cached = cachedScheduleEnvelopeForWeek(requested);
  return cached?.data ?? (requested === currentWeekValue() ? parsed.value : null);
}

function cachedScheduleEnvelopeForWeek(weekValue: string | number) {
  const key = scheduleCacheKey(semester.value || parsed.value?.currentSemester, String(weekValue || ""));
  return scheduleCacheStore.get(key) ?? readCache<ScheduleResult>(key);
}

function cellsForWeek(wk: number, source: ScheduleResult | null = parsed.value) {
  return (source?.cells ?? [])
    .map((cell) => ({
      ...cell,
      courses: wk ? cell.courses.filter((course) => courseMatchesWeek(course, wk)) : cell.courses,
    }))
    .filter((cell) => cell.courses.length);
}

function dayCoursesFor(wk: number, day: number, source: ScheduleResult | null = parsed.value) {
  const list: FlatCourse[] = [];
  for (const cell of cellsForWeek(wk, source)) {
    if (cell.day !== day) continue;
    cell.courses.forEach((course, index) => list.push({ bigSlot: cell.bigSlot, index, course }));
  }
  return list.sort((a, b) => a.bigSlot - b.bigSlot);
}

function weekCourseBlocksFor(wk: number, source: ScheduleResult | null = parsed.value) {
  const blocks: WeekCourseBlock[] = [];
  const seen = new Set<string>();
  for (const cell of cellsForWeek(wk, source)) {
    cell.courses.forEach((course, index) => {
      const range = normalizeSlotRange(cell.bigSlot, course);
      // 去重兜底：同一格子里同名/同地点/同节次的课只保留一次，避免后端返回重复时 DOM 重叠
      const dedupKey = `${cell.day}-${range.start}-${range.end}-${course.name}-${course.location ?? ""}`;
      if (seen.has(dedupKey)) return;
      seen.add(dedupKey);
      blocks.push({ day: cell.day, startSlot: range.start, endSlot: range.end, index, course });
    });
  }
  return blocks.sort((a, b) => a.startSlot - b.startSlot || a.day - b.day || a.index - b.index);
}

function dayCourseBlocksFor(wk: number, day: number, source: ScheduleResult | null = parsed.value) {
  return weekCourseBlocksFor(wk, source).filter((block) => block.day === day);
}

function weekPageModel(delta: number): SchedulePageModel {
  const weekValue = delta === 0 ? currentWeekValue() : nextWeekValueFrom(currentWeekValue(), delta) || currentWeekValue();
  const weekNo = Number(weekValue || 0);
  const source = scheduleForWeek(weekValue);
  const blocks = weekCourseBlocksFor(weekNo, source);
  return {
    delta,
    key: `week-${delta}`,
    weekValue,
    day: activeDay.value,
    title: "整周",
    dayTabs: dayTabsForWeek(weekValue),
    courseCount: blocks.length,
    dayCourseBlocks: dayCourseBlocksFor(weekNo, activeDay.value, source),
    weekCourseBlocks: blocks,
  };
}

function dayPageModel(delta: number): SchedulePageModel {
  const target = dayTarget(delta);
  const weekNo = Number(target.weekValue || 0);
  const source = scheduleForWeek(target.weekValue);
  const blocks = dayCourseBlocksFor(weekNo, target.day, source);
  const tabs = dayTabsForWeek(target.weekValue);
  return {
    delta,
    key: `day-${delta}`,
    weekValue: target.weekValue,
    day: target.day,
    title: tabs.find((d) => d.day === target.day)?.label ?? "今日",
    dayTabs: tabs,
    courseCount: blocks.length,
    dayCourseBlocks: blocks,
    weekCourseBlocks: weekCourseBlocksFor(weekNo, source),
  };
}

function dayTarget(delta: number) {
  if (delta === 0) return { weekValue: currentWeekValue(), day: activeDay.value };
  if (delta < 0) {
    if (activeDay.value > 1) return { weekValue: currentWeekValue(), day: activeDay.value - 1 };
    return { weekValue: nextWeekValueFrom(currentWeekValue(), -1) || currentWeekValue(), day: 7 };
  }
  if (activeDay.value < 7) return { weekValue: currentWeekValue(), day: activeDay.value + 1 };
  return { weekValue: nextWeekValueFrom(currentWeekValue(), 1) || currentWeekValue(), day: 1 };
}

function currentWeekValue() {
  return week.value || String(calendar.value?.currentWeek || parsed.value?.currentWeek || "");
}

function nextWeekValue(delta: number) {
  return nextWeekValueFrom(currentWeekValue(), delta);
}

function nextWeekValueFrom(current: string, delta: number) {
  const values = weeks.value.map((w) => String(w.value)).filter(Boolean);
  const index = values.indexOf(current);
  if (index >= 0) return values[index + delta] || "";
  const next = Number(current) + delta;
  if (!Number.isFinite(next) || next < 1) return "";
  if (calendar.value?.weeks.length && next > calendar.value.weeks.length) return "";
  return String(next);
}

function courseTitle(course: ScheduleCourse) {
  return [
    course.name,
    course.teacher ? `教师：${course.teacher}` : "",
    course.location ? `地点：${course.location}` : "",
    course.weeks,
    course.slotNote,
  ].filter(Boolean).join("\n");
}

function courseMatchesWeek(course: ScheduleCourse, wk: number) {
  if (!wk) return true;
  if (Array.isArray(course.weekList) && course.weekList.length) {
    return course.weekList.includes(wk);
  }
  return true;
}

function selectedScheduleDiffers(data: ScheduleResult) {
  const semesterDiffers = Boolean(semester.value && data.currentSemester && semester.value !== data.currentSemester);
  const weekDiffers = Boolean(week.value && data.currentWeek && String(week.value) !== String(data.currentWeek));
  return semesterDiffers || weekDiffers;
}

const simpleTone = { bg: "#f4fbf8", border: "#168776", text: "#0f5d52" };
const colorGlassTones = [
  { bg: "rgba(255, 228, 230, 0.76)", border: "rgba(244, 63, 94, 0.58)", text: "#8f1230" },
  { bg: "rgba(255, 237, 213, 0.76)", border: "rgba(249, 115, 22, 0.56)", text: "#8a3412" },
  { bg: "rgba(254, 243, 199, 0.78)", border: "rgba(245, 158, 11, 0.58)", text: "#7a4c09" },
  { bg: "rgba(220, 252, 231, 0.78)", border: "rgba(34, 197, 94, 0.54)", text: "#14532d" },
  { bg: "rgba(204, 251, 241, 0.78)", border: "rgba(20, 184, 166, 0.54)", text: "#115e59" },
  { bg: "rgba(219, 234, 254, 0.78)", border: "rgba(59, 130, 246, 0.54)", text: "#1e3a8a" },
  { bg: "rgba(224, 231, 255, 0.78)", border: "rgba(99, 102, 241, 0.54)", text: "#3730a3" },
  { bg: "rgba(243, 232, 255, 0.78)", border: "rgba(168, 85, 247, 0.54)", text: "#6b21a8" },
  { bg: "rgba(252, 231, 243, 0.78)", border: "rgba(236, 72, 153, 0.52)", text: "#9d174d" },
];

function hashName(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function toneFor(name: string) {
  if (scheduleTheme.value !== "color-glass") return simpleTone;
  return colorGlassTones[hashName(name) % colorGlassTones.length];
}

function restoreScheduleTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "color-glass" || saved === "simple") scheduleTheme.value = saved;
  } catch {
    /* ignore */
  }
}

function toggleScheduleTheme() {
  scheduleTheme.value = scheduleTheme.value === "color-glass" ? "simple" : "color-glass";
  try {
    localStorage.setItem(THEME_KEY, scheduleTheme.value);
  } catch {
    /* ignore */
  }
}

function normalizeSlotRange(bigSlot: number, course: ScheduleCourse) {
  const fallbackStart = Math.max(1, Math.min(MAX_SMALL_SLOT, bigSlot * 2 - 1));
  const fallbackEnd = Math.max(fallbackStart, Math.min(MAX_SMALL_SLOT, bigSlot * 2));
  const start = Number.isFinite(course.startSlot) ? Number(course.startSlot) : fallbackStart;
  const end = Number.isFinite(course.endSlot) ? Number(course.endSlot) : fallbackEnd;
  const safeStart = Math.max(1, Math.min(MAX_SMALL_SLOT, start));
  const safeEnd = Math.max(safeStart, Math.min(MAX_SMALL_SLOT, end));
  return { start: safeStart, end: safeEnd };
}

function courseBlockStyle(block: WeekCourseBlock) {
  const tone = toneFor(block.course.name);
  return {
    gridColumn: `${block.day + 1} / ${block.day + 2}`,
    gridRow: `${block.startSlot} / ${block.endSlot + 1}`,
    "--course-bg": tone.bg,
    "--course-border": tone.border,
    "--course-text": tone.text,
  };
}

function dayCourseBlockStyle(block: WeekCourseBlock) {
  const tone = toneFor(block.course.name);
  return {
    gridColumn: "2 / 3",
    gridRow: `${block.startSlot} / ${block.endSlot + 1}`,
    "--course-bg": tone.bg,
    "--course-border": tone.border,
    "--course-text": tone.text,
  };
}

function scheduleCacheKey(sem = semester.value, wk = week.value) {
  const s = sem || parsed.value?.currentSemester || "current";
  const w = wk || calendar.value?.currentWeek || parsed.value?.currentWeek || "current";
  return `cpu-schedule-cache-v1:${s}:${w}`;
}

function readCache<T>(key: string): CacheEnvelope<T> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsedValue = JSON.parse(raw);
    if (!parsedValue || typeof parsedValue.savedAt !== "number") return null;
    return parsedValue as CacheEnvelope<T>;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, data: T) {
  try {
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
  } catch {
    /* ignore */
  }
}

function writeScheduleCache(key: string, data: ScheduleResult) {
  const envelope = { savedAt: Date.now(), data };
  rememberScheduleCache(key, envelope);
  try {
    localStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    /* ignore */
  }
}

function rememberScheduleCache(key: string, envelope: CacheEnvelope<ScheduleResult>) {
  scheduleCacheStore.set(key, envelope);
}

function isStale(savedAt: number) {
  return !savedAt || Date.now() - savedAt > CACHE_TTL;
}

function restoreCachedCalendar() {
  const cached = readCache<CalendarResult>(CALENDAR_CACHE_KEY);
  if (cached?.data) calendar.value = cached.data;
}

function restoreLastState() {
  try {
    const raw = localStorage.getItem(LAST_STATE_KEY);
    if (!raw) return;
    const state = JSON.parse(raw) as LastState;
    if (state.semester) semester.value = state.semester;
    if (state.week) week.value = state.week;
    if (state.activeDay >= 1 && state.activeDay <= 7) activeDay.value = state.activeDay;
    if (state.viewMode === "day" || state.viewMode === "week") viewMode.value = state.viewMode;
  } catch {
    /* ignore */
  }
}

function saveLastState() {
  try {
    localStorage.setItem(LAST_STATE_KEY, JSON.stringify({
      semester: semester.value,
      week: week.value,
      activeDay: activeDay.value,
      viewMode: viewMode.value,
    }));
  } catch {
    /* ignore */
  }
}

function restoreLastScheduleCache() {
  try {
    const key = localStorage.getItem(LAST_CACHE_KEY);
    if (!key) return false;
    return applyScheduleCache(key);
  } catch {
    return false;
  }
}

function restoreScheduleCache() {
  const key = scheduleCacheKey();
  return applyScheduleCache(key) || (!parsed.value && restoreLastScheduleCache());
}

function applyScheduleCache(key: string) {
  const cached = readCache<ScheduleResult>(key);
  if (!cached?.data) return false;
  rememberScheduleCache(key, cached);
  parsed.value = cached.data;
  scheduleSavedAt.value = cached.savedAt;
  if (!semester.value) semester.value = cached.data.currentSemester || "";
  if (!week.value) week.value = String(cached.data.currentWeek || "");
  prewarmAdjacentWeekCaches();
  maybeShowUserGroupHint();
  return true;
}

function saveScheduleCache() {
  if (!parsed.value) return;
  const key = scheduleCacheKey(parsed.value.currentSemester || semester.value, week.value || parsed.value.currentWeek);
  writeScheduleCache(key, parsed.value);
  try { localStorage.setItem(LAST_CACHE_KEY, key); } catch { /* ignore */ }
}

function prewarmAdjacentWeekCaches() {
  if (!parsed.value || !semester.value) return;
  const current = currentWeekValue();
  [nextWeekValueFrom(current, -1), nextWeekValueFrom(current, 1)]
    .filter(Boolean)
    .forEach((wk) => prewarmScheduleCacheForWeek(wk));
}

function prewarmScheduleCacheForWeek(wk: string) {
  const key = scheduleCacheKey(parsed.value?.currentSemester || semester.value, wk);
  const cached = scheduleCacheStore.get(key) ?? readCache<ScheduleResult>(key);
  if (cached?.data && !isStale(cached.savedAt)) {
    if (!scheduleCacheStore.has(key)) rememberScheduleCache(key, cached);
    return;
  }
  if (prewarmingScheduleKeys.has(key)) return;
  prewarmingScheduleKeys.add(key);
  void jwxtApi.schedule({ semester: semester.value, week: wk })
    .then((r: any) => {
      if (r?.parsed) writeScheduleCache(key, r.parsed);
    })
    .finally(() => {
      prewarmingScheduleKeys.delete(key);
    });
}
</script>

<style scoped lang="scss">
.schedule-pane {
  color: #172033;
}

.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 0 auto 14px;
  max-width: 720px;
}

.top-placeholder {
  height: 38px;
  display: flex;
  align-items: center;
  color: #667085;
  font-size: 13px;
}

.sem-select {
  flex: 1;
  min-width: 0;
  max-width: 260px;
}

.sem-select :deep(.el-select__wrapper) {
  min-height: 38px;
  border-radius: 10px;
  border: 1px solid #dde4ee;
  box-shadow: none;
  background: #fff;
  padding: 4px 10px;
}

.sem-select :deep(.el-select__wrapper:hover) {
  border-color: #c2cdda;
}

.sem-select :deep(.el-select__wrapper.is-focused) {
  border-color: #168776;
  box-shadow: none;
}

.sem-select :deep(.el-select__placeholder),
.sem-select :deep(.el-select__selected-item) {
  font-size: 13px;
  color: #172033;
}

.top-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.view-switch {
  height: 38px;
  padding: 3px;
  border: 1px solid #dde4ee;
  border-radius: 10px;
  background: #fff;
  display: inline-grid;
  grid-template-columns: repeat(2, 34px);
  gap: 2px;
}

.view-switch button {
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #5c6677;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: rgba(22, 135, 118, 0.18);
}

.view-switch button.active {
  background: #168776;
  color: #fff;
}

.icon-btn {
  width: 38px;
  height: 38px;
  border: 1px solid #dde4ee;
  border-radius: 10px;
  background: #fff;
  color: #172033;
  display: grid;
  place-items: center;
  touch-action: manipulation;
  cursor: pointer;
  -webkit-tap-highlight-color: rgba(22, 135, 118, 0.18);
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.icon-btn:active { background: #f3f4f6; }

.icon-btn.active {
  background: #168776;
  border-color: #168776;
  color: #fff;
}

.icon-btn.spinning .el-icon {
  animation: spin 0.9s linear infinite;
}

.icon-btn .el-icon {
  font-size: 18px;
}

.schedule-pane.theme-color-glass {
  color: #172033;
}
.theme-color-glass .sem-select :deep(.el-select__wrapper),
.theme-color-glass .view-switch,
.theme-color-glass .icon-btn,
.theme-color-glass .week-btn,
.theme-color-glass .week-title,
.theme-color-glass .day-pill {
  border-color: rgba(255, 255, 255, 0.64);
  background: rgba(255, 255, 255, 0.58);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.70),
    0 10px 28px rgba(36, 58, 91, 0.08);
  backdrop-filter: blur(18px) saturate(150%);
  -webkit-backdrop-filter: blur(18px) saturate(150%);
}
.theme-color-glass .view-switch button.active,
.theme-color-glass .day-pill.active,
.theme-color-glass .icon-btn.active {
  border-color: rgba(255, 255, 255, 0.56);
  background: linear-gradient(135deg, rgba(22, 135, 118, 0.92), rgba(59, 130, 246, 0.82));
  color: #fff;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.34),
    0 12px 28px rgba(22, 135, 118, 0.20);
}

@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }

.week-switcher {
  max-width: 720px;
  margin: 0 auto 12px;
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr) 96px;
  align-items: center;
  gap: 8px;
}

.week-btn {
  height: 42px;
  border: 1px solid #dde4ee;
  border-radius: 13px;
  background: #fff;
  color: #172033;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 13px;
  touch-action: manipulation;
}

.week-btn:disabled {
  color: #b7bfcc;
  background: #f9fafb;
}

.week-title {
  min-width: 0;
  height: 42px;
  border: none;
  border-radius: 13px;
  background: #e8f6f3;
  color: #116b5f;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  padding: 0 10px;
  font: inherit;
  cursor: default;
}

.week-title.clickable {
  cursor: pointer;
  -webkit-tap-highlight-color: rgba(22, 135, 118, 0.18);
  transition: background 0.15s;
}

.week-title.clickable:hover,
.week-title.clickable:active {
  background: #d3eee8;
}

.week-title b {
  font-size: 15px;
}

.week-title span {
  font-size: 11px;
}

.week-strip {
  max-width: 720px;
  margin: 0 auto 14px;
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6px;
  overflow: hidden;
}

.day-pill {
  min-width: 0;
  border: 1px solid #dde4ee;
  border-radius: 13px;
  background: #fff;
  padding: 8px 3px;
  color: #5c6677;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  touch-action: manipulation;
}

.day-pill span {
  font-size: 12px;
  line-height: 1.15;
  white-space: nowrap;
}

.day-pill b {
  font-size: 13px;
  line-height: 1.15;
  white-space: nowrap;
}

.day-pill.today {
  border-color: #9fd9cf;
}

.day-pill.active {
  background: #168776;
  border-color: #168776;
  color: #fff;
}

.content {
  max-width: 720px;
  margin: 0 auto;
  touch-action: pan-y;
  -webkit-overflow-scrolling: touch;
  min-height: 0;
}

.content.dragging {
  cursor: grabbing;
  user-select: none;
}

.summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  color: #667085;
}

.summary div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.summary b {
  color: #172033;
  font-size: 20px;
}

.summary small {
  color: #98a2b3;
  font-size: 11px;
}

.summary em {
  font-style: normal;
  color: #168776;
  font-weight: 700;
}

.carousel-viewport {
  width: 100%;
  overflow: hidden;
  touch-action: pan-y;
  -webkit-overflow-scrolling: touch;
  contain: layout paint;
}

.carousel-track {
  display: grid;
  width: 300%;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  transform: translate3d(-33.333333%, 0, 0);
  will-change: transform;
  backface-visibility: hidden;
  transform-style: preserve-3d;
}

.content.dragging .carousel-track {
  transition: none;
}

.content.settling .carousel-track {
  transition: transform 0.18s cubic-bezier(0.2, 0, 0.2, 1);
}

.schedule-panel {
  min-width: 0;
  width: 100%;
  contain: layout paint;
  transform: translateZ(0);
}

.schedule-panel:not(.active) {
  pointer-events: none;
}

.day-timeline {
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  touch-action: pan-y;
}

.day-grid-body {
  display: grid;
  grid-template-columns: 50px minmax(0, 1fr);
  grid-template-rows: repeat(11, minmax(58px, 6.2dvh));
  gap: 5px;
  position: relative;
}

.day-axis {
  padding-top: 0;
}

.day-slot-cell {
  min-width: 0;
  min-height: 0;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.36);
  border: 1px solid rgba(218, 227, 239, 0.82);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.46);
}

.day-course-block {
  z-index: 2;
  margin: 1px;
  border-radius: 16px;
  border: 1.5px solid var(--course-border);
  background: var(--course-bg);
  color: var(--course-text);
  padding: 12px 14px;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 7px;
  overflow: hidden;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.58),
    inset 0 -1px 0 rgba(255, 255, 255, 0.22),
    0 10px 24px rgba(24, 34, 51, 0.08);
  backdrop-filter: blur(14px) saturate(145%);
  -webkit-backdrop-filter: blur(14px) saturate(145%);
  touch-action: pan-y;
}

.day-course-name {
  font-size: 18px;
  line-height: 1.25;
  font-weight: 800;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.day-course-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  font-size: 13px;
  line-height: 1.3;
  font-weight: 700;
  opacity: 0.94;
}

.day-course-note {
  font-size: 12px;
  line-height: 1.25;
  opacity: 0.86;
}

.week-overview {
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  touch-action: pan-y;
}

.week-grid-head,
.week-grid-body {
  display: grid;
  grid-template-columns: 44px repeat(7, minmax(0, 1fr));
  gap: 4px;
}

.week-grid-head {
  margin-bottom: 8px;
  padding: 2px 0;
}

.time-head,
.week-day-head {
  min-width: 0;
  height: 46px;
  border-radius: 10px;
  color: #667085;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  line-height: 1.1;
}

.time-head {
  font-size: 11px;
}

.week-day-head {
  background: rgba(255, 255, 255, 0.56);
  border: 1px solid rgba(218, 227, 239, 0.88);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.52);
  cursor: pointer;
  touch-action: manipulation;
}

.week-day-head span {
  font-size: 13px;
  font-weight: 700;
}

.week-day-head b {
  margin-top: 3px;
  font-size: 11px;
  font-weight: 600;
}

.week-day-head.today {
  border-color: #168776;
  background: #e8f6f3;
  color: #116b5f;
}

.week-grid-body {
  position: relative;
  grid-template-rows: repeat(11, minmax(48px, 5.8dvh));
  align-items: stretch;
}

.slot-axis {
  min-width: 0;
  min-height: 0;
  padding-top: 4px;
  color: #667085;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
}

.slot-axis b {
  color: #172033;
  font-size: 13px;
}

.slot-axis span {
  text-align: center;
  font-size: 9px;
  line-height: 1.12;
}

.week-slot-cell {
  min-width: 0;
  min-height: 0;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.30);
  border: 1px solid rgba(226, 234, 244, 0.78);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.38);
}

.week-slot-cell.today {
  background: rgba(232, 246, 243, 0.48);
}

.week-course {
  min-width: 0;
  min-height: 0;
  z-index: 2;
  margin: 1px;
  border-radius: 9px;
  border: 1.5px solid var(--course-border);
  background: var(--course-bg);
  color: var(--course-text);
  padding: 5px 3px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  overflow: hidden;
  box-shadow: 0 4px 10px rgba(24, 34, 51, 0.06);
  cursor: pointer;
  touch-action: pan-y;
}

.theme-color-glass .day-slot-cell,
.theme-color-glass .week-slot-cell,
.theme-color-glass .week-day-head {
  border-color: rgba(255, 255, 255, 0.56);
  background: rgba(255, 255, 255, 0.42);
}
.theme-color-glass .week-day-head.today,
.theme-color-glass .week-slot-cell.today {
  background: rgba(204, 251, 241, 0.54);
}
.theme-color-glass .day-course-block,
.theme-color-glass .week-course {
  border-width: 1px;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.72),
    inset 0 -1px 0 rgba(255, 255, 255, 0.24),
    0 12px 30px rgba(44, 62, 94, 0.12);
  backdrop-filter: blur(18px) saturate(160%);
  -webkit-backdrop-filter: blur(18px) saturate(160%);
}

@supports (-webkit-touch-callout: none) {
  @media (max-width: 760px) {
    .carousel-viewport,
    .schedule-panel {
      contain: layout;
    }

    .day-slot-cell,
    .week-slot-cell,
    .week-day-head {
      box-shadow: none;
    }

    .day-course-block,
    .week-course {
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
      box-shadow: 0 2px 7px rgba(24, 34, 51, 0.06);
    }

    .content.dragging .day-course-block,
    .content.dragging .week-course {
      box-shadow: none;
    }
  }
}

.week-course strong,
.week-course span,
.week-course em {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-all;
  text-align: center;
}

.week-course strong {
  -webkit-line-clamp: 4;
  font-size: 10px;
  line-height: 1.2;
  font-weight: 800;
}

.week-course span {
  -webkit-line-clamp: 2;
  font-size: 9px;
  line-height: 1.12;
  font-weight: 700;
  opacity: 0.94;
}

.week-course em {
  -webkit-line-clamp: 1;
  font-size: 8px;
  line-height: 1.1;
  font-style: normal;
  opacity: 0.86;
}

.empty-day {
  min-height: 240px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 10px;
  color: #8a94a6;
}

.empty-day .el-icon {
  font-size: 36px;
}

.day-pane {
  will-change: transform, opacity;
}

.week-grid-pick {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
}

.week-cell {
  border: 1px solid #dde4ee;
  background: #fff;
  border-radius: 10px;
  padding: 10px 4px;
  font: inherit;
  font-size: 14px;
  color: #374151;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
  -webkit-tap-highlight-color: rgba(22, 135, 118, 0.18);
}

.week-cell:active { background: #f3f4f6; }
.week-cell.current { border-color: #168776; color: #168776; }

.week-cell.active {
  background: #168776;
  border-color: #168776;
  color: #fff;
}

@media (max-width: 760px) {
  .summary { display: none; }

  .top {
    gap: 6px;
  }

  .sem-select {
    max-width: none;
  }

  .view-switch {
    grid-template-columns: repeat(2, 30px);
  }

  .day-grid-body {
    grid-template-columns: 42px minmax(0, 1fr);
    grid-template-rows: repeat(11, minmax(52px, 6dvh));
    gap: 4px;
  }

  .day-slot-cell {
    border-radius: 10px;
  }

  .day-course-block {
    border-radius: 12px;
    padding: 10px 12px;
    gap: 5px;
  }

  .day-course-name {
    font-size: 16px;
    -webkit-line-clamp: 3;
  }

  .day-course-meta {
    font-size: 12px;
  }

  .day-course-note {
    font-size: 11px;
  }

  .week-grid-head,
  .week-grid-body {
    grid-template-columns: 38px repeat(7, minmax(0, 1fr));
    gap: 3px;
  }

  .week-day-head {
    height: 42px;
    border-radius: 8px;
  }

  .week-day-head span {
    font-size: 12px;
  }

  .week-day-head b {
    font-size: 10px;
  }

  .week-grid-body {
    grid-template-rows: repeat(11, minmax(44px, 5.5dvh));
  }

  .slot-axis b {
    font-size: 12px;
  }

  .slot-axis span {
    font-size: 8px;
  }

  .week-slot-cell {
    border-radius: 8px;
  }

  .week-course {
    border-radius: 7px;
    padding: 4px 2px;
  }

  .week-course strong {
    font-size: 9px;
  }

  .week-course span {
    font-size: 8px;
  }

  .week-course em {
    display: none;
  }
}

@media (max-width: 390px) {
  .week-strip {
    gap: 3px;
  }

  .day-pill {
    border-radius: 10px;
    padding: 7px 1px;
    gap: 1px;
  }

  .day-pill span {
    font-size: 11px;
  }

  .day-pill b {
    font-size: 11px;
  }

  .week-switcher {
    grid-template-columns: 82px minmax(0, 1fr) 82px;
    gap: 6px;
  }

  .week-btn {
    font-size: 12px;
  }

  .view-switch {
    grid-template-columns: repeat(2, 28px);
    height: 36px;
  }

  .view-switch button {
    font-size: 12px;
  }

  .icon-btn {
    width: 36px;
    height: 36px;
  }

  .week-grid-head,
  .week-grid-body {
    grid-template-columns: 34px repeat(7, minmax(0, 1fr));
    gap: 2px;
  }

  .day-grid-body {
    grid-template-columns: 36px minmax(0, 1fr);
    grid-template-rows: repeat(11, minmax(48px, 5.6dvh));
    gap: 3px;
  }

  .day-course-block {
    padding: 9px 10px;
  }

  .day-course-name {
    font-size: 15px;
  }

  .day-course-meta {
    font-size: 11px;
  }

  .day-course-note {
    font-size: 10px;
  }

  .week-grid-body {
    grid-template-rows: repeat(11, minmax(40px, 5.2dvh));
  }

  .slot-axis b {
    font-size: 11px;
  }

  .slot-axis span {
    font-size: 7px;
  }

  .week-course strong {
    font-size: 8px;
  }

  .week-course span {
    font-size: 7px;
  }
}
</style>
