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
        :disabled="loading"
        @change="onSemesterChange"
      >
        <el-option v-for="s in semesters" :key="s.value" :value="s.value" :label="s.label" />
      </el-select>
      <div v-else class="top-placeholder">课表</div>

      <div class="top-actions">
        <AcademicDataSourceBadge v-if="!isGraduateSource" :source="parsed?.source" />
        <div v-if="parsed" class="view-switch" aria-label="切换课表视图">
          <button type="button" :class="{ active: viewMode === 'day' }" :disabled="loading" @click="setViewMode('day')">日</button>
          <button type="button" :class="{ active: viewMode === 'week' }" :disabled="loading" @click="setViewMode('week')">周</button>
        </div>
        <button
          v-if="parsed"
          type="button"
          class="icon-btn"
          :class="{ active: isViewingToday }"
          :disabled="loading"
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
          :disabled="loading"
          aria-label="刷新课表"
          title="刷新课表"
          @click="refreshSchedule"
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
      <button type="button" class="week-title clickable" :disabled="loading" @click="weekDialogOpen = true">
        <b>第 {{ currentWeekValue() || "--" }} 周</b>
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
      @touchstart.passive="onScheduleTouchStart"
      @touchmove="onScheduleTouchMove"
      @touchend="onScheduleTouchEnd"
      @touchcancel="onScheduleTouchCancel"
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
      class="schedule-pane-themed-dialog"
      :style="pageStyle"
    >
      <div class="week-grid-pick">
        <button
          v-for="w in weeks"
          :key="w.value"
          type="button"
          class="week-cell"
          :class="{ active: String(w.value) === week, current: Number(w.value) === calendar?.currentWeek }"
          :disabled="loading"
          @click="selectWeek(w.value)"
        >
          {{ w.value }}
        </button>
      </div>
      <template #footer>
        <el-button v-if="canJumpToCurrentWeek" type="primary" :disabled="loading" @click="onJumpAndClose">回到本周</el-button>
        <el-button @click="weekDialogOpen = false">关闭</el-button>
      </template>
    </el-dialog>

    <Teleport to="body">
      <Transition name="course-editor">
        <div v-if="editDialogOpen" class="course-editor-overlay" :style="pageStyle" @click.self="closeCourseEditor">
          <section class="course-editor-panel" role="dialog" aria-modal="true">
            <header class="course-editor-nav">
              <button type="button" :disabled="courseEditBusy" @click="closeCourseEditor">取消</button>
              <h2>{{ editingCourseBlock ? "修改课程" : "添加课程" }}</h2>
              <button type="button" class="primary" :disabled="courseEditBusy" @click="saveCourseEdit">
                {{ courseEditAction === "save" ? "保存中" : "保存" }}
              </button>
            </header>

            <div class="course-editor-scroll">
              <section class="editor-card">
                <label class="editor-row">
                  <span>课程</span>
                  <input v-model="customCourseForm.name" maxlength="40" placeholder="课程名称" :disabled="courseEditBusy" />
                </label>
                <label class="editor-row">
                  <span>老师</span>
                  <input v-model="customCourseForm.teacher" maxlength="40" placeholder="选填" :disabled="courseEditBusy" />
                </label>
                <label class="editor-row">
                  <span>地点</span>
                  <input v-model="customCourseForm.location" maxlength="40" placeholder="选填" :disabled="courseEditBusy" />
                </label>
                <label class="editor-row">
                  <span>备注</span>
                  <input v-model="customCourseForm.note" maxlength="60" placeholder="选填" :disabled="courseEditBusy" />
                </label>
              </section>

              <div class="editor-section-title">
                <span>时间段</span>
                <div class="editor-actions">
                  <button v-if="canRestoreOriginalCourse" type="button" :disabled="courseEditBusy" @click="restoreOriginalCourse">
                    {{ courseEditAction === "restore" ? "恢复中" : "恢复原始" }}
                  </button>
                  <button v-if="editingCourseBlock" type="button" class="danger" :disabled="courseEditBusy" @click="deleteEditingCourse">
                    {{ courseEditAction === "delete" ? "删除中" : "删除" }}
                  </button>
                </div>
              </div>

              <section class="editor-card">
                <label class="editor-row">
                  <span>周数</span>
                  <select v-model="customCourseForm.weekMode" :disabled="courseEditBusy">
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
                      :disabled="courseEditBusy"
                      @click="toggleCustomWeek(w)"
                    >
                      {{ w }}
                    </button>
                  </div>
                </div>
                <label class="editor-row">
                  <span>星期</span>
                  <select v-model.number="customCourseForm.day" :disabled="courseEditBusy">
                    <option v-for="d in 7" :key="d" :value="d">{{ dayLabel(d) }}</option>
                  </select>
                </label>
                <div class="editor-row">
                  <span>时间</span>
                  <div class="slot-range-input">
                    <input v-model.number="customCourseForm.startSlot" type="number" min="1" :max="MAX_SMALL_SLOT" :disabled="courseEditBusy" />
                    <em>-</em>
                    <input v-model.number="customCourseForm.endSlot" type="number" :min="customCourseForm.startSlot" :max="MAX_SMALL_SLOT" :disabled="courseEditBusy" />
                    <b>节</b>
                  </div>
                </div>
              </section>

              <section v-if="hiddenCourseItems.length" class="editor-card hidden-restore-card">
                <div class="editor-card-title">已编辑课程</div>
                <div class="hidden-list">
                  <button v-for="item in hiddenCourseItems" :key="item.key" type="button" :disabled="courseEditBusy" @click="restoreHiddenCourse(item.key)">
                    {{ courseEditAction === "restoreHidden" ? "恢复中" : item.label }}
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
import AcademicDataSourceBadge from "@/components/jwxt/AcademicDataSourceBadge.vue";
import { jwxtApi } from "@/api/jwxt";
import { useAppearanceStore } from "@/stores/appearance";
import { useAuthStore } from "@/stores/auth";
import { useJwxtStore } from "@/stores/jwxt";
import { detectClientPlatform } from "@/utils/clientInfo";
import {
  getScheduleThemePalette,
  scheduleThemeCssVars,
  scheduleThemeDarkCssVars,
  type CourseTone,
} from "./scheduleTheme";
import {
  applyScheduleEditsToCells,
  courseEditKey,
  createCustomCourseId,
  customCourseWeeksLabel,
  customCourseWeeksText,
  emptyScheduleEdits,
  normalizeScheduleEditsState,
  noteFromCourse,
  type CustomScheduleItem,
  type ScheduleEditState,
} from "@/utils/scheduleEdits";
import { courseMatchesWeek, normalizedCourseWeekList } from "@/utils/scheduleWeeks";
import { isOriginalCourseEditUnchanged } from "@/views/schedule/courseEditor";
import {
  claimOfficialScheduleChangeNotice,
  detectOfficialScheduleChange,
} from "@/views/schedule/scheduleChanges";
import {
  buildScheduleCacheKey,
  isStale,
  JWXT_PANE_LAST_STATE_CACHE_BASE,
  readCache,
  readStoredLastScheduleCacheKey,
  readStoredLastState,
  scheduleCalendarCacheKey,
  scheduleLastCacheKey,
  scheduleLastStateCacheKey,
  writeCache,
  writeStoredLastScheduleCacheKey,
  writeStoredLastState,
} from "@/views/schedule/cache";
import {
  buildGraduateFallbackCalendar,
  calendarWeekForNumber,
  dayOfWeek,
  extendScheduleWeeksToCalendar,
  formatCacheTime,
  hydrateCalendar,
  normalizeCalendarWeekDays,
  officialGraduateSemesterCalendarFor,
  resolveGraduateActiveDay,
  resolveGraduateInitialWeek,
  shortDate,
  todayKey,
} from "@/views/schedule/calendar";
import { resolveSwipeIntent, type SwipeIntent } from "@/views/schedule/swipeGesture";
import { DEFAULT_SCHEDULE_VIEW_MODE, resolveScheduleViewMode } from "@/views/schedule/types";
import type {
  CalendarResult,
  CacheEnvelope,
  FlatCourse,
  ScheduleCell,
  ScheduleCourse,
  SchedulePageModel,
  ScheduleResult,
  ViewMode,
  WeekCourseBlock,
} from "@/views/schedule/types";

const props = withDefaults(defineProps<{
  data: any;
  loading?: boolean;
  source?: "jwxt" | "graduate";
}>(), {
  source: "jwxt",
});
const jwxt = useJwxtStore();
const appearance = useAppearanceStore();

const graduateSourceMeta = ref<{
  mode?: "live" | "debug" | "debug-fallback";
  path?: string;
  savedAt?: string;
  fetchedAt?: string;
  semester?: string;
  termcode?: string;
} | null>(null);
const initialScheduleBundle = normalizeIncomingScheduleData(props.data, props.source);
const parsed = ref<ScheduleResult | null>(initialScheduleBundle.parsed);
const calendar = ref<CalendarResult | null>(initialScheduleBundle.calendar);
const semester = ref("");
const week = ref("");
const activeDay = ref(dayOfWeek());
const viewMode = ref<ViewMode>(DEFAULT_SCHEDULE_VIEW_MODE);
const loading = ref(Boolean(props.loading));
const scheduleSavedAt = ref(0);
const scheduleEdits = ref<ScheduleEditState>(emptyScheduleEdits());
const viewportHeight = ref(0);
const compactViewport = ref(false);
const scheduleCacheStore = new Map<string, CacheEnvelope<ScheduleResult>>();
const prewarmingScheduleKeys = new Set<string>();
const isNativeScheduleApp = ["android", "harmony", "ios"].includes(detectClientPlatform());
let scheduleEditsSaveTimer = 0;
let scheduleEditsLoadPromise: Promise<void> | null = null;
let pendingScheduleEditsSave: { semester: string; edits: ScheduleEditState } | null = null;
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
const isGraduateSource = computed(() => props.source === "graduate");
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
type CourseEditAction = "" | "save" | "delete" | "restore" | "restoreHidden";
const courseEditAction = ref<CourseEditAction>("");
const courseEditBusy = computed(() => courseEditAction.value !== "");

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
  axis: "pending" as SwipeIntent,
});
const touchGesture: {
  tracking: boolean;
  identifier: number;
  startX: number;
  startY: number;
  intent: SwipeIntent;
} = {
  tracking: false,
  identifier: -1,
  startX: 0,
  startY: 0,
  intent: "pending",
};
let dragOffsetX = 0;
let dragLastX = 0;
let dragLastTime = 0;
let dragVelocityX = 0;
let dragFrame = 0;
let pendingTrackOffset = 0;
let dragCommitDelta = 0;
let dragCommitTimer = 0;
let dragResetTimer = 0;
let dragSuppressClickTimer = 0;
let dragCaptureTarget: HTMLElement | null = null;
const staticWeekAnimationClass = ref<"" | "week-slide-in-next" | "week-slide-in-prev">("");
let staticWeekAnimationTimer = 0;
let scheduleLoadSeq = 0;
let foregroundScheduleLoadSeq = 0;
let disposed = false;
const activePageScrollKey = computed(() => (
  viewMode.value === "week"
    ? `week:${currentWeekValue()}`
    : `day:${currentWeekValue()}:${activeDay.value}`
));

function normalizeIncomingScheduleData(rawData: any, source: "jwxt" | "graduate") {
  if (source !== "graduate") {
    graduateSourceMeta.value = null;
    return {
      parsed: (rawData?.parsed ?? null) as ScheduleResult | null,
      calendar: hydrateCalendar(rawData?.calendar ?? null),
    };
  }
  graduateSourceMeta.value = rawData?.source ?? null;
  const fallbackCalendar = hydrateCalendar(rawData?.calendar ?? buildGraduateFallbackCalendar(rawData?.parsed ?? null));
  return {
    parsed: extendScheduleWeeksToCalendar(rawData?.parsed ?? null, fallbackCalendar),
    calendar: fallbackCalendar,
  };
}

watch(() => props.loading, (v) => {
  loading.value = Boolean(v);
}, { immediate: true });

watch([() => props.data, () => props.source], ([data, source]) => {
  const normalized = normalizeIncomingScheduleData(data, source);
  const next = normalized.parsed;
  if (!next) return;
  parsed.value = next;
  if (normalized.calendar) calendar.value = normalized.calendar;
  if (!semester.value || !next.semesters.some((s) => s.value === semester.value)) {
    semester.value = next.currentSemester || "";
  }
  if (source === "graduate") {
    const initialWeek = resolveGraduateInitialWeek(next, calendar.value);
    if (!week.value || !next.weeks.some((w) => String(w.value) === week.value)) {
      week.value = initialWeek;
    }
    activeDay.value = resolveGraduateActiveDay(next, week.value || initialWeek, calendar.value);
  } else if (!week.value || !next.weeks.some((w) => String(w.value) === week.value)) {
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
  disposed = false;
  updateViewportHeight();
  window.addEventListener("resize", updateViewportHeight);
  window.visualViewport?.addEventListener("resize", updateViewportHeight);
  window.visualViewport?.addEventListener("scroll", updateViewportHeight);
  restoreLastState();
  restoreCachedCalendar();
  if (!parsed.value) restoreLastScheduleCache();
  if (!semester.value && parsed.value?.currentSemester) semester.value = parsed.value.currentSemester;
  if (!week.value) {
    if (isGraduateSource.value) {
      week.value = resolveGraduateInitialWeek(parsed.value, calendar.value);
      activeDay.value = resolveGraduateActiveDay(parsed.value, week.value, calendar.value);
    } else if (parsed.value?.currentWeek) {
      week.value = String(parsed.value.currentWeek);
    }
  }
  loadScheduleEdits();
  await loadCalendar();
  if (disposed) return;
  if (parsed.value && selectedScheduleDiffers(parsed.value)) {
    await loadSchedule(false);
  } else if (!parsed.value) {
    await loadSchedule(false);
  }
});

onBeforeUnmount(() => {
  disposed = true;
  scheduleLoadSeq += 1;
  foregroundScheduleLoadSeq = scheduleLoadSeq;
  loading.value = false;
  window.removeEventListener("resize", updateViewportHeight);
  window.visualViewport?.removeEventListener("resize", updateViewportHeight);
  window.visualViewport?.removeEventListener("scroll", updateViewportHeight);
  clearDragTimers();
  clearStaticWeekAnimation();
  flushScheduleEditsSave();
});

const semesters = computed(() => parsed.value?.semesters ?? []);
const weeks = computed(() => parsed.value?.weeks ?? []);
const currentWeekInfo = computed(() => weekInfoFor(currentWeekValue()));
const currentWeekRange = computed(() => weekRangeFor(currentWeekValue()));
const dayTabs = computed(() => dayTabsForWeek(currentWeekValue()));
const activeDayLabel = computed(() => dayTabs.value.find((d) => d.day === activeDay.value)?.label ?? "今日");
const cacheText = computed(() => {
  const parts: string[] = [];
  if (isGraduateSource.value) {
    if (graduateSourceMeta.value?.mode === "debug-fallback") parts.push("研究生本地样例回退");
    else parts.push("研究生实时课表");
    parts.push(officialGraduateSemesterCalendarFor(semester.value || parsed.value?.currentSemester || "") ? "日期来自官方校历" : "日期为推算");
    if (graduateSourceMeta.value?.fetchedAt) parts.push(`实时同步 ${formatCacheTime(Date.parse(graduateSourceMeta.value.fetchedAt))}`);
  }
  if (scheduleSavedAt.value) parts.push(`本地缓存 ${formatCacheTime(scheduleSavedAt.value)}`);
  return parts.join(" · ");
});
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
  ...(appearance.isDark ? {
    ...scheduleThemeDarkCssVars("green"),
    "--schedule-surface-bg": "rgba(26, 41, 37, 0.94)",
    "--schedule-surface-bg-soft": "rgba(32, 49, 44, 0.88)",
    "--schedule-text": "#eef8f5",
    "--schedule-text-secondary": "#abc5be",
    "--schedule-text-muted": "#819d95",
    "--schedule-border": "rgba(163, 186, 179, 0.28)",
    "--schedule-cell-bg": "rgba(30, 48, 43, 0.52)",
    "--schedule-cell-bg-strong": "rgba(38, 58, 52, 0.68)",
    "--schedule-cell-border": "rgba(163, 186, 179, 0.20)",
    "--schedule-panel-shadow": "0 14px 34px rgba(0, 0, 0, 0.22)",
  } : {
    "--schedule-surface-bg": "#ffffff",
    "--schedule-surface-bg-soft": "#f9fafb",
    "--schedule-text": "#172033",
    "--schedule-text-secondary": "#667085",
    "--schedule-text-muted": "#8a94a6",
    "--schedule-border": "#dde4ee",
    "--schedule-cell-bg": "rgba(255, 255, 255, 0.36)",
    "--schedule-cell-bg-strong": "rgba(255, 255, 255, 0.56)",
    "--schedule-cell-border": "rgba(218, 227, 239, 0.82)",
    "--schedule-panel-shadow": "0 10px 24px rgba(24, 34, 51, 0.08)",
  }),
  ...(viewportHeight.value ? { "--schedule-vh": `${viewportHeight.value / 100}px` } : {}),
}));
const useStaticWeekSwipe = computed(() => false);
const currentCells = computed<ScheduleCell[]>(() => cellsForWeek(activeWeekNumber.value, parsed.value));
const dayCourses = computed<FlatCourse[]>(() => dayCoursesFor(activeWeekNumber.value, activeDay.value, parsed.value));
const weekCourseBlocks = computed<WeekCourseBlock[]>(() => weekCourseBlocksFor(activeWeekNumber.value, parsed.value));
const dayCourseBlocks = computed<WeekCourseBlock[]>(() => (
  dayCourseBlocksFor(activeWeekNumber.value, activeDay.value, parsed.value)
));
const editDialogWidth = computed(() => compactViewport.value ? "92dvw" : "560px");
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
  const seenFamilies = new Set<string>();
  for (const source of allKnownScheduleSources()) {
    for (const cell of source.cells ?? []) {
      for (const course of cell.courses ?? []) {
        const key = courseEditKey(cell.day, cell.bigSlot, course);
        if (!hidden.has(key)) continue;
        const familyKey = courseFamilyKey(cell.day, cell.bigSlot, course);
        if (seenFamilies.has(familyKey)) continue;
        seenFamilies.add(familyKey);
        items.push({ key: familyKey, label: `${course.name} · ${dayLabel(cell.day)}` });
      }
    }
  }
  return items;
});
const carouselPages = computed<SchedulePageModel[]>(() => {
  const deltas = useStaticWeekSwipe.value ? [0] : [-1, 0, 1];
  return deltas.map((delta) => (viewMode.value === "week" ? weekPageModel(delta) : dayPageModel(delta)));
});
watch(activePageScrollKey, (value, previousValue) => {
  if (!previousValue || value === previousValue) return;
  void nextTick(() => resetActiveScheduleBodyScroll());
});
const canJumpToCurrentWeek = computed(() => {
  const cur = calendar.value?.currentWeek;
  return Boolean(cur && String(cur) !== week.value);
});

async function loadCalendar(targetSemester = semester.value || parsed.value?.currentSemester || "") {
  if (disposed) return;
  const requestedSemester = String(targetSemester || "").trim();
  const hadCache = restoreCachedCalendar(requestedSemester);
  if (!hadCache && requestedSemester && calendar.value?.currentSemester !== requestedSemester) {
    calendar.value = null;
  }
  if (isGraduateSource.value) {
    const normalized = normalizeIncomingScheduleData({ parsed: parsed.value, source: graduateSourceMeta.value, calendar: calendar.value }, "graduate");
    if (disposed) return;
    if (normalized.calendar) {
      calendar.value = normalized.calendar;
      writeCache(calendarCacheKey(parsed.value?.currentSemester), calendar.value);
      if (!week.value) week.value = resolveGraduateInitialWeek(parsed.value, calendar.value);
    }
    return;
  }
  try {
    const r: any = await jwxt.withSessionRetry(() => jwxtApi.calendar(
      requestedSemester ? { semester: requestedSemester } : undefined,
    ));
    if (disposed) return;
    if (requestedSemester && semester.value && semester.value !== requestedSemester) return;
    const nextCalendar = hydrateCalendar(r.parsed);
    if (requestedSemester && nextCalendar?.currentSemester && nextCalendar.currentSemester !== requestedSemester) return;
    calendar.value = nextCalendar;
    writeCache(calendarCacheKey(nextCalendar?.currentSemester || requestedSemester), calendar.value);
    if (!week.value) week.value = currentWeekValue();
  } catch {
    /* calendar is best effort */
  }
}

async function loadSchedule(force = false, background = false) {
  if (disposed) return;
  if (loading.value && !background) return;
  const hadCache = !force && restoreScheduleCache();
  if (hadCache) {
    saveLastState();
  }
  const requestSeq = ++scheduleLoadSeq;
  const requestedSemester = semester.value || parsed.value?.currentSemester || "";
  const requestedWeek = week.value || "";
  if (!background) {
    foregroundScheduleLoadSeq = requestSeq;
    loading.value = true;
  }
  try {
    if (isGraduateSource.value) {
      const raw = await jwxt.withSessionRetry(() => jwxtApi.graduateSchedule({
        semester: semester.value || undefined,
        refresh: force || background || hadCache ? "1" : undefined,
      }));
      if (!isCurrentScheduleLoad(requestSeq, requestedSemester, requestedWeek)) return;
      if (disposed) return;
      const normalized = normalizeIncomingScheduleData(raw, "graduate");
      parsed.value = normalized.parsed;
      calendar.value = normalized.calendar;
      if (!semester.value) semester.value = parsed.value?.currentSemester ?? "";
      const initialWeek = resolveGraduateInitialWeek(parsed.value, calendar.value);
      if (!week.value || !parsed.value?.weeks.some((item) => String(item.value) === week.value)) {
        week.value = initialWeek;
      }
      activeDay.value = resolveGraduateActiveDay(parsed.value, week.value || initialWeek, calendar.value);
      loadScheduleEdits();
      scheduleSavedAt.value = Date.now();
      if (calendar.value) writeCache(calendarCacheKey(), calendar.value);
      saveScheduleCache();
      saveLastState();
      return;
    }
    const r: any = await jwxt.withSessionRetry(() => jwxtApi.schedule({
      semester: semester.value,
      week: week.value,
      refresh: force || background || hadCache ? "1" : undefined,
    }));
    if (disposed) return;
    if (!isCurrentScheduleLoad(requestSeq, requestedSemester, requestedWeek)) {
      if (r?.parsed) writeScheduleCache(scheduleCacheKey(r.parsed.currentSemester || requestedSemester, requestedWeek), r.parsed);
      return;
    }
    parsed.value = r.parsed;
    if (!semester.value) semester.value = parsed.value?.currentSemester ?? "";
    if (!week.value) week.value = currentWeekValue();
    loadScheduleEdits();
    scheduleSavedAt.value = Date.now();
    saveScheduleCache();
    saveLastState();
    prewarmAdjacentWeekCaches();
  } finally {
    if (!disposed && !background && requestSeq === foregroundScheduleLoadSeq) loading.value = false;
  }
}

function isCurrentScheduleLoad(seq: number, requestedSemester: string, requestedWeek: string) {
  if (disposed) return false;
  if (seq !== scheduleLoadSeq) return false;
  if (requestedSemester && semester.value && semester.value !== requestedSemester) return false;
  if (!isGraduateSource.value && requestedWeek && week.value && week.value !== requestedWeek) return false;
  return true;
}

async function onSemesterChange() {
  await Promise.all([
    loadCalendar(semester.value),
    loadSchedule(true),
  ]);
}

async function refreshSchedule() {
  await loadCalendar(semester.value);
  if (disposed) return;
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
  syncGraduateActiveDayForWeek(next);
  saveLastState();
  weekDialogOpen.value = false;
  const key = scheduleCacheKey(semester.value || parsed.value?.currentSemester, next);
  const cached = scheduleCacheStore.get(key) ?? readCache<ScheduleResult>(key);
  if (cached?.data) {
    applyScheduleCache(key);
    void loadSchedule(false, true);
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
  syncGraduateActiveDayForWeek(next);
  saveLastState();
  const key = scheduleCacheKey(semester.value || parsed.value?.currentSemester, next);
  const cached = scheduleCacheStore.get(key) ?? readCache<ScheduleResult>(key);
  if (cached?.data) {
    applyScheduleCache(key);
    void loadSchedule(false, true);
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
    void loadSchedule(false, true);
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
  dragState.axis = "pending";
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
  dragState.axis = resolveSwipeIntent(dx, dy, dragState.axis);
  const dt = Math.max(1, now - dragLastTime);
  dragVelocityX = (event.clientX - dragLastX) / dt;
  dragLastX = event.clientX;
  dragLastTime = now;
  if (dragState.axis === "horizontal" && event.cancelable) event.preventDefault();
  if (!dragState.dragging) {
    if (dragState.axis === "vertical") {
      resetDrag();
      return;
    }
    if (dragState.axis !== "horizontal") return;
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
    scheduleDragReset();
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
  resetTouchGesture();
  releaseDragPointer();
  animateDragTo(0);
  scheduleDragReset();
}

function onScheduleTouchStart(event: TouchEvent) {
  if (props.loading || dragState.settling || event.touches.length !== 1) {
    resetTouchGesture();
    return;
  }
  const touch = event.touches.item(0);
  if (!touch) return;
  touchGesture.tracking = true;
  touchGesture.identifier = touch.identifier;
  touchGesture.startX = touch.clientX;
  touchGesture.startY = touch.clientY;
  touchGesture.intent = "pending";
}

function onScheduleTouchMove(event: TouchEvent) {
  if (!touchGesture.tracking) return;
  const touch = trackedTouch(event.touches);
  if (!touch) return;
  touchGesture.intent = resolveSwipeIntent(
    touch.clientX - touchGesture.startX,
    touch.clientY - touchGesture.startY,
    touchGesture.intent,
  );
  if (touchGesture.intent === "horizontal" && event.cancelable) event.preventDefault();
}

function onScheduleTouchEnd(event: TouchEvent) {
  if (!trackedTouch(event.touches)) resetTouchGesture();
}

function onScheduleTouchCancel() {
  resetTouchGesture();
}

function trackedTouch(touches: TouchList) {
  for (let index = 0; index < touches.length; index += 1) {
    const touch = touches.item(index);
    if (touch?.identifier === touchGesture.identifier) return touch;
  }
  return null;
}

function resetTouchGesture() {
  touchGesture.tracking = false;
  touchGesture.identifier = -1;
  touchGesture.intent = "pending";
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
  dragFrame = window.requestAnimationFrame(() => {
    dragFrame = 0;
    setTrackOffset(targetX);
  });
}

function resetDrag() {
  releaseDragPointer();
  clearDragTimers();
  clearStaticWeekAnimation();
  dragCommitDelta = 0;
  dragState.tracking = false;
  dragState.dragging = false;
  dragState.settling = false;
  dragState.pointerId = -1;
  dragState.offsetX = 0;
  dragState.axis = "pending";
  dragOffsetX = 0;
  dragVelocityX = 0;
  setDragClasses(false, false);
  clearTrackOffset();
  dragSuppressClickTimer = window.setTimeout(() => {
    dragSuppressClickTimer = 0;
    dragState.suppressClick = false;
  }, 220);
}

function scheduleDragReset() {
  if (dragResetTimer) window.clearTimeout(dragResetTimer);
  dragResetTimer = window.setTimeout(() => {
    dragResetTimer = 0;
    resetDrag();
  }, 180);
}

function clearDragTimers() {
  if (dragFrame) {
    window.cancelAnimationFrame(dragFrame);
    dragFrame = 0;
  }
  if (dragCommitTimer) {
    window.clearTimeout(dragCommitTimer);
    dragCommitTimer = 0;
  }
  if (dragResetTimer) {
    window.clearTimeout(dragResetTimer);
    dragResetTimer = 0;
  }
  if (dragSuppressClickTimer) {
    window.clearTimeout(dragSuppressClickTimer);
    dragSuppressClickTimer = 0;
  }
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

function resetActiveScheduleBodyScroll() {
  const scrollBody = contentRef.value?.querySelector<HTMLElement>(".schedule-panel.active .schedule-body-scroll");
  if (!scrollBody) return;
  scrollBody.scrollTop = 0;
}

function updateViewportHeight() {
  const visualHeight = window.visualViewport?.height ?? window.innerHeight;
  const height = Math.min(visualHeight, window.innerHeight);
  viewportHeight.value = Math.max(0, Math.round(height || 0));
  compactViewport.value = window.matchMedia?.("(max-width: 760px)").matches ?? window.innerWidth <= 760;
}

function weekInfoFor(value: string | number) {
  const fallback = buildGraduateFallbackCalendar(parsed.value);
  const target = Number(value || calendar.value?.currentWeek || fallback?.currentWeek || parsed.value?.currentWeek || 0);
  if (!Number.isFinite(target) || target <= 0) return null;
  return calendarWeekForNumber(calendar.value, target)
    ?? calendarWeekForNumber(fallback, target)
    ?? null;
}

function weekRangeFor(value: string | number) {
  const w = weekInfoFor(value);
  if (!w || w.days.length < 7) return "";
  const dates = normalizeCalendarWeekDays(w.days);
  const monday = dates[0];
  const sunday = dates[6];
  return `${shortDate(monday)} - ${shortDate(sunday)}`;
}

function dayTabsForWeek(value: string | number) {
  const labels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const dates = normalizeCalendarWeekDays(weekInfoFor(value)?.days ?? []);
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
  const byCourse = new Map<string, WeekCourseBlock[]>();
  for (const cell of cellsForWeek(wk, source)) {
    cell.courses.forEach((course, index) => {
      const range = normalizeSlotRangeForTablePosition(cell.bigSlot, course);
      const key = [
        cell.day,
        normalizeKeyPart(course.name),
        normalizeKeyPart(course.teacher),
        normalizeKeyPart(course.location),
        normalizeKeyPart(course.weeks),
      ].join("|");
      const list = byCourse.get(key) ?? [];
      list.push({ day: cell.day, bigSlot: cell.bigSlot, startSlot: range.start, endSlot: range.end, index, course });
      byCourse.set(key, list);
    });
  }
  const blocks: WeekCourseBlock[] = [];
  for (const list of byCourse.values()) {
    for (const block of mergeContinuousCourseBlocks(list)) blocks.push(block);
  }
  return blocks.sort((a, b) => a.startSlot - b.startSlot || a.day - b.day || a.index - b.index);
}

function dayCourseBlocksFor(wk: number, day: number, source: ScheduleResult | null = parsed.value) {
  return weekCourseBlocksFor(wk, source).filter((block) => block.day === day);
}

function syncGraduateActiveDayForWeek(targetWeek = week.value) {
  if (!isGraduateSource.value || !parsed.value) return;
  const weekNo = Number(targetWeek || 0);
  if (!weekNo) return;
  if (dayCourseBlocksFor(weekNo, activeDay.value, parsed.value).length) return;
  activeDay.value = resolveGraduateActiveDay(parsed.value, String(targetWeek || ""), calendar.value);
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
  const fallback = buildGraduateFallbackCalendar(parsed.value);
  return week.value
    || String(calendar.value?.currentWeek || "")
    || String(fallback?.currentWeek || "")
    || String(parsed.value?.currentWeek || "")
    || String(parsed.value?.weeks.find((item) => item.current)?.value || "")
    || String(parsed.value?.weeks[0]?.value || "");
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

function courseFamilyKey(day: number, bigSlot: number, course: ScheduleCourse) {
  const range = normalizeSlotRange(bigSlot, course);
  return [
    "jwxt-family",
    day,
    range.start,
    range.end,
    normalizeKeyPart(course.name),
    normalizeKeyPart(course.teacher),
    normalizeKeyPart(course.location),
  ].join("|");
}

function courseFamilySourceKeys(day: number, bigSlot: number, course: ScheduleCourse) {
  const targetFamilyKey = courseFamilyKey(day, bigSlot, course);
  const keys = new Set<string>();
  for (const source of allKnownScheduleSources()) {
    for (const cell of source.cells ?? []) {
      for (const sourceCourse of cell.courses ?? []) {
        if (courseFamilyKey(cell.day, cell.bigSlot, sourceCourse) !== targetFamilyKey) continue;
        keys.add(courseEditKey(cell.day, cell.bigSlot, sourceCourse));
      }
    }
  }
  return keys;
}

function dayLabel(day: number) {
  return ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][day - 1] ?? `周${day}`;
}

function hasScheduleEditAuth() {
  return useAuthStore().isLoggedIn;
}

function canUseScheduleEdit() {
  const client = detectClientPlatform();
  if (isGraduateSource.value) return false;
  return (client === "android" || client === "ios" || client === "harmony") && hasScheduleEditAuth();
}

function ensureScheduleEditEnabled() {
  return canUseScheduleEdit();
}

function showEditorMessage(type: "success" | "warning", message: string) {
  ElMessage({ type, message, offset: 96 });
}

function closeCourseEditor() {
  if (courseEditBusy.value) return;
  editDialogOpen.value = false;
}

async function restoreHiddenCourse(key: string) {
  if (courseEditBusy.value) return;
  courseEditAction.value = "restoreHidden";
  try {
    await loadScheduleEdits();
    const confirmed = await ElMessageBox.confirm("确定恢复这门已编辑课程吗？恢复后会重新出现在课表里。", "恢复已编辑课程", {
      confirmButtonText: "恢复",
      cancelButtonText: "取消",
      type: "warning",
    }).then(() => true).catch(() => false);
    if (!confirmed) return;
    const keysToRestore = new Set<string>();
    for (const source of allKnownScheduleSources()) {
      for (const cell of source.cells ?? []) {
        for (const course of cell.courses ?? []) {
          const sourceKey = courseEditKey(cell.day, cell.bigSlot, course);
          if (sourceKey === key || courseFamilyKey(cell.day, cell.bigSlot, course) === key) {
            keysToRestore.add(sourceKey);
          }
        }
      }
    }
    keysToRestore.add(key);
    scheduleEdits.value = {
      ...scheduleEdits.value,
      hidden: scheduleEdits.value.hidden.filter((item) => !keysToRestore.has(item)),
    };
    persistScheduleEdits();
  } finally {
    if (courseEditAction.value === "restoreHidden") courseEditAction.value = "";
  }
}

async function openAddCourse(day = activeDay.value, slot = 1, targetWeek = currentWeekValue()) {
  if (courseEditBusy.value) return;
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
  if (courseEditBusy.value) return;
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
  if (courseEditBusy.value) return;
  const name = customCourseForm.name.trim();
  if (!name) {
    showEditorMessage("warning", "请填写课程名称");
    return;
  }
  const startSlot = clampSlot(customCourseForm.startSlot);
  const endSlot = Math.max(startSlot, clampSlot(customCourseForm.endSlot));
  const weekList = customCourseWeekList();
  if (customCourseForm.weekMode === "custom" && !weekList.length) {
    showEditorMessage("warning", "请选择周次");
    return;
  }
  courseEditAction.value = "save";
  try {
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
    const editingBlock = editingCourseBlock.value;
    if (editingBlock && isOriginalCourseEditUnchanged(editingBlock, item, weekNumberOptions.value)) {
      editDialogOpen.value = false;
      showEditorMessage("success", "课程没有变化，无需保存");
      return;
    }
    const editingFamilyKey = editingBlock ? courseFamilyKey(editingBlock.day, editingBlock.bigSlot, editingBlock.course) : "";
    const hiddenSourceKeys = new Set<string>();
    if (editingBlock && !editingBlock.course.customId) {
      for (const key of courseFamilySourceKeys(editingBlock.day, editingBlock.bigSlot, editingBlock.course)) {
        hiddenSourceKeys.add(key);
      }
      if (item.sourceKey) hiddenSourceKeys.add(item.sourceKey);
      if (editingCourseKey.value) hiddenSourceKeys.add(editingCourseKey.value);
    }
    const custom = scheduleEdits.value.custom.filter((entry) => {
      if (entry.id === item.id) return false;
      if (Boolean(item.sourceKey) && entry.sourceKey === item.sourceKey) return false;
      if (editingFamilyKey && courseFamilyKey(entry.day, entry.bigSlot, entry.course) === editingFamilyKey) return false;
      return true;
    });
    const hidden = [...new Set([...scheduleEdits.value.hidden, ...hiddenSourceKeys])];
    scheduleEdits.value = { hidden, custom: [...custom, item] };
    persistScheduleEdits();
    editDialogOpen.value = false;
    showEditorMessage("success", editingCourseBlock.value ? "已保存课程" : "已添加到课表");
  } finally {
    if (courseEditAction.value === "save") courseEditAction.value = "";
  }
}

async function deleteEditingCourse() {
  if (courseEditBusy.value) return;
  courseEditAction.value = "delete";
  try {
    await loadScheduleEdits();
    const block = editingCourseBlock.value;
    if (!block) return;
    const confirmed = await ElMessageBox.confirm(
      block.course.customId ? "确定删除这门自定义课程吗？删除后会从课表中移除。" : "确定隐藏这门课程吗？隐藏后可在已编辑课程中恢复。",
      block.course.customId ? "删除自定义课程" : "隐藏课程",
      {
        confirmButtonText: block.course.customId ? "删除" : "隐藏",
        cancelButtonText: "取消",
        type: "warning",
      },
    ).then(() => true).catch(() => false);
    if (!confirmed) return;
    let next = { ...scheduleEdits.value };
    const targetFamilyKey = courseFamilyKey(block.day, block.bigSlot, block.course);
    const hiddenKeysToRemove = courseFamilySourceKeys(block.day, block.bigSlot, block.course);
    hiddenKeysToRemove.add(editingCourseKey.value || courseEditKey(block.day, block.bigSlot, block.course));
    if (block.course.customId) {
      next = {
        ...next,
        custom: next.custom.filter((item) => courseFamilyKey(item.day, item.bigSlot, item.course) !== targetFamilyKey),
      };
    } else {
      next = {
        hidden: [...new Set([...next.hidden, ...hiddenKeysToRemove])],
        custom: next.custom.filter((item) => courseFamilyKey(item.day, item.bigSlot, item.course) !== targetFamilyKey),
      };
    }
    scheduleEdits.value = next;
    persistScheduleEdits();
    editDialogOpen.value = false;
    showEditorMessage("success", block.course.customId ? "已删除课程" : "已从课表隐藏");
  } finally {
    if (courseEditAction.value === "delete") courseEditAction.value = "";
  }
}

async function restoreOriginalCourse() {
  if (courseEditBusy.value) return;
  courseEditAction.value = "restore";
  try {
    await loadScheduleEdits();
    const block = editingCourseBlock.value;
    const sourceKey = block?.course.sourceKey;
    const customId = block?.course.customId;
    if (!sourceKey) return;
    const confirmed = await ElMessageBox.confirm("确定恢复原始课程吗？当前自定义修改会被移除。", "恢复原始课程", {
      confirmButtonText: "恢复",
      cancelButtonText: "取消",
      type: "warning",
    }).then(() => true).catch(() => false);
    if (!confirmed) return;
    const keysToRestore = block ? courseFamilySourceKeys(block.day, block.bigSlot, block.course) : new Set<string>();
    keysToRestore.add(sourceKey);
    const familyKey = block ? courseFamilyKey(block.day, block.bigSlot, block.course) : "";
    scheduleEdits.value = {
      hidden: scheduleEdits.value.hidden.filter((key) => !keysToRestore.has(key)),
      custom: scheduleEdits.value.custom.filter((item) => (
        item.id !== customId &&
        item.sourceKey !== sourceKey &&
        (!familyKey || courseFamilyKey(item.day, item.bigSlot, item.course) !== familyKey)
      )),
    };
    persistScheduleEdits();
    editDialogOpen.value = false;
    showEditorMessage("success", "已恢复原始课程");
  } finally {
    if (courseEditAction.value === "restore") courseEditAction.value = "";
  }
}

function setFormWeeksFromCourse(course: ScheduleCourse) {
  const list = normalizedCourseWeekList(course);
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
  if (courseEditBusy.value) return;
  const set = new Set(customCourseForm.weekList);
  if (set.has(weekNo)) set.delete(weekNo);
  else set.add(weekNo);
  customCourseForm.weekList = [...set].sort((a, b) => a - b);
  customCourseForm.weekText = customCourseWeeksText(customCourseForm.weekList);
}

function clampSlot(value: number) {
  return Math.max(1, Math.min(MAX_SMALL_SLOT, Number(value) || 1));
}

function loadScheduleEdits() {
  if (disposed) return Promise.resolve();
  if (!canUseScheduleEdit()) {
    scheduleEdits.value = emptyScheduleEdits();
    return Promise.resolve();
  }
  if (scheduleEditsLoadPromise) return scheduleEditsLoadPromise;
  const sem = semester.value || parsed.value?.currentSemester || "current";
  scheduleEditsLoadPromise = (async () => {
    try {
      const r = await jwxtApi.getScheduleEdits(sem, { silent: true });
      if (disposed) return;
      scheduleEdits.value = normalizeScheduleEditsState(r.edits);
    } catch {
      if (disposed) return;
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
  pendingScheduleEditsSave = {
    semester: sem,
    edits: normalizeScheduleEditsState(scheduleEdits.value),
  };
  if (scheduleEditsSaveTimer) window.clearTimeout(scheduleEditsSaveTimer);
  scheduleEditsSaveTimer = window.setTimeout(() => {
    flushScheduleEditsSave();
  }, 160);
}

function flushScheduleEditsSave() {
  if (scheduleEditsSaveTimer) {
    window.clearTimeout(scheduleEditsSaveTimer);
    scheduleEditsSaveTimer = 0;
  }
  const pending = pendingScheduleEditsSave;
  if (!pending) return;
  pendingScheduleEditsSave = null;
  void jwxtApi.saveScheduleEdits({ semester: pending.semester, edits: pending.edits }, { silent: true })
    .catch(() => null);
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
  if (isGraduateSource.value) return semesterDiffers;
  const weekDiffers = Boolean(week.value && data.currentWeek && String(week.value) !== String(data.currentWeek));
  return semesterDiffers || weekDiffers;
}

function toneFor(name: string): CourseTone {
  const theme = getScheduleThemePalette("green");
  if (appearance.isDark) {
    return {
      bg: "var(--schedule-course-bg)",
      border: "var(--schedule-course-border)",
      text: "var(--schedule-course-text)",
    };
  }
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

function normalizeSlotRangeForTablePosition(bigSlot: number, course: ScheduleCourse) {
  const range = normalizeSlotRange(bigSlot, course);
  const fallbackStart = Math.max(1, Math.min(MAX_SMALL_SLOT, bigSlot * 2 - 1));
  const fallbackEnd = Math.max(fallbackStart, Math.min(MAX_SMALL_SLOT, bigSlot * 2));
  const overlapsCurrentBigSlot = range.end >= fallbackStart && range.start <= fallbackEnd;
  return overlapsCurrentBigSlot ? range : { start: fallbackStart, end: fallbackEnd };
}

function mergeContinuousCourseBlocks(list: WeekCourseBlock[]) {
  const sorted = [...list].sort((a, b) => a.day - b.day || a.startSlot - b.startSlot || a.endSlot - b.endSlot);
  const merged: WeekCourseBlock[] = [];
  for (const block of sorted) {
    const prev = merged[merged.length - 1];
    if (prev && block.startSlot <= prev.endSlot + 1) {
      prev.startSlot = Math.min(prev.startSlot, block.startSlot);
      prev.endSlot = Math.max(prev.endSlot, block.endSlot);
      prev.bigSlot = Math.max(1, Math.ceil(prev.startSlot / 2));
      prev.course = {
        ...prev.course,
        startSlot: prev.startSlot,
        endSlot: prev.endSlot,
        slotNote: formatSlotNote(prev.startSlot, prev.endSlot),
      };
    } else {
      merged.push({
        ...block,
        bigSlot: Math.max(1, Math.ceil(block.startSlot / 2)),
        course: {
          ...block.course,
          startSlot: block.startSlot,
          endSlot: block.endSlot,
          slotNote: formatSlotNote(block.startSlot, block.endSlot),
        },
      });
    }
  }
  return merged;
}

function formatSlotNote(start: number, end: number) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return start === end ? `${pad(start)}节` : `${pad(start)}-${pad(end)}节`;
}

function normalizeKeyPart(value?: string) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function courseBlockStyle(block: WeekCourseBlock) {
  const colors = toneFor(block.course.name);
  return {
    gridColumn: `${block.day + 1} / ${block.day + 2}`,
    gridRow: `${block.startSlot} / ${block.endSlot + 1}`,
    "--course-bg": colors.bg,
    "--course-border": colors.border,
    "--course-text": colors.text,
  };
}

function dayCourseBlockStyle(block: WeekCourseBlock) {
  const colors = toneFor(block.course.name);
  return {
    gridColumn: "2 / 3",
    gridRow: `${block.startSlot} / ${block.endSlot + 1}`,
    "--course-bg": colors.bg,
    "--course-border": colors.border,
    "--course-text": colors.text,
  };
}

function scheduleCacheKey(sem = semester.value, wk = week.value) {
  return buildScheduleCacheKey({
    scope: props.source,
    semester: sem,
    week: wk,
    currentSemester: parsed.value?.currentSemester,
    currentWeek: parsed.value?.currentWeek,
    calendarWeek: calendar.value?.currentWeek,
    graduate: isGraduateSource.value,
  });
}

function writeScheduleCache(key: string, data: ScheduleResult) {
  if (!isGraduateSource.value) {
    const previous = scheduleCacheStore.get(key) ?? readCache<ScheduleResult>(key);
    notifyOfficialScheduleChange(previous?.data, data);
  }
  const envelope = writeCache(key, data);
  if (envelope) rememberScheduleCache(key, envelope);
}

function notifyOfficialScheduleChange(previous: ScheduleResult | undefined, next: ScheduleResult) {
  const change = detectOfficialScheduleChange(previous, next);
  if (!change || !claimOfficialScheduleChangeNotice(change)) return;
  ElMessage({
    type: "warning",
    message: "检测到教务课表已更新，请核对课程时间、周次和地点。",
    duration: 10_000,
    showClose: true,
    offset: 96,
  });
}

function rememberScheduleCache(key: string, envelope: CacheEnvelope<ScheduleResult>) {
  scheduleCacheStore.set(key, envelope);
}

function calendarCacheKey(sem = semester.value || parsed.value?.currentSemester || "") {
  return scheduleCalendarCacheKey(props.source, sem);
}

function lastStateCacheKey() {
  return scheduleLastStateCacheKey(props.source, JWXT_PANE_LAST_STATE_CACHE_BASE);
}

function lastScheduleCacheKey() {
  return scheduleLastCacheKey(props.source);
}

function restoreCachedCalendar(sem = semester.value || parsed.value?.currentSemester || "") {
  const cached = readCache<CalendarResult>(calendarCacheKey(sem));
  if (!cached?.data) return false;
  calendar.value = hydrateCalendar(cached.data);
  return true;
}

function restoreLastState() {
  const state = readStoredLastState(lastStateCacheKey());
  if (!state) return;
  if (props.source !== "graduate") {
    if (state.semester) semester.value = state.semester;
    if (state.week) week.value = state.week;
  }
  if (state.activeDay >= 1 && state.activeDay <= 7) activeDay.value = state.activeDay;
  viewMode.value = resolveScheduleViewMode(state.viewMode);
}

function saveLastState() {
  writeStoredLastState(lastStateCacheKey(), {
    semester: semester.value,
    week: week.value,
    activeDay: activeDay.value,
    viewMode: viewMode.value,
  });
}

function restoreLastScheduleCache() {
  const key = readStoredLastScheduleCacheKey(lastScheduleCacheKey());
  return key ? applyScheduleCache(key) : false;
}

function restoreScheduleCache() {
  const key = scheduleCacheKey();
  return applyScheduleCache(key) || (!parsed.value && restoreLastScheduleCache());
}

function applyScheduleCache(key: string) {
  if (!key) return false;
  const cached = readCache<ScheduleResult>(key);
  if (!cached?.data) return false;
  rememberScheduleCache(key, cached);
  parsed.value = cached.data;
  if (isGraduateSource.value) {
    const normalized = normalizeIncomingScheduleData(
      { parsed: cached.data, source: graduateSourceMeta.value, calendar: calendar.value },
      "graduate",
    );
    parsed.value = normalized.parsed;
    if (normalized.calendar) calendar.value = normalized.calendar;
  }
  scheduleSavedAt.value = cached.savedAt;
  if (!semester.value) semester.value = cached.data.currentSemester || "";
  if (!week.value) {
    week.value = isGraduateSource.value
      ? resolveGraduateInitialWeek(parsed.value, calendar.value)
      : String(cached.data.currentWeek || "");
  }
  syncGraduateActiveDayForWeek(week.value);
  loadScheduleEdits();
  prewarmAdjacentWeekCaches();
  return true;
}

function saveScheduleCache() {
  if (!parsed.value) return;
  const key = scheduleCacheKey(parsed.value.currentSemester || semester.value, week.value || parsed.value.currentWeek);
  writeScheduleCache(key, parsed.value);
  const lastKey = lastScheduleCacheKey();
  writeStoredLastScheduleCacheKey(lastKey, key);
}

function prewarmAdjacentWeekCaches() {
  if (isGraduateSource.value) return;
  if (!parsed.value || !semester.value) return;
  const current = currentWeekValue();
  [nextWeekValueFrom(current, -1), nextWeekValueFrom(current, 1)]
    .filter(Boolean)
    .forEach((wk) => prewarmScheduleCacheForWeek(wk));
}

function prewarmScheduleCacheForWeek(wk: string) {
  if (isGraduateSource.value) return;
  const key = scheduleCacheKey(parsed.value?.currentSemester || semester.value, wk);
  if (!key) return;
  const cached = scheduleCacheStore.get(key) ?? readCache<ScheduleResult>(key);
  if (cached?.data && !isStale(cached.savedAt)) {
    if (!scheduleCacheStore.has(key)) rememberScheduleCache(key, cached);
    return;
  }
  if (prewarmingScheduleKeys.has(key)) return;
  prewarmingScheduleKeys.add(key);
  void jwxt.withSessionRetry(() => jwxtApi.schedule({ semester: semester.value, week: wk }))
    .then((r: any) => {
      if (r?.parsed) writeScheduleCache(key, r.parsed);
    })
    .finally(() => {
      prewarmingScheduleKeys.delete(key);
    });
}
</script>

<style scoped lang="scss" src="./styles/schedule-pane-shell.scss"></style>
<style scoped lang="scss" src="./styles/schedule-pane-grid.scss"></style>
<style scoped lang="scss" src="./styles/schedule-pane-editor.scss"></style>
<style scoped lang="scss" src="./styles/schedule-pane-responsive.scss"></style>
