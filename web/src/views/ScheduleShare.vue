<template>
  <!-- 别人的课表，只能查看。用的是读取方自己选的课表风格和配色，按发布者自己的校历排。 -->
  <main class="shared-schedule-page" :class="{ 'is-dark': appearance.isDark }" :style="pageStyle">
    <header class="shared-head">
      <div class="shared-title">
        <p class="eyebrow">{{ revoked ? "共享课表 · 分享已撤销，不会再更新" : "共享课表 · 只能查看" }}</p>
        <h1>{{ displayName }}</h1>
        <p v-if="shared" class="shared-meta">{{ metaLine }}</p>
      </div>
      <div class="head-actions">
        <el-button v-if="shared && !savedCopy && !revoked" type="primary" @click="saveToLibrary">保存到我的共享列表</el-button>
        <el-button v-else-if="savedCopy" @click="renameSaved">修改备注</el-button>
        <el-button @click="$router.push('/schedule')">我的课表</el-button>
      </div>
    </header>

    <el-alert v-if="error" type="error" :closable="false" :title="error" />
    <div v-else-if="loading && !shared" class="loading-state"><el-skeleton :rows="8" animated /></div>

    <template v-else-if="shared">
      <section class="shared-toolbar">
        <div class="shared-switch" aria-label="切换课表视图">
          <button type="button" :class="{ active: viewMode === 'day' }" @click="setViewMode('day')">日</button>
          <button type="button" :class="{ active: viewMode === 'week' }" @click="setViewMode('week')">周</button>
          <button type="button" :class="{ active: viewMode === 'month' }" @click="setViewMode('month')">月</button>
        </div>
        <div class="shared-pager">
          <button type="button" :disabled="!canStep(-1)" :aria-label="stepLabel(-1)" @click="step(-1)"><el-icon><ArrowLeft /></el-icon></button>
          <b>{{ pagerTitle }}<small v-if="pagerRange">{{ pagerRange }}</small></b>
          <button type="button" :disabled="!canStep(1)" :aria-label="stepLabel(1)" @click="step(1)"><el-icon><ArrowRight /></el-icon></button>
        </div>
        <button type="button" class="shared-today" :class="{ active: viewingToday }" @click="jumpToToday">今天</button>
      </section>
      <p v-if="adjustmentSummary && viewMode !== 'month'" class="shared-adjustments">{{ adjustmentSummary }}</p>

      <section v-if="viewMode === 'day'" class="shared-days" aria-label="选择星期">
        <button
          v-for="tab in dayTabs"
          :key="tab.day"
          type="button"
          :class="{ active: tab.day === activeDay, today: tab.isToday }"
          @click="activeDay = tab.day"
        >
          <span>{{ tab.label }}</span><b>{{ tab.date || "--" }}</b>
        </button>
      </section>

      <section class="shared-body">
        <StyledWeekGrid
          v-if="viewMode === 'week'"
          :visual-style="visualStyle"
          :palette="palette"
          :dark="appearance.isDark"
          :days="styledDays"
          :clocks="clocks"
          :now-minutes="nowMinutes"
          @course="(block) => openQuickLook(block)"
          @day="openDay"
        />
        <StyledDayView
          v-else-if="viewMode === 'day'"
          :visual-style="visualStyle"
          :palette="palette"
          :dark="appearance.isDark"
          :day="activeDay"
          :pieces="dayPieces"
          :clocks="clocks"
          :now-minutes="activeDate === todayYmd ? nowMinutes : null"
          :completed-before="activeDate && activeDate < todayYmd ? 24 * 60 : null"
          :empty-note="emptyNote"
          @course="(block) => openQuickLook(block)"
        />
        <ScheduleMonthView
          v-else
          :visual-style="visualStyle"
          :palette="palette"
          :dark="appearance.isDark"
          :days="monthDays"
          :selected-date="selectedDate"
          :today-date="todayYmd"
          :clocks="clocks"
          :can-open-day="dateIndex.has(selectedDate)"
          @select="selectDate"
          @open-day="openDate"
          @course="(block) => openQuickLook(block)"
        />
      </section>
    </template>

    <CourseQuickLook
      :block="quickLook"
      :schedule-line="quickLookLine"
      :accent="quickLookAccent"
      :owner-label="`${displayName} 的课`"
      :page-style="pageStyle"
      @close="quickLook = null"
    />
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { ArrowLeft, ArrowRight } from "@element-plus/icons-vue";
import { scheduleShareApi } from "@/api/scheduleShares";
import { normalizeScheduleTheme, scheduleThemeCssVars, scheduleThemeDarkCssVars } from "@/components/jwxt/scheduleTheme";
import { useAppearanceStore } from "@/stores/appearance";
import { useAuthStore } from "@/stores/auth";
import CourseQuickLook from "@/views/schedule/CourseQuickLook.vue";
import ScheduleMonthView from "@/views/schedule/ScheduleMonthView.vue";
import StyledDayView from "@/views/schedule/StyledDayView.vue";
import StyledWeekGrid from "@/views/schedule/StyledWeekGrid.vue";
import { normalizeCalendarWeekDays, shortDate, todayKey } from "@/views/schedule/calendar";
import { placeCourseBlocks } from "@/views/schedule/displayPriority";
import { buildDateIndex, buildMonthDays, calendarMonths, monthKeyOf } from "@/views/schedule/monthModel";
import { blockScheduleLine, shanghaiMinutes, weekdayLabel } from "@/views/schedule/nowIndicator";
import { SCHEDULE_THEME_STORAGE_KEY, scheduleSurfaceCssVars } from "@/views/schedule/pageVars";
import {
  classicCourseTone,
  readStoredScheduleStyle,
  rgbToCss,
  scheduleStyleCanvas,
  scheduleStyleCourseTone,
  scheduleStyleCssVars,
} from "@/views/schedule/scheduleStyle";
import {
  isNotFoundError,
  normalizeShareCode,
  readSharedSchedule,
  shareOwnerName,
  shareUpdatedText,
  sharedCourseCount,
  sharedScheduleName,
  sharedScheduleWeek,
  type SavedSharedSchedule,
} from "@/views/schedule/sharedSchedules";
import { smallSlots } from "@/views/schedule/slots";
import type { StyledDay } from "@/views/schedule/styledTypes";
import { useSharedSchedules } from "@/views/schedule/useSharedSchedules";
import { createScheduleViewModelHelpers } from "@/views/schedule/viewModels";
import type { WeekCourseBlock } from "@/views/schedule/types";

const route = useRoute();
const appearance = useAppearanceStore();
const auth = useAuthStore();
const sharing = useSharedSchedules();

const code = computed(() => normalizeShareCode(String(route.params.code || "")) ?? "");
const fetched = ref<SavedSharedSchedule | null>(null);
const loading = ref(true);
const error = ref("");
const gone = ref(false);

// 保存过的副本先显示出来，断网和对方撤销之后也还能打开；拿到新的再换上。
const savedCopy = computed(() => (code.value ? sharing.saved(code.value) : null));
const shared = computed(() => savedCopy.value ?? fetched.value);
const revoked = computed(() => Boolean(savedCopy.value?.revoked) || (gone.value && Boolean(shared.value)));
const displayName = computed(() => (shared.value ? sharedScheduleName(shared.value) : "共享课表"));
const metaLine = computed(() => {
  const value = shared.value;
  if (!value) return "";
  const owner = shareOwnerName(value.meta);
  return [
    owner && owner !== displayName.value ? `来自 ${owner}` : "",
    value.meta.semester,
    `${sharedCourseCount(value.schedule)} 门课`,
    shareUpdatedText(value.meta.updatedAt),
  ].filter(Boolean).join(" · ");
});

// 用读取方自己选的课表风格和配色。
const visualStyle = ref(readStoredScheduleStyle());
const palette = ref(normalizeScheduleTheme(readStoredTheme()));

function readStoredTheme() {
  try {
    return localStorage.getItem(SCHEDULE_THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

const pageStyle = computed(() => {
  const canvas = scheduleStyleCanvas(visualStyle.value, appearance.isDark);
  return {
    ...scheduleThemeCssVars(palette.value),
    ...(appearance.isDark ? scheduleThemeDarkCssVars(palette.value) : {}),
    ...scheduleSurfaceCssVars({ dark: appearance.isDark }),
    ...(canvas ? { "--schedule-page-bg": rgbToCss(canvas) } : {}),
    ...scheduleStyleCssVars({ style: visualStyle.value, palette: palette.value, dark: appearance.isDark }),
  };
});

// MARK: 这份课表

const calendar = computed(() => shared.value?.calendar ?? null);
const schedule = computed(() => shared.value?.schedule ?? null);
const weeks = computed(() => (calendar.value?.weeks ?? []).map((item) => ({ value: String(item.week), label: `第 ${item.week} 周` })));
const clocks = computed(() => {
  const configured = calendar.value?.periods;
  return configured?.length
    ? configured.map((item) => ({ no: item.id, start: item.start, end: item.end }))
    : smallSlots;
});

type ViewMode = "day" | "week" | "month";
const viewMode = ref<ViewMode>("week");
const week = ref("1");
const activeDay = ref(1);
const monthKey = ref("");
const selectedDate = ref("");
const todayYmd = ref(todayKey());
const nowMinutes = ref<number | null>(shanghaiMinutes());
let nowTimer = 0;

const emptyEdits = { hidden: [], custom: [] };
const helpers = createScheduleViewModelHelpers({
  calendar: () => calendar.value,
  parsed: () => schedule.value,
  weeks: () => weeks.value,
  scheduleEdits: () => emptyEdits,
  activeDay: () => activeDay.value,
  currentWeekValue: () => week.value,
  scheduleForWeek: () => schedule.value,
  allKnownScheduleSources: () => (schedule.value ? [schedule.value] : []),
});

const weekDates = computed(() => normalizeCalendarWeekDays(
  calendar.value?.weeks.find((item) => item.week === Number(week.value))?.days ?? [],
));
const dayTabs = computed(() => helpers.dayTabsForWeek(week.value));
const weekPieces = computed(() => placeCourseBlocks(helpers.weekCourseBlocksFor(Number(week.value), schedule.value)));
const dayPieces = computed(() => weekPieces.value.filter((piece) => piece.block.day === activeDay.value));
const activeDate = computed(() => weekDates.value[activeDay.value - 1] ?? "");
const adjustments = computed(() => calendar.value?.adjustments ?? []);

const styledDays = computed<StyledDay[]>(() => dayTabs.value.map((tab) => {
  const rawDate = weekDates.value[tab.day - 1] ?? "";
  return {
    day: tab.day,
    dateText: tab.date,
    rawDate,
    isToday: rawDate === todayYmd.value,
    adjustmentKind: adjustments.value.find((item) => item.date === rawDate)?.kind ?? null,
    pieces: weekPieces.value.filter((piece) => piece.block.day === tab.day),
  };
}));

const adjustmentSummary = computed(() => adjustments.value
  .filter((item) => weekDates.value.includes(item.date))
  .map((item) => (item.kind === "off"
    ? `${shortDate(item.date)} 放假`
    : `${shortDate(item.date)} 上 ${item.source ? shortDate(item.source) : "指定日期"} 的课`))
  .join(" · "));

const emptyNote = computed(() => {
  const adjustment = adjustments.value.find((item) => item.date === activeDate.value);
  if (adjustment?.kind !== "off") return "";
  return adjustment.note ? `放假：${adjustment.note}` : "这一天放假";
});

// MARK: 月视图

const dateIndex = computed(() => buildDateIndex(calendar.value));
const months = computed(() => calendarMonths(calendar.value));
const monthDays = computed(() => {
  if (viewMode.value !== "month" || !monthKey.value) return [];
  const byWeek = new Map<number, WeekCourseBlock[]>();
  return buildMonthDays({
    monthKey: monthKey.value,
    calendar: calendar.value,
    blocksFor: (weekNo, day) => {
      let blocks = byWeek.get(weekNo);
      if (!blocks) {
        blocks = helpers.weekCourseBlocksFor(weekNo, schedule.value);
        byWeek.set(weekNo, blocks);
      }
      return blocks.filter((block) => block.day === day);
    },
  });
});

function selectDate(date: string) {
  const key = monthKeyOf(date);
  if (months.value.length && !months.value.includes(key)) return;
  selectedDate.value = date;
  monthKey.value = key;
}

function openDate(date: string) {
  const slot = dateIndex.value.get(date);
  if (!slot) return;
  week.value = String(slot.week);
  activeDay.value = slot.day;
  viewMode.value = "day";
}

function openDay(day: number) {
  activeDay.value = day;
  viewMode.value = "day";
}

function setViewMode(mode: ViewMode) {
  if (mode === "month" && viewMode.value !== "month") {
    const date = activeDate.value || todayYmd.value;
    selectedDate.value = date;
    const key = monthKeyOf(date);
    monthKey.value = !months.value.length || months.value.includes(key) ? key : months.value[0];
  }
  viewMode.value = mode;
}

// MARK: 翻页

const weekIndex = computed(() => weeks.value.findIndex((item) => item.value === week.value));
const pagerTitle = computed(() => {
  if (viewMode.value === "month") {
    const match = monthKey.value.match(/^(\d{4})-(\d{2})$/u);
    return match ? `${match[1]} 年 ${Number(match[2])} 月` : "--";
  }
  return viewMode.value === "day" ? `第 ${week.value} 周 · ${weekdayLabel(activeDay.value)}` : `第 ${week.value} 周`;
});
const pagerRange = computed(() => (
  viewMode.value === "week" && weekDates.value.length >= 7
    ? `${shortDate(weekDates.value[0])} - ${shortDate(weekDates.value[6])}`
    : ""
));

function canStep(delta: number) {
  if (viewMode.value === "month") {
    const index = months.value.indexOf(monthKey.value);
    return index >= 0 && index + delta >= 0 && index + delta < months.value.length;
  }
  const next = weekIndex.value + delta;
  if (viewMode.value === "week") return weekIndex.value >= 0 && next >= 0 && next < weeks.value.length;
  const day = activeDay.value + delta;
  return (day >= 1 && day <= 7) || (weekIndex.value >= 0 && next >= 0 && next < weeks.value.length);
}

function step(delta: number) {
  if (!canStep(delta)) return;
  if (viewMode.value === "month") {
    monthKey.value = months.value[months.value.indexOf(monthKey.value) + delta];
    return;
  }
  if (viewMode.value === "week") {
    week.value = weeks.value[weekIndex.value + delta].value;
    return;
  }
  const day = activeDay.value + delta;
  if (day >= 1 && day <= 7) {
    activeDay.value = day;
    return;
  }
  week.value = weeks.value[weekIndex.value + delta].value;
  activeDay.value = delta > 0 ? 1 : 7;
}

function stepLabel(delta: number) {
  const unit = viewMode.value === "month" ? "月" : viewMode.value === "week" ? "周" : "天";
  return `${delta < 0 ? "上一" : "下一"}${unit}`;
}

const viewingToday = computed(() => {
  if (viewMode.value === "month") return selectedDate.value === todayYmd.value;
  if (!weekDates.value.includes(todayYmd.value)) return false;
  return viewMode.value === "week" || activeDate.value === todayYmd.value;
});

/** 学期开始前回到第一周，结束后回到最后一周，所以总有一周可以显示。 */
function jumpToToday() {
  if (!calendar.value) return;
  const today = todayYmd.value;
  week.value = String(sharedScheduleWeek(calendar.value, today));
  const slot = dateIndex.value.get(today);
  if (slot) activeDay.value = slot.day;
  if (viewMode.value === "month") selectDate(today);
}

// MARK: 课程速览

const quickLook = ref<WeekCourseBlock | null>(null);
const quickLookLine = computed(() => (quickLook.value ? blockScheduleLine(quickLook.value, clocks.value) : ""));
const quickLookAccent = computed(() => {
  const name = quickLook.value?.course.name;
  if (!name) return "var(--schedule-accent)";
  if (visualStyle.value === "classic") {
    const tone = classicCourseTone(name, palette.value, appearance.isDark);
    return appearance.isDark ? tone.border : tone.text;
  }
  return scheduleStyleCourseTone(name, palette.value, appearance.isDark).accent;
});

function openQuickLook(block: WeekCourseBlock) {
  quickLook.value = block;
}

// MARK: 保存到自己的列表

async function askRemark(title: string, current: string) {
  const owner = shared.value ? shareOwnerName(shared.value.meta) : null;
  const result = await ElMessageBox.prompt("备注只保存在这台设备上，对方看不到。", title, {
    inputValue: current,
    inputPlaceholder: owner || "例如 室友小王",
    inputValidator: (value) => {
      const text = String(value ?? "").trim();
      if (text.length > 20) return "备注最多 20 个字";
      return text || owner ? true : "对方没有留昵称，请填一个备注";
    },
    confirmButtonText: "保存",
    cancelButtonText: "取消",
  }).catch(() => null);
  return result ? String(result.value ?? "") : null;
}

async function saveToLibrary() {
  if (!fetched.value) return;
  // 是不是自己的分享看账号自己的列表，不看公开的昵称。
  if (auth.isLoggedIn) {
    await sharing.loadMine().catch(() => undefined);
    if (sharing.mine.value.some((item) => item.code === code.value)) {
      ElMessage.info("这是你自己分享的课表，直接看自己的课表就可以");
      return;
    }
  }
  const remark = await askRemark("保存这份课表", "");
  if (remark === null) return;
  if (!sharing.save(fetched.value, remark)) {
    ElMessage.warning("本地空间不足，这份课表没有保存下来");
    return;
  }
  ElMessage.success("已保存，在「课表 → 更多 → 共享课表」里可以再打开");
}

async function renameSaved() {
  if (!savedCopy.value) return;
  const remark = await askRemark("修改备注", savedCopy.value.remark);
  if (remark === null) return;
  if (!sharing.rename(code.value, remark)) ElMessage.warning("本地空间不足，备注没有保存");
}

// MARK: 读取

let positioned = false;

function positionOnce() {
  if (positioned || !calendar.value) return;
  positioned = true;
  jumpToToday();
  if (!dateIndex.value.has(todayYmd.value)) {
    activeDay.value = 1;
  }
}

async function load() {
  loading.value = true;
  error.value = "";
  gone.value = false;
  positioned = false;
  sharing.adoptAccount(auth.user?.id);
  if (!code.value) {
    error.value = "分享码是 8 位字母和数字，请检查链接是否完整";
    loading.value = false;
    return;
  }
  positionOnce();
  try {
    fetched.value = readSharedSchedule(await scheduleShareApi.get(code.value));
    positionOnce();
    // 保存过的那份有更新时一并换上。
    if (savedCopy.value) void sharing.refresh();
  } catch (cause) {
    if (isNotFoundError(cause)) {
      gone.value = true;
      if (savedCopy.value) void sharing.refresh();
      else error.value = "这份共享课表不存在，或者已经被对方撤销";
    } else if (!shared.value) {
      error.value = cause instanceof Error && cause.message ? cause.message : "共享课表加载失败，请检查网络后重试";
    }
  } finally {
    loading.value = false;
  }
}

function tickNow() {
  nowMinutes.value = shanghaiMinutes();
  todayYmd.value = todayKey();
}

watch(code, () => { void load(); });
watch(() => auth.user?.id, (id) => sharing.adoptAccount(id));

onMounted(() => {
  void load();
  nowTimer = window.setInterval(tickNow, 20000);
  document.addEventListener("visibilitychange", tickNow);
});

onBeforeUnmount(() => {
  if (nowTimer) window.clearInterval(nowTimer);
  document.removeEventListener("visibilitychange", tickNow);
});
</script>

<style scoped lang="scss">
.shared-schedule-page {
  min-height: 100vh;
  box-sizing: border-box;
  padding: 24px max(14px, 4vw) 48px;
  background: var(--schedule-page-bg);
  color: var(--schedule-text);
}
.shared-head,
.shared-toolbar,
.shared-adjustments,
.shared-days,
.shared-body,
.loading-state {
  width: 100%;
  max-width: 720px;
  margin-left: auto;
  margin-right: auto;
}
.shared-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}
.shared-title {
  min-width: 0;
}
.eyebrow {
  margin: 0 0 5px;
  color: var(--schedule-accent-strong);
  font-size: var(--cpu-fs-xs);
  font-weight: 700;
}
.shared-head h1 {
  margin: 0;
  overflow: hidden;
  font-size: 26px;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.shared-meta {
  margin: 6px 0 0;
  color: var(--schedule-text-secondary);
  font-size: var(--cpu-fs-s);
}
.head-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
}
.head-actions .el-button + .el-button {
  margin-left: 0;
}
.shared-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.shared-switch {
  flex: 0 0 auto;
  height: 38px;
  padding: 3px;
  box-sizing: border-box;
  border: 1px solid var(--schedule-border);
  border-radius: var(--cpu-radius-m);
  background: var(--schedule-surface-bg-soft);
  display: inline-grid;
  grid-template-columns: repeat(3, 32px);
  gap: 2px;
}
.shared-switch button,
.shared-pager button,
.shared-today,
.shared-days button {
  border: 0;
  background: transparent;
  color: var(--schedule-text-secondary);
  font: inherit;
  cursor: pointer;
  touch-action: manipulation;
}
.shared-switch button {
  border-radius: var(--cpu-radius-s);
  font-size: var(--cpu-fs-s);
  font-weight: 700;
}
.shared-switch button.active {
  background: var(--schedule-accent);
  color: var(--schedule-accent-contrast);
}
.shared-pager {
  flex: 1 1 auto;
  min-width: 0;
  height: 38px;
  border-radius: var(--cpu-radius-m);
  background: var(--schedule-accent-pale);
  color: var(--schedule-accent-strong);
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) 36px;
  align-items: center;
}
.shared-pager b {
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  font-size: var(--cpu-fs-s);
  line-height: 1.15;
  white-space: nowrap;
}
.shared-pager small {
  font-size: 11px;
  font-weight: 500;
}
.shared-pager button {
  height: 100%;
  color: inherit;
  display: grid;
  place-items: center;
}
.shared-pager button:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}
.shared-today {
  flex: 0 0 auto;
  height: 38px;
  padding: 0 12px;
  border: 1px solid var(--schedule-border);
  border-radius: var(--cpu-radius-m);
  background: var(--schedule-surface-bg-soft);
  font-size: var(--cpu-fs-s);
  font-weight: 700;
}
.shared-today.active {
  border-color: var(--schedule-accent);
  background: var(--schedule-accent);
  color: var(--schedule-accent-contrast);
}
.shared-adjustments {
  margin-top: -4px;
  margin-bottom: 12px;
  color: var(--schedule-text-secondary);
  font-size: var(--cpu-fs-xs);
}
.shared-days {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6px;
  margin-bottom: 12px;
}
.shared-days button {
  min-width: 0;
  height: 46px;
  border: 1px solid var(--schedule-border);
  border-radius: var(--cpu-radius-m);
  background: var(--schedule-surface-bg);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  line-height: 1.1;
}
.shared-days button span {
  font-size: 12px;
}
.shared-days button b {
  font-size: 11px;
  font-weight: 500;
}
.shared-days button.today {
  color: var(--schedule-accent-strong);
}
.shared-days button.active {
  border-color: var(--schedule-accent);
  background: var(--schedule-accent-pale);
  color: var(--schedule-accent-strong);
}
.loading-state {
  margin-top: 60px;
}

@media (max-width: 680px) {
  .shared-schedule-page {
    padding-top: 16px;
  }
  .shared-head {
    align-items: flex-start;
    flex-direction: column;
  }
  .head-actions {
    width: 100%;
  }
  .head-actions .el-button {
    flex: 1 1 0;
  }
  .shared-head h1 {
    font-size: var(--cpu-fs-xl);
  }
}
</style>
