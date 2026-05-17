<template>
<div
  class="schedule-pane"
  :class="{
    'is-native-app': isNativeScheduleApp,
    'is-static-week-swipe': useStaticWeekSwipe,
    'view-day': viewMode === 'day',
    'view-week': viewMode === 'week',
  }"
  :style="pageStyle"
>
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
          :class="{ active: isViewingToday }"
          :aria-label="viewMode === 'week' ? '回到本周' : '跳转到当日'"
          :title="viewMode === 'week' ? '回到本周' : '跳转到当日'"
          @click="jumpToToday"
        >
          <el-icon><Aim /></el-icon>
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
            :class="[
              { active: page.delta === 0 },
              page.delta === 0 && useStaticWeekSwipe ? staticWeekAnimationClass : '',
            ]"
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
                    @click="onWeekSlotClick($event, day, slot.no, page.weekValue)"
                  />
                </template>
                <article
                  v-for="block in page.weekCourseBlocks"
                  :key="`${page.weekValue}-${block.day}-${block.startSlot}-${block.endSlot}-${block.index}-${block.course.name}`"
                  class="week-course"
                  :style="courseBlockStyle(block)"
                  :title="courseTitle(block.course)"
                  @click.stop="onCourseBlockClick($event, block, page.weekValue)"
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
                    <div
                      class="day-slot-cell"
                      :style="{ gridColumn: '2 / 3', gridRow: `${slot.no} / ${slot.no + 1}` }"
                      @click="onDaySlotClick($event, page.day, slot.no, page.weekValue)"
                    />
                  </template>
                  <article
                    v-for="block in page.dayCourseBlocks"
                    :key="`${page.weekValue}-${page.day}-${block.startSlot}-${block.endSlot}-${block.index}-${block.course.name}`"
                    class="day-course-block"
                    :style="dayCourseBlockStyle(block)"
                    :title="courseTitle(block.course)"
                    @click.stop="onCourseBlockClick($event, block, page.weekValue)"
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

    <Teleport to="body">
      <Transition name="course-editor">
        <div v-if="editDialogOpen" class="course-editor-overlay" @click.self="editDialogOpen = false">
          <section class="course-editor-panel" role="dialog" aria-modal="true">
            <header class="course-editor-nav">
              <button type="button" @click="editDialogOpen = false">取消</button>
              <h2>{{ editingCourseBlock ? "修改课程" : "添加课程" }}</h2>
              <button type="button" class="primary" @click="saveCourseEdit">保存</button>
            </header>

            <div class="course-editor-scroll">
              <section class="editor-card">
                <label class="editor-row">
                  <span>课程</span>
                  <input v-model="customCourseForm.name" maxlength="40" placeholder="课程名称" />
                </label>
                <label class="editor-row">
                  <span>老师</span>
                  <input v-model="customCourseForm.teacher" maxlength="40" placeholder="选填" />
                </label>
                <label class="editor-row">
                  <span>地点</span>
                  <input v-model="customCourseForm.location" maxlength="40" placeholder="选填" />
                </label>
                <label class="editor-row">
                  <span>备注</span>
                  <input v-model="customCourseForm.note" maxlength="60" placeholder="选填" />
                </label>
              </section>

              <div class="editor-section-title">
                <span>时间段</span>
                <div class="editor-actions">
                  <button v-if="canRestoreOriginalCourse" type="button" @click="restoreOriginalCourse">恢复原始</button>
                  <button v-if="editingCourseBlock" type="button" class="danger" @click="deleteEditingCourse">删除</button>
                </div>
              </div>

              <section class="editor-card">
                <label class="editor-row">
                  <span>周数</span>
                  <select v-model="customCourseForm.weekMode">
                    <option value="current">本周</option>
                    <option value="all">全部周</option>
                    <option value="custom">指定周次</option>
                  </select>
                </label>
                <div v-if="customCourseForm.weekMode === 'custom'" class="editor-week-picker">
                  <span>指定周</span>
                  <div class="week-chip-grid">
                    <button
                      v-for="w in weekNumberOptions"
                      :key="w"
                      type="button"
                      :class="{ active: customCourseForm.weekList.includes(w) }"
                      @click="toggleCustomWeek(w)"
                    >
                      {{ w }}
                    </button>
                  </div>
                </div>
                <label class="editor-row">
                  <span>星期</span>
                  <select v-model.number="customCourseForm.day">
                    <option v-for="d in 7" :key="d" :value="d">{{ dayLabel(d) }}</option>
                  </select>
                </label>
                <div class="editor-row">
                  <span>时间</span>
                  <div class="slot-range-input">
                    <input v-model.number="customCourseForm.startSlot" type="number" min="1" :max="MAX_SMALL_SLOT" />
                    <em>-</em>
                    <input v-model.number="customCourseForm.endSlot" type="number" :min="customCourseForm.startSlot" :max="MAX_SMALL_SLOT" />
                    <b>节</b>
                  </div>
                </div>
              </section>

              <section v-if="hiddenCourseItems.length" class="editor-card hidden-restore-card">
                <div class="editor-card-title">已编辑课程</div>
                <div class="hidden-list">
                  <button v-for="item in hiddenCourseItems" :key="item.key" type="button" @click="restoreHiddenCourse(item.key)">
                    {{ item.label }}
                  </button>
                </div>
              </section>
            </div>
          </section>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Aim, ArrowLeft, ArrowRight, Moon, Refresh } from "@element-plus/icons-vue";
import { jwxtApi } from "@/api/jwxt";
import { detectClientPlatform } from "@/utils/clientInfo";
import { USER_QQ_GROUP, USER_QQ_GROUP_HINT_KEY } from "@/utils/userGroup";
import {
  getScheduleThemePalette,
  scheduleThemeCssVars,
  type CourseTone,
} from "./scheduleTheme";
import {
  applyScheduleEditsToCells,
  courseEditKey,
  createCustomCourseId,
  emptyScheduleEdits,
  type CustomScheduleItem,
  type ScheduleEditState,
} from "@/utils/scheduleEdits";

interface ScheduleCourse {
  name: string;
  teacher?: string;
  weeks: string;
  weekList: number[];
  location?: string;
  slotNote?: string;
  startSlot?: number;
  endSlot?: number;
  sourceKey?: string;
  customId?: string;
  custom?: boolean;
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
interface LastState { semester: string; week: string; activeDay: number; viewMode?: ViewMode }
interface WeekCourseBlock { day: number; bigSlot: number; startSlot: number; endSlot: number; index: number; course: ScheduleCourse }
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
const loading = ref(Boolean(props.loading));
const scheduleSavedAt = ref(0);
const scheduleEdits = ref<ScheduleEditState>(emptyScheduleEdits());
const viewportHeight = ref(0);
const compactViewport = ref(false);
const CACHE_TTL = 12 * 60 * 60 * 1000;
const CALENDAR_CACHE_KEY = "cpu-schedule-calendar-v1";
const LAST_STATE_KEY = "cpu-jwxt-schedule-view-state-v1";
const LAST_CACHE_KEY = "cpu-schedule-last-cache-key-v1";
const scheduleCacheStore = new Map<string, CacheEnvelope<ScheduleResult>>();
const prewarmingScheduleKeys = new Set<string>();
const isNativeScheduleApp = /cpuwebscheduleapp/i.test(navigator.userAgent);
let scheduleEditsSaveTimer = 0;
let scheduleEditsLoadPromise: Promise<void> | null = null;
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
const editDialogOpen = ref(false);
const customCourseForm = reactive({
  name: "",
  day: dayOfWeek(),
  startSlot: 1,
  endSlot: 2,
  weekMode: "current" as "current" | "all" | "custom",
  weekList: [] as number[],
  weekText: "",
  location: "",
  teacher: "",
  note: "",
});
const editingCourseBlock = ref<WeekCourseBlock | null>(null);
const editingCourseKey = ref("");
const editingWeekValue = ref("");

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
const staticWeekAnimationClass = ref<"" | "week-slide-in-next" | "week-slide-in-prev">("");
let staticWeekAnimationTimer = 0;

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
  loadScheduleEdits();
  saveScheduleCache();
  saveLastState();
  prewarmAdjacentWeekCaches();
  if (selectedScheduleDiffers(next)) void loadSchedule(false);
}, { immediate: true });

onMounted(async () => {
  updateViewportHeight();
  window.addEventListener("resize", updateViewportHeight);
  window.visualViewport?.addEventListener("resize", updateViewportHeight);
  window.visualViewport?.addEventListener("scroll", updateViewportHeight);
  restoreLastState();
  restoreCachedCalendar();
  if (!parsed.value) restoreLastScheduleCache();
  if (!semester.value && parsed.value?.currentSemester) semester.value = parsed.value.currentSemester;
  if (!week.value && parsed.value?.currentWeek) week.value = String(parsed.value.currentWeek);
  loadScheduleEdits();
  await loadCalendar();
  if (parsed.value && selectedScheduleDiffers(parsed.value)) {
    await loadSchedule(false);
  } else if (!parsed.value) {
    await loadSchedule(false);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", updateViewportHeight);
  window.visualViewport?.removeEventListener("resize", updateViewportHeight);
  window.visualViewport?.removeEventListener("scroll", updateViewportHeight);
  clearStaticWeekAnimation();
  if (scheduleEditsSaveTimer) {
    window.clearTimeout(scheduleEditsSaveTimer);
    scheduleEditsSaveTimer = 0;
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
const isViewingToday = computed(() => {
  const cur = calendar.value?.currentWeek;
  if (!cur || String(cur) !== currentWeekValue()) return false;
  return viewMode.value === "week" || activeDay.value === dayOfWeek();
});
const pageStyle = computed(() => ({
  ...scheduleThemeCssVars("green"),
  ...(viewportHeight.value ? { "--schedule-vh": `${viewportHeight.value / 100}px` } : {}),
}));
const useStaticWeekSwipe = computed(() => false);
const currentCells = computed<ScheduleCell[]>(() => cellsForWeek(activeWeekNumber.value, parsed.value));
const dayCourses = computed<FlatCourse[]>(() => dayCoursesFor(activeWeekNumber.value, activeDay.value, parsed.value));
const weekCourseBlocks = computed<WeekCourseBlock[]>(() => weekCourseBlocksFor(activeWeekNumber.value, parsed.value));
const dayCourseBlocks = computed<WeekCourseBlock[]>(() => (
  dayCourseBlocksFor(activeWeekNumber.value, activeDay.value, parsed.value)
));
const editDialogWidth = computed(() => compactViewport.value ? "92vw" : "560px");
const maxWeekNumber = computed(() => {
  const values = weeks.value.map((w) => Number(w.value)).filter((v) => Number.isFinite(v) && v > 0);
  return values.length ? Math.max(...values) : 20;
});
const weekNumberOptions = computed(() => {
  const values = weeks.value.map((w) => Number(w.value)).filter((v) => Number.isFinite(v) && v > 0);
  if (values.length) return values;
  return Array.from({ length: maxWeekNumber.value }, (_, i) => i + 1);
});
const canRestoreOriginalCourse = computed(() => Boolean(editingCourseBlock.value?.course.sourceKey));
const hiddenCourseItems = computed(() => {
  const hidden = new Set(scheduleEdits.value.hidden);
  const items: Array<{ key: string; label: string }> = [];
  for (const source of allKnownScheduleSources()) {
    for (const cell of source.cells ?? []) {
      for (const course of cell.courses ?? []) {
        const key = courseEditKey(cell.day, cell.bigSlot, course);
        if (!hidden.has(key) || items.some((item) => item.key === key)) continue;
        items.push({ key, label: `${course.name} · ${dayLabel(cell.day)}` });
      }
    }
  }
  return items;
});
const carouselPages = computed<SchedulePageModel[]>(() => {
  const deltas = useStaticWeekSwipe.value ? [0] : [-1, 0, 1];
  return deltas.map((delta) => (viewMode.value === "week" ? weekPageModel(delta) : dayPageModel(delta)));
});
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
    loadScheduleEdits();
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

async function jumpToToday() {
  if (viewMode.value === "week") {
    await jumpToCurrentWeek();
    return;
  }
  viewMode.value = "day";
  if (!calendar.value?.currentWeek) {
    slideDirection.value = dayOfWeek() >= activeDay.value ? "next" : "prev";
    activeDay.value = dayOfWeek();
    saveLastState();
    return;
  }
  await jumpToCurrentWeek();
}

async function jumpToCurrentWeek() {
  const cur = calendar.value?.currentWeek;
  if (!cur) return;
  const today = dayOfWeek();
  if (String(cur) === week.value) {
    slideDirection.value = today >= activeDay.value ? "next" : "prev";
    activeDay.value = today;
    saveLastState();
    return;
  }
  slideDirection.value = Number(week.value || cur) > cur ? "prev" : "next";
  week.value = String(cur);
  activeDay.value = today;
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

function onCourseBlockClick(event: MouseEvent, block: WeekCourseBlock, targetWeek = week.value) {
  if (dragState.suppressClick || dragState.dragging || dragState.settling) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  event.stopPropagation();
  if (targetWeek && targetWeek !== week.value) {
    week.value = targetWeek;
    saveLastState();
  }
  if (!ensureScheduleEditEnabled()) return;
  openCourseEditor(block, targetWeek);
}

function onWeekSlotClick(event: MouseEvent, day: number, slot: number, targetWeek = week.value) {
  if (dragState.suppressClick || dragState.dragging || dragState.settling) {
    event.preventDefault();
    return;
  }
  if (targetWeek && targetWeek !== week.value) {
    week.value = targetWeek;
    saveLastState();
  }
  if (!ensureScheduleEditEnabled()) return;
  openAddCourse(day, slot, targetWeek);
}

function onDaySlotClick(event: MouseEvent, day: number, slot: number, targetWeek = week.value) {
  if (dragState.suppressClick || dragState.dragging || dragState.settling) {
    event.preventDefault();
    return;
  }
  if (!ensureScheduleEditEnabled()) return;
  openAddCourse(day, slot, targetWeek);
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
  if (useStaticWeekSwipe.value) {
    await applyStaticWeekSwipe(direction);
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

async function applyStaticWeekSwipe(delta: number) {
  dragCommitDelta = 0;
  if (dragCommitTimer) {
    window.clearTimeout(dragCommitTimer);
    dragCommitTimer = 0;
  }
  clearStaticWeekAnimation();
  dragState.tracking = false;
  dragState.dragging = false;
  dragState.settling = true;
  setDragClasses(false, true);
  setStaticWeekOffset(0);
  try {
    await applyDragChange(delta);
    await nextTick();
    setStaticWeekOffset(0);
    staticWeekAnimationClass.value = delta > 0 ? "week-slide-in-next" : "week-slide-in-prev";
    staticWeekAnimationTimer = window.setTimeout(() => {
      staticWeekAnimationTimer = 0;
      staticWeekAnimationClass.value = "";
      resetDrag();
    }, 220);
  } catch (error) {
    resetDrag();
    throw error;
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
  clearStaticWeekAnimation();
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
  if (useStaticWeekSwipe.value) {
    setStaticWeekOffset(easeStaticWeekOffset(offsetX));
    return;
  }
  const track = carouselTrackRef.value;
  if (!track) return;
  track.style.transform = `translate3d(calc(-33.333333% + ${offsetX}px), 0, 0)`;
}

function clearTrackOffset() {
  if (useStaticWeekSwipe.value) {
    clearStaticWeekOffset();
    return;
  }
  const track = carouselTrackRef.value;
  if (!track) return;
  track.style.transform = "";
}

function easeStaticWeekOffset(offsetX: number) {
  const maxOffset = Math.min(58, Math.max(30, dragState.width * 0.16));
  const eased = offsetX * 0.36;
  return Math.max(-maxOffset, Math.min(maxOffset, eased));
}

function setStaticWeekOffset(offsetX: number) {
  contentRef.value?.style.setProperty("--static-week-offset", `${offsetX}px`);
}

function clearStaticWeekOffset() {
  contentRef.value?.style.removeProperty("--static-week-offset");
}

function clearStaticWeekAnimation() {
  if (staticWeekAnimationTimer) {
    window.clearTimeout(staticWeekAnimationTimer);
    staticWeekAnimationTimer = 0;
  }
  staticWeekAnimationClass.value = "";
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

function updateViewportHeight() {
  const visualHeight = window.visualViewport?.height ?? window.innerHeight;
  const height = Math.min(visualHeight, window.innerHeight);
  viewportHeight.value = Math.max(0, Math.round(height || 0));
  compactViewport.value = window.matchMedia?.("(max-width: 760px)").matches ?? window.innerWidth <= 760;
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
  return applyScheduleEditsToCells((source?.cells ?? []), scheduleEdits.value)
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
      blocks.push({ day: cell.day, bigSlot: cell.bigSlot, startSlot: range.start, endSlot: range.end, index, course });
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

function courseFamilyKey(day: number, bigSlot: number, course: ScheduleCourse) {
  return [
    "jwxt-family",
    day,
    bigSlot,
    course.startSlot ?? "",
    course.endSlot ?? "",
    normalizeKeyPart(course.name),
    normalizeKeyPart(course.teacher),
    normalizeKeyPart(course.location),
  ].join("|");
}

function dayLabel(day: number) {
  return ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][day - 1] ?? `周${day}`;
}

function hasScheduleEditAuth() {
  try {
    return Boolean(localStorage.getItem("cpu-web-token"));
  } catch {
    return false;
  }
}

function canUseScheduleEdit() {
  const client = detectClientPlatform();
  return (client === "android" || client === "ios") && hasScheduleEditAuth();
}

function ensureScheduleEditEnabled() {
  return canUseScheduleEdit();
}

async function restoreHiddenCourse(key: string) {
  await loadScheduleEdits();
  try {
    await ElMessageBox.confirm("确定恢复这门已编辑课程吗？恢复后会重新出现在课表里。", "恢复已编辑课程", {
      confirmButtonText: "恢复",
      cancelButtonText: "取消",
      type: "warning",
    });
  } catch {
    return;
  }
  scheduleEdits.value = {
    ...scheduleEdits.value,
    hidden: scheduleEdits.value.hidden.filter((item) => item !== key),
  };
  persistScheduleEdits();
}

async function openAddCourse(day = activeDay.value, slot = 1, targetWeek = currentWeekValue()) {
  if (!ensureScheduleEditEnabled()) return;
  await loadScheduleEdits();
  editingCourseBlock.value = null;
  editingCourseKey.value = "";
  editingWeekValue.value = String(targetWeek || currentWeekValue());
  customCourseForm.name = "";
  customCourseForm.day = day;
  customCourseForm.startSlot = clampSlot(slot);
  customCourseForm.endSlot = Math.min(MAX_SMALL_SLOT, customCourseForm.startSlot + 1);
  customCourseForm.weekMode = "current";
  customCourseForm.weekList = [Number(editingWeekValue.value || activeWeekNumber.value || week.value || 1)].filter(Boolean);
  customCourseForm.weekText = customCourseWeeksText(customCourseForm.weekList);
  customCourseForm.location = "";
  customCourseForm.teacher = "";
  customCourseForm.note = "";
  editDialogOpen.value = true;
}

async function openCourseEditor(block: WeekCourseBlock, targetWeek = currentWeekValue()) {
  if (!ensureScheduleEditEnabled()) return;
  await loadScheduleEdits();
  editingCourseBlock.value = block;
  editingCourseKey.value = courseEditKey(block.day, block.bigSlot, block.course);
  editingWeekValue.value = String(targetWeek || currentWeekValue());
  customCourseForm.name = block.course.name;
  customCourseForm.day = block.day;
  customCourseForm.startSlot = block.startSlot;
  customCourseForm.endSlot = block.endSlot;
  customCourseForm.location = block.course.location || "";
  customCourseForm.teacher = block.course.teacher || "";
  customCourseForm.note = noteFromCourse(block.course);
  setFormWeeksFromCourse(block.course);
  editDialogOpen.value = true;
}

function saveCourseEdit() {
  const name = customCourseForm.name.trim();
  if (!name) {
    ElMessage.warning("请填写课程名称");
    return;
  }
  const startSlot = clampSlot(customCourseForm.startSlot);
  const endSlot = Math.max(startSlot, clampSlot(customCourseForm.endSlot));
  const weekList = customCourseWeekList();
  if (customCourseForm.weekMode === "custom" && !weekList.length) {
    ElMessage.warning("请选择周次");
    return;
  }
  const existing = editingCourseBlock.value?.course.customId
    ? scheduleEdits.value.custom.find((item) => item.id === editingCourseBlock.value?.course.customId)
    : null;
  const item: CustomScheduleItem = {
    id: existing?.id || createCustomCourseId(),
    sourceKey: existing?.sourceKey || editingCourseKey.value || undefined,
    day: customCourseForm.day,
    bigSlot: Math.ceil(startSlot / 2),
    course: {
      name,
      teacher: customCourseForm.teacher.trim() || undefined,
      location: customCourseForm.location.trim() || undefined,
      weeks: customCourseWeeksLabel(weekList),
      weekList,
      startSlot,
      endSlot,
      slotNote: customCourseForm.note.trim() || `第 ${startSlot}-${endSlot} 节`,
    },
  };
  const custom = scheduleEdits.value.custom.filter((entry) => {
    if (entry.id === item.id) return false;
    return Boolean(item.sourceKey) && entry.sourceKey === item.sourceKey ? false : true;
  });
  const hidden = [...scheduleEdits.value.hidden];
  if (editingCourseBlock.value && !editingCourseBlock.value.course.customId && item.sourceKey && !hidden.includes(item.sourceKey)) {
    hidden.push(item.sourceKey);
  }
  scheduleEdits.value = { hidden, custom: [...custom, item] };
  persistScheduleEdits();
  editDialogOpen.value = false;
  ElMessage.success(editingCourseBlock.value ? "已保存课程" : "已添加到课表");
}

async function deleteEditingCourse() {
  await loadScheduleEdits();
  const block = editingCourseBlock.value;
  if (!block) return;
  let next = { ...scheduleEdits.value };
  const targetFamilyKey = courseFamilyKey(block.day, block.bigSlot, block.course);
  const hiddenKeysToRemove = new Set<string>();
  for (const source of allKnownScheduleSources()) {
    for (const cell of source.cells ?? []) {
      for (const course of cell.courses ?? []) {
        if (courseFamilyKey(cell.day, cell.bigSlot, course) !== targetFamilyKey) continue;
        hiddenKeysToRemove.add(courseEditKey(cell.day, cell.bigSlot, course));
      }
    }
  }
  if (block.course.customId) {
    next = {
      ...next,
      custom: next.custom.filter((item) => courseFamilyKey(item.day, item.bigSlot, item.course) !== targetFamilyKey),
    };
  } else {
    next = {
      hidden: next.hidden.filter((key) => !hiddenKeysToRemove.has(key)),
      custom: next.custom.filter((item) => courseFamilyKey(item.day, item.bigSlot, item.course) !== targetFamilyKey),
    };
  }
  scheduleEdits.value = next;
  persistScheduleEdits();
  editDialogOpen.value = false;
  ElMessage.success("已从课表隐藏");
}

async function restoreOriginalCourse() {
  await loadScheduleEdits();
  const sourceKey = editingCourseBlock.value?.course.sourceKey;
  const customId = editingCourseBlock.value?.course.customId;
  if (!sourceKey) return;
  scheduleEdits.value = {
    hidden: scheduleEdits.value.hidden.filter((key) => key !== sourceKey),
    custom: scheduleEdits.value.custom.filter((item) => item.id !== customId && item.sourceKey !== sourceKey),
  };
  persistScheduleEdits();
  editDialogOpen.value = false;
  ElMessage.success("已恢复原始课程");
}

function setFormWeeksFromCourse(course: ScheduleCourse) {
  const list = Array.isArray(course.weekList) ? [...course.weekList].filter(Boolean).sort((a, b) => a - b) : [];
  const all = weekNumberOptions.value;
  const current = Number(editingWeekValue.value || activeWeekNumber.value || week.value || 1);
  if (!list.length || (all.length > 0 && list.length === all.length && all.every((w) => list.includes(w)))) {
    customCourseForm.weekMode = "all";
    customCourseForm.weekList = [...all];
    customCourseForm.weekText = customCourseWeeksText(customCourseForm.weekList);
    return;
  }
  if (list.length === 1 && list[0] === current) {
    customCourseForm.weekMode = "current";
    customCourseForm.weekList = list;
    customCourseForm.weekText = customCourseWeeksText(list);
    return;
  }
  customCourseForm.weekMode = "custom";
  customCourseForm.weekList = list;
  customCourseForm.weekText = customCourseWeeksText(list);
}

function customCourseWeekList() {
  if (customCourseForm.weekMode === "all") return weekNumberOptions.value;
  if (customCourseForm.weekMode === "custom") {
    return [...new Set(customCourseForm.weekList.map(Number).filter(Boolean))].sort((a, b) => a - b);
  }
  return [Number(editingWeekValue.value || activeWeekNumber.value || week.value) || 1];
}

function toggleCustomWeek(weekNo: number) {
  const set = new Set(customCourseForm.weekList);
  if (set.has(weekNo)) set.delete(weekNo);
  else set.add(weekNo);
  customCourseForm.weekList = [...set].sort((a, b) => a - b);
  customCourseForm.weekText = customCourseWeeksText(customCourseForm.weekList);
}

function customCourseWeeksLabel(weekList: number[]) {
  if (!weekList.length) return "全部周";
  if (weekList.length === 1) return `第 ${weekList[0]} 周`;
  const sorted = [...weekList].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (const value of sorted.slice(1)) {
    if (value === prev + 1) {
      prev = value;
      continue;
    }
    ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = value;
    prev = value;
  }
  ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
  return `第 ${ranges.join("、")} 周`;
}

function customCourseWeeksText(weekList: number[]) {
  return [...new Set(weekList.map(Number).filter(Boolean))].sort((a, b) => a - b).join(",");
}

function noteFromCourse(course: ScheduleCourse) {
  const note = course.slotNote?.trim() || "";
  return /^第\s*\d+\s*-\s*\d+\s*节$/.test(note) ? "" : note;
}

function clampSlot(value: number) {
  return Math.max(1, Math.min(MAX_SMALL_SLOT, Number(value) || 1));
}

function loadScheduleEdits() {
  if (scheduleEditsLoadPromise) return scheduleEditsLoadPromise;
  const sem = semester.value || parsed.value?.currentSemester || "current";
  scheduleEditsLoadPromise = (async () => {
    try {
      const r = await jwxtApi.getScheduleEdits(sem, { silent: true });
      scheduleEdits.value = normalizeScheduleEditsState(r.edits);
    } catch {
      scheduleEdits.value = emptyScheduleEdits();
    } finally {
      scheduleEditsLoadPromise = null;
    }
  })();
  return scheduleEditsLoadPromise;
}

function persistScheduleEdits() {
  if (!canUseScheduleEdit()) return;
  const sem = semester.value || parsed.value?.currentSemester || "current";
  scheduleEdits.value = normalizeScheduleEditsState(scheduleEdits.value);
  if (scheduleEditsSaveTimer) window.clearTimeout(scheduleEditsSaveTimer);
  scheduleEditsSaveTimer = window.setTimeout(() => {
    scheduleEditsSaveTimer = 0;
    const payload = normalizeScheduleEditsState(scheduleEdits.value);
    void jwxtApi.saveScheduleEdits({ semester: sem, edits: payload }, { silent: true });
  }, 160);
}

function normalizeScheduleEditsState(input: ScheduleEditState | null | undefined): ScheduleEditState {
  const hidden = Array.isArray(input?.hidden)
    ? [...new Set(input.hidden.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()))]
    : [];
  const custom = Array.isArray(input?.custom)
    ? input.custom
      .filter((item) => Boolean(
        item &&
        typeof item.id === "string" &&
        Number.isFinite(item.day) &&
        Number.isFinite(item.bigSlot) &&
        item.course &&
        typeof item.course.name === "string" &&
        Array.isArray(item.course.weekList)
      ))
      .map((item) => ({
        ...item,
        id: String(item.id).trim(),
        sourceKey: item.sourceKey?.trim() || undefined,
        course: {
          ...item.course,
          name: String(item.course.name || "").trim(),
          teacher: item.course.teacher?.trim() || undefined,
          location: item.course.location?.trim() || undefined,
          weeks: String(item.course.weeks || "").trim() || "全部周",
          weekList: [...new Set(item.course.weekList.map((w) => Number(w)).filter((w) => Number.isFinite(w) && w > 0))].sort((a, b) => a - b),
          slotNote: item.course.slotNote?.trim() || undefined,
          startSlot: Number.isFinite(item.course.startSlot) ? Number(item.course.startSlot) : undefined,
          endSlot: Number.isFinite(item.course.endSlot) ? Number(item.course.endSlot) : undefined,
        },
      }))
    : [];
  return { hidden, custom };
}

function allKnownScheduleSources() {
  const sources: ScheduleResult[] = [];
  if (parsed.value) sources.push(parsed.value);
  for (const envelope of scheduleCacheStore.values()) {
    if (envelope.data && !sources.includes(envelope.data)) sources.push(envelope.data);
  }
  return sources;
}

function selectedScheduleDiffers(data: ScheduleResult) {
  const semesterDiffers = Boolean(semester.value && data.currentSemester && semester.value !== data.currentSemester);
  const weekDiffers = Boolean(week.value && data.currentWeek && String(week.value) !== String(data.currentWeek));
  return semesterDiffers || weekDiffers;
}

function toneFor(name: string): CourseTone {
  const theme = getScheduleThemePalette("green");
  return { bg: theme.courseBg, border: theme.courseBorder, text: theme.courseText };
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

function normalizeKeyPart(value?: string) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
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
  loadScheduleEdits();
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
  position: relative;
  overflow: hidden;
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
  border-color: var(--schedule-accent);
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
  -webkit-tap-highlight-color: var(--schedule-accent-soft-hover);
}

.view-switch button.active {
  background: var(--schedule-accent);
  color: var(--schedule-accent-contrast);
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
  -webkit-tap-highlight-color: var(--schedule-accent-soft-hover);
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.icon-btn:active { background: #f3f4f6; }

.icon-btn.active {
  background: var(--schedule-accent);
  border-color: var(--schedule-accent);
  color: var(--schedule-accent-contrast);
}

.icon-btn.spinning .el-icon {
  animation: spin 0.9s linear infinite;
}

.icon-btn .el-icon {
  font-size: 18px;
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
  background: var(--schedule-accent-pale);
  color: var(--schedule-accent-strong);
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
  -webkit-tap-highlight-color: var(--schedule-accent-soft-hover);
  transition: background 0.15s;
}

.week-title.clickable:hover,
.week-title.clickable:active {
  background: var(--schedule-accent-pale-hover);
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
  border-color: var(--schedule-accent-border);
}

.day-pill.active {
  background: var(--schedule-accent);
  border-color: var(--schedule-accent);
  color: var(--schedule-accent-contrast);
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
  color: var(--schedule-accent);
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
.schedule-pane.is-static-week-swipe.view-week .content.settling .schedule-panel.active {
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
.schedule-pane.is-static-week-swipe.view-week .carousel-viewport {
  overflow: visible;
  contain: none;
}
.schedule-pane.is-static-week-swipe.view-week .carousel-track {
  display: block;
  width: 100%;
  transform: none !important;
  transition: none !important;
  will-change: auto;
  backface-visibility: visible;
  transform-style: flat;
}
.schedule-pane.is-static-week-swipe.view-week .schedule-panel {
  contain: none;
  transform: none;
}
.schedule-pane.is-static-week-swipe.view-week .schedule-panel.active {
  pointer-events: auto;
  transform: translate3d(var(--static-week-offset, 0), 0, 0);
}
.schedule-pane.is-static-week-swipe.view-week .schedule-panel.week-slide-in-next,
.schedule-pane.is-static-week-swipe.view-week .schedule-panel.week-slide-in-prev {
  animation-duration: 220ms;
  animation-timing-function: cubic-bezier(0.2, 0, 0.2, 1);
  animation-fill-mode: both;
}
.schedule-pane.is-static-week-swipe.view-week .schedule-panel.week-slide-in-next {
  animation-name: weekSlideInNext;
}
.schedule-pane.is-static-week-swipe.view-week .schedule-panel.week-slide-in-prev {
  animation-name: weekSlideInPrev;
}

@keyframes weekSlideInNext {
  from {
    opacity: 0.9;
    transform: translate3d(22px, 0, 0);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}

@keyframes weekSlideInPrev {
  from {
    opacity: 0.9;
    transform: translate3d(-22px, 0, 0);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .schedule-pane.is-static-week-swipe.view-week .schedule-panel.week-slide-in-next,
  .schedule-pane.is-static-week-swipe.view-week .schedule-panel.week-slide-in-prev {
    animation: none;
  }
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
  grid-template-rows: repeat(11, minmax(58px, calc(var(--schedule-vh, 1vh) * 6.2)));
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
  cursor: pointer;
  touch-action: manipulation;
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
.schedule-pane.is-native-app.view-week .week-grid-head {
  position: static;
  top: auto;
  z-index: auto;
  background: #f7fbff;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
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
  border-color: var(--schedule-accent);
  background: var(--schedule-accent-pale);
  color: var(--schedule-accent-strong);
}

.week-grid-body {
  position: relative;
  grid-template-rows: repeat(11, minmax(48px, calc(var(--schedule-vh, 1vh) * 5.8)));
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
  cursor: pointer;
  touch-action: manipulation;
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
  -webkit-tap-highlight-color: var(--schedule-accent-soft-hover);
}

.week-cell:active { background: #f3f4f6; }
.week-cell.current { border-color: var(--schedule-accent); color: var(--schedule-accent); }

.week-cell.active {
  background: var(--schedule-accent);
  border-color: var(--schedule-accent);
  color: var(--schedule-accent-contrast);
}

.course-editor-overlay {
  position: fixed;
  inset: 0;
  z-index: 4000;
  background: rgba(16, 24, 40, 0.08);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 0 8px 8px;
}

.course-editor-panel {
  width: 100%;
  height: auto;
  max-height: min(92svh, 760px);
  max-height: min(92dvh, 760px);
  max-width: 720px;
  background: #f6f7fb;
  color: #0f172a;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 22px;
  box-shadow: 0 12px 36px rgba(15, 23, 42, 0.16);
}

.course-editor-enter-active,
.course-editor-leave-active {
  transition: background-color 0.22s ease;
}

.course-editor-enter-active .course-editor-panel,
.course-editor-leave-active .course-editor-panel {
  transition: transform 0.24s cubic-bezier(0.2, 0, 0.2, 1), opacity 0.2s ease;
}

.course-editor-enter-from,
.course-editor-leave-to {
  background: rgba(16, 24, 40, 0);
}

.course-editor-enter-from .course-editor-panel,
.course-editor-leave-to .course-editor-panel {
  opacity: 0.98;
  transform: translateY(100%);
}

.course-editor-nav {
  flex: none;
  display: grid;
  grid-template-columns: 68px minmax(0, 1fr) 68px;
  align-items: center;
  gap: 6px;
  padding: 10px 12px 8px;
}

.course-editor-nav h2 {
  margin: 0;
  text-align: center;
  font-size: 17px;
  line-height: 1.2;
  font-weight: 650;
  color: #0b1220;
}

.course-editor-nav button {
  border: 0;
  border-radius: 15px;
  background: rgba(255, 255, 255, 0.76);
  color: #111827;
  min-height: 36px;
  padding: 0 10px;
  font: inherit;
  font-size: 14px;
  font-weight: 560;
  box-shadow: none;
}

.course-editor-nav button.primary {
  color: #0f766e;
}

.course-editor-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  max-height: none;
  padding: 0 12px calc(12px + env(safe-area-inset-bottom));
}

.editor-card {
  overflow: hidden;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 1px 0 rgba(15, 23, 42, 0.02);
}

.editor-row {
  min-height: 52px;
  display: grid;
  grid-template-columns: 86px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  margin: 0 14px;
  border-bottom: 1px solid #e7e9ee;
}

.editor-row:last-child {
  border-bottom: 0;
}

.editor-row span,
.editor-card-title,
.editor-section-title span {
  font-size: 17px;
  font-weight: 560;
  color: #0b1220;
}

.editor-row input,
.editor-row select {
  min-width: 0;
  width: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  color: #0b1220;
  font: inherit;
  font-size: 17px;
  font-weight: 500;
  text-align: right;
}

.editor-row input::placeholder {
  color: #b9bec8;
}

.editor-row select {
  appearance: none;
  -webkit-appearance: none;
  direction: rtl;
}

.slot-range-input {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.slot-range-input input {
  width: 46px;
  text-align: center;
}

.slot-range-input em,
.slot-range-input b {
  font-style: normal;
  color: #0b1220;
  font-size: 17px;
  font-weight: 500;
}

.editor-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 14px 8px;
}

.editor-actions {
  display: flex;
  align-items: center;
  gap: 16px;
}

.editor-section-title button {
  border: 0;
  background: transparent;
  color: #0f766e;
  font: inherit;
  font-size: 15px;
  font-weight: 650;
}

.editor-section-title button.danger {
  color: #f04455;
}

.editor-week-picker {
  display: grid;
  grid-template-columns: 70px minmax(0, 1fr);
  align-items: start;
  gap: 12px;
  margin: 0 18px;
  padding: 15px 0;
  border-bottom: 1px solid #e7e9ee;
}

.editor-week-picker > span {
  font-size: 16px;
  font-weight: 650;
  color: #0b1220;
  padding-top: 5px;
}

.week-chip-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 6px;
  max-height: 130px;
  overflow-y: auto;
  padding-right: 2px;
}

.week-chip-grid button {
  min-width: 0;
  min-height: 30px;
  border: 1px solid #d8dee8;
  border-radius: 9px;
  background: #fff;
  color: #475467;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
}

.week-chip-grid button.active {
  border-color: var(--schedule-accent);
  background: var(--schedule-accent-pale);
  color: var(--schedule-accent-strong);
}

.hidden-restore-card {
  margin-top: 18px;
  padding: 16px 18px;
}

.hidden-restore-card .hidden-list {
  margin-top: 12px;
}

.hidden-restore-card .hidden-list button {
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  background: #fff;
  color: #475467;
  padding: 7px 10px;
  font: inherit;
  font-size: 13px;
}

@media (min-width: 761px) {
  .course-editor-overlay {
    align-items: center;
    padding: 24px;
  }

  .course-editor-panel {
    height: auto;
    max-height: min(760px, 90vh);
    border-radius: 24px;
  }
}

@media (max-width: 380px) {
  .editor-week-picker {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .editor-week-picker > span {
    padding-top: 0;
  }
}

.edit-section {
  display: grid;
  gap: 10px;
  margin-bottom: 16px;
}

:global(.schedule-edit-dialog.el-dialog),
:global(.schedule-edit-dialog .el-dialog) {
  max-height: min(86vh, 680px);
  display: flex;
  flex-direction: column;
}

:global(.schedule-edit-dialog.el-dialog .el-dialog__body),
:global(.schedule-edit-dialog .el-dialog__body) {
  flex: 1;
  min-height: 0;
  max-height: none;
  overflow: auto;
}

:global(.schedule-edit-dialog.el-dialog .el-dialog__footer),
:global(.schedule-edit-dialog .el-dialog__footer) {
  flex: none;
}

.edit-section:last-child {
  margin-bottom: 0;
}

.edit-section.compact {
  padding-top: 4px;
  border-top: 1px solid #eef0f4;
}

.edit-section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.edit-section-head b {
  font-size: 14px;
  color: #172033;
}

.edit-section-head span {
  font-size: 12px;
  color: #8a94a6;
}

.edit-course-list {
  display: grid;
  gap: 8px;
  max-height: 240px;
  overflow: auto;
}

.edit-course-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid #eef0f4;
  border-radius: 8px;
  background: #fff;
}

.edit-course-row div {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.edit-course-row b {
  color: #172033;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.edit-course-row span,
.edit-course-row em {
  color: #667085;
  font-size: 12px;
  font-style: normal;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hidden-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.custom-course-form {
  display: grid;
  gap: 2px;
}

.custom-course-form :deep(.el-form-item) {
  margin-bottom: 12px;
}

.custom-course-form :deep(.el-form-item__label) {
  margin-bottom: 4px;
  line-height: 1.25;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.form-grid :deep(.el-select),
.form-grid :deep(.el-input-number) {
  width: 100%;
}

.week-list-form-item {
  grid-column: span 2;
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

  .form-grid {
    grid-template-columns: 1fr;
    gap: 0;
  }

  :global(.schedule-edit-dialog.el-dialog),
  :global(.schedule-edit-dialog .el-dialog) {
    position: fixed;
    inset: auto 0 0 0;
    width: 100vw !important;
    max-width: 100vw;
    height: min(82dvh, calc(100vh - env(safe-area-inset-top) - 18px));
    max-height: min(82dvh, calc(100vh - env(safe-area-inset-top) - 18px));
    margin: 0 !important;
    border-radius: 18px 18px 0 0;
    overflow: hidden;
  }

  :global(.schedule-edit-dialog.el-dialog .el-dialog__header),
  :global(.schedule-edit-dialog .el-dialog__header) {
    flex: none;
    padding: 14px 16px 8px;
    margin-right: 0;
  }

  :global(.schedule-edit-dialog.el-dialog .el-dialog__body),
  :global(.schedule-edit-dialog .el-dialog__body) {
    flex: 1;
    min-height: 0;
    padding: 6px 14px 10px;
    overflow: auto;
  }

  :global(.schedule-edit-dialog.el-dialog .el-dialog__footer),
  :global(.schedule-edit-dialog .el-dialog__footer) {
    position: sticky;
    bottom: 0;
    z-index: 4;
    flex: none;
    padding: 10px 14px calc(10px + env(safe-area-inset-bottom));
    border-top: 1px solid #eef0f4;
    background: #fff;
    box-shadow: 0 -8px 18px rgba(24, 34, 51, 0.06);
  }

  :global(.schedule-edit-dialog.el-dialog .el-dialog__footer .el-button),
  :global(.schedule-edit-dialog .el-dialog__footer .el-button) {
    min-width: 72px;
    margin-left: 6px;
  }

  .edit-section {
    gap: 8px;
    margin-bottom: 10px;
  }

  .custom-course-form :deep(.el-form-item) {
    margin-bottom: 8px;
  }

  .week-list-form-item {
    grid-column: auto;
  }

  .day-grid-body {
    grid-template-columns: 42px minmax(0, 1fr);
    grid-template-rows: repeat(11, minmax(52px, calc(var(--schedule-vh, 1vh) * 6)));
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
    grid-template-rows: repeat(11, minmax(44px, calc(var(--schedule-vh, 1vh) * 5.5)));
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
    grid-template-rows: repeat(11, minmax(48px, calc(var(--schedule-vh, 1vh) * 5.6)));
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
    grid-template-rows: repeat(11, minmax(40px, calc(var(--schedule-vh, 1vh) * 5.2)));
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
