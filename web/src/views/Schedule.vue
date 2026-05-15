<template>
  <main class="schedule-page">
    <header class="top">
      <el-select
        v-if="parsed"
        v-model="semester"
        size="small"
        class="sem-select"
        @change="loadSchedule(false)"
      >
        <el-option v-for="s in semesters" :key="s.value" :value="s.value" :label="s.label" />
      </el-select>
      <div class="top-actions">
        <div v-if="parsed" class="view-switch" aria-label="切换课表视图">
          <button type="button" :class="{ active: viewMode === 'day' }" @click="setViewMode('day')">日</button>
          <button type="button" :class="{ active: viewMode === 'week' }" @click="setViewMode('week')">周</button>
        </div>
        <button
          v-if="installPromptRef && (installPromptRef as any).canShow"
          type="button"
          class="icon-btn install-btn"
          aria-label="把课表添加到桌面"
          title="添加到桌面"
          @click="openInstallPrompt"
        >
          <el-icon><Download /></el-icon>
        </button>
        <button
          type="button"
          class="icon-btn"
          :class="{ spinning: loading }"
          aria-label="刷新课表"
          @click="loadSchedule(true)"
        >
          <el-icon><Refresh /></el-icon>
        </button>
      </div>
    </header>

    <!-- PWA 添加到桌面引导 -->
    <InstallPromptDialog ref="installPromptRef" />

    <section v-if="parsed" class="week-switcher">
      <button type="button" class="week-btn" :disabled="!canChangeWeek(-1)" @click="changeWeek(-1)">
        <el-icon><ArrowLeft /></el-icon>
        上一周
      </button>
      <button
        type="button"
        class="week-title clickable"
        @click="weekDialogOpen = true"
      >
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

    <section v-if="autoLoading && !parsed" class="state-card">
      <el-icon class="big is-loading"><Loading /></el-icon>
      <h2>正在自动授权</h2>
      <p>使用本机保存的学校账号读取课表。</p>
    </section>

    <section v-else-if="jwxt.needCaptcha && hasCreds && !parsed" class="state-card">
      <el-icon class="big"><Picture /></el-icon>
      <h2>输入验证码</h2>
      <p>本机已保存学校账号，补充验证码后即可查看课表。</p>
      <div class="captcha-row">
        <el-input v-model="captchaInput" size="large" placeholder="验证码" maxlength="8" @keyup.enter="submitCaptcha" />
        <img v-if="jwxt.captchaImage" :src="jwxt.captchaImage" alt="验证码" @click="reloadCaptcha" />
      </div>
      <p v-if="captchaError" class="error-text">{{ captchaError }}</p>
      <el-button type="primary" size="large" :loading="captchaSubmitting" @click="submitCaptcha">完成授权</el-button>
    </section>

    <section v-else-if="!jwxt.isLoggedIn && !parsed" class="state-card">
      <el-icon class="big"><Lock /></el-icon>
      <h2>需要先授权教务数据</h2>
      <p>授权后可把这个页面添加到桌面书签，之后快速打开查看课表。本站不保存学校密码和验证码。</p>
      <el-button type="primary" size="large" @click="$router.push({ name: 'jwxt', query: { redirect: '/schedule' } })">
        前往授权
      </el-button>
    </section>

    <section v-else class="content" v-loading="loading && !parsed">
      <div class="summary">
        <div>
          <span>第 {{ week || parsed?.currentWeek || "--" }} 周</span>
          <b>{{ activeDayLabel }}</b>
          <small v-if="cacheText">{{ cacheText }}</small>
        </div>
        <em>{{ dayCourses.length }} 节课</em>
      </div>

      <section v-if="viewMode === 'week'" class="week-overview" aria-label="整周课表">
        <div class="week-grid-head">
          <div class="time-head">节次</div>
          <div
            v-for="d in dayTabs"
            :key="d.day"
            class="week-day-head"
            :class="{ today: d.isToday }"
            @click="onDayClick(d.day)"
          >
            <span>{{ d.label.replace("周", "") }}</span>
            <b>{{ d.date || "--" }}</b>
          </div>
        </div>
        <div class="week-grid-body">
          <template v-for="slot in smallSlots" :key="`axis-${slot.no}`">
            <div class="slot-axis" :style="{ gridRow: `${slot.no} / ${slot.no + 1}` }">
              <b>{{ slot.no }}</b>
              <span>{{ slot.start }}</span>
              <span>{{ slot.end }}</span>
            </div>
            <div
              v-for="day in 7"
              :key="`bg-${slot.no}-${day}`"
              class="week-slot-cell"
              :style="{ gridColumn: `${day + 1} / ${day + 2}`, gridRow: `${slot.no} / ${slot.no + 1}` }"
              :class="{ today: dayTabs[day - 1]?.isToday }"
            />
          </template>
          <article
            v-for="block in weekCourseBlocks"
            :key="`${block.day}-${block.startSlot}-${block.endSlot}-${block.index}-${block.course.name}`"
            class="week-course"
            :style="courseBlockStyle(block)"
            :title="courseTitle(block.course)"
            @click="openDayFromWeek(block.day)"
          >
            <strong>{{ block.course.name }}</strong>
            <span v-if="block.course.location">@{{ block.course.location }}</span>
            <em>{{ block.course.slotNote || block.course.weeks }}</em>
          </article>
        </div>
      </section>

      <transition v-else :name="slideName" mode="out-in">
        <div :key="activeDay" class="day-pane">
          <section v-if="dayCourseBlocks.length" class="day-timeline" aria-label="当日课表">
            <div class="day-grid-body">
              <template v-for="slot in smallSlots" :key="`day-axis-${slot.no}`">
                <div class="slot-axis day-axis" :style="{ gridRow: `${slot.no} / ${slot.no + 1}` }">
                  <b>{{ slot.no }}</b>
                  <span>{{ slot.start }}</span>
                  <span>{{ slot.end }}</span>
                </div>
                <div class="day-slot-cell" :style="{ gridColumn: '2 / 3', gridRow: `${slot.no} / ${slot.no + 1}` }" />
              </template>
              <article
                v-for="block in dayCourseBlocks"
                :key="`${block.startSlot}-${block.endSlot}-${block.index}-${block.course.name}`"
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
      </transition>
    </section>

    <!-- 周次选择弹窗 -->
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
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { ArrowLeft, ArrowRight, Download, Loading, Lock, Moon, Picture, Refresh } from "@element-plus/icons-vue";
import { jwxtApi } from "@/api/jwxt";
import { useJwxtStore } from "@/stores/jwxt";
import { hasCreds as hasSavedCreds, loadCreds } from "@/utils/credCrypto";
import { detectInAppBrowser } from "@/utils/inAppBrowser";
import InstallPromptDialog from "@/components/install/InstallPromptDialog.vue";

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
interface WeekCourseBlock { day: number; startSlot: number; endSlot: number; index: number; course: ScheduleCourse }

const jwxt = useJwxtStore();
const parsed = ref<ScheduleResult | null>(null);
const calendar = ref<CalendarResult | null>(null);
const semester = ref("");
const week = ref("");
const activeDay = ref(dayOfWeek());
const viewMode = ref<ViewMode>("day");
const loading = ref(false);
const autoLoading = ref(false);
const hasCreds = ref(false);
const captchaInput = ref("");
const captchaSubmitting = ref(false);
const captchaError = ref("");
const scheduleSavedAt = ref(0);
const CACHE_TTL = 12 * 60 * 60 * 1000;
const CALENDAR_CACHE_KEY = "cpu-schedule-calendar-v1";
const LAST_STATE_KEY = "cpu-schedule-last-state-v1";
const LAST_CACHE_KEY = "cpu-schedule-last-cache-key-v1";
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
];

// 周次选择弹窗
const weekDialogOpen = ref(false);
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
  void loadSchedule(false);
}
async function onJumpAndClose() {
  weekDialogOpen.value = false;
  await jumpToCurrentWeek();
}

// 添加到主屏幕引导
const installPromptRef = ref<InstanceType<typeof InstallPromptDialog> | null>(null);
async function openInstallPrompt() {
  const inApp = detectInAppBrowser();
  if (inApp.isInApp) {
    await ElMessageBox.alert(
      `检测到当前可能在${inApp.label}内打开。内置浏览器通常不支持把课表添加到主屏幕，请点击右上角菜单，选择“在浏览器打开”或“用默认浏览器打开”后再操作。`,
      "请使用外部浏览器打开",
      {
        confirmButtonText: "我知道了",
        type: "warning",
      }
    );
    return;
  }
  await installPromptRef.value?.requestInstall();
}

onMounted(async () => {
  jwxt.hydrate();
  hasCreds.value = hasSavedCreds();

  // 第一时间从 localStorage 还原缓存，让画面"秒开"——不等任何网络请求
  restoreLastState();
  restoreCachedCalendar();
  restoreLastScheduleCache();

  // 自动检测是否值得弹"添加到桌面"（首次进 / 非 standalone / 没 dismiss 过 / 移动端）
  installPromptRef.value?.autoPromptIfEligible();

  // 后台静默：刷新会话状态 + 自动登录 + 重新拉数据。失败也不影响已显示的缓存。
  void (async () => {
    try { await jwxt.refreshStatus(); } catch { /* ignore */ }
    if (!jwxt.isLoggedIn && hasCreds.value) {
      autoLoading.value = true;
      try { await jwxt.tryAutoLogin({ force: true }); }
      finally { autoLoading.value = false; }
    }
    if (jwxt.isLoggedIn) {
      await loadCalendar();
      await loadSchedule();
    }
  })();
});

const semesters = computed(() => parsed.value?.semesters ?? []);
const weeks = computed(() => parsed.value?.weeks ?? []);
const currentWeekInfo = computed(() => calendar.value?.weeks.find((w) => w.week === Number(week.value)) ?? null);
const currentWeekRange = computed(() => {
  const w = currentWeekInfo.value;
  if (!w || w.days.length < 7) return "";
  // 服务端 sunday: days[0] 实际是周一前一天，不是末尾的周日；这里自己用周六+1天算
  const monday = w.days[1];
  const sunday = plusOneDay(w.days[6]);
  return `${shortDate(monday)} - ${shortDate(sunday)}`;
});
const dayTabs = computed(() => {
  const labels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  // 学校 days = [周日(N周开始), 周一, 周二, ..., 周六]。
  // 我们要按"周一开头"展示，且末尾的"周日"实际是 days[6](周六) 的下一天。
  const raw = currentWeekInfo.value?.days ?? [];
  const dates = raw.length >= 7
    ? [...raw.slice(1, 7), plusOneDay(raw[6])]
    : [];
  const today = todayKey();
  return labels.map((label, i) => ({
    day: i + 1,
    label,
    date: shortDate(dates[i] ?? ""),
    isToday: dates[i] === today,
  }));
});
const activeDayLabel = computed(() => dayTabs.value.find((d) => d.day === activeDay.value)?.label ?? "今日");
const cacheText = computed(() => scheduleSavedAt.value ? `本地缓存 ${formatCacheTime(scheduleSavedAt.value)}` : "");
const activeWeekNumber = computed(() => {
  const value = Number(week.value || parsed.value?.currentWeek || calendar.value?.currentWeek || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
});
const currentCells = computed<ScheduleCell[]>(() => {
  const wk = activeWeekNumber.value;
  return (parsed.value?.cells ?? [])
    .map((cell) => ({
      ...cell,
      courses: wk ? cell.courses.filter((course) => courseMatchesWeek(course, wk)) : cell.courses,
    }))
    .filter((cell) => cell.courses.length);
});
const dayCourses = computed<FlatCourse[]>(() => {
  const list: FlatCourse[] = [];
  for (const cell of currentCells.value) {
    if (cell.day !== activeDay.value) continue;
    cell.courses.forEach((course, index) => list.push({ bigSlot: cell.bigSlot, index, course }));
  }
  return list.sort((a, b) => a.bigSlot - b.bigSlot);
});
const dayCourseBlocks = computed<WeekCourseBlock[]>(() => (
  weekCourseBlocks.value.filter((block) => block.day === activeDay.value)
));
const weekCourseBlocks = computed<WeekCourseBlock[]>(() => {
  const blocks: WeekCourseBlock[] = [];
  for (const cell of currentCells.value) {
    cell.courses.forEach((course, index) => {
      const range = normalizeSlotRange(cell.bigSlot, course);
      blocks.push({ day: cell.day, startSlot: range.start, endSlot: range.end, index, course });
    });
  }
  return blocks.sort((a, b) => a.startSlot - b.startSlot || a.day - b.day || a.index - b.index);
});

// 滑动切日时记录方向，给 transition 用不同动画
const slideDirection = ref<"next" | "prev">("next");
const slideName = computed(() => slideDirection.value === "next" ? "slide-left" : "slide-right");

async function loadCalendar() {
  restoreCachedCalendar();
  try {
    const r: any = await jwxtApi.calendar();
    calendar.value = r.parsed;
    writeCache(CALENDAR_CACHE_KEY, calendar.value);
    if (calendar.value?.currentWeek && !week.value) week.value = String(calendar.value.currentWeek);
  } catch { /* calendar is best effort */ }
}

async function loadSchedule(force = false) {
  if (!jwxt.isLoggedIn || (loading.value && !force)) return;
  const hadCache = !force && restoreScheduleCache();
  if (hadCache) {
    saveLastState();
    if (!isStale(scheduleSavedAt.value)) return;
  }
  loading.value = !parsed.value || force || !hadCache;
  try {
    const r: any = await jwxtApi.schedule({ semester: semester.value, week: week.value });
    parsed.value = r.parsed;
    if (!semester.value) semester.value = parsed.value?.currentSemester ?? "";
    if (!week.value) week.value = String(calendar.value?.currentWeek || parsed.value?.currentWeek || "");
    scheduleSavedAt.value = Date.now();
    saveScheduleCache();
    saveLastState();
  } finally {
    loading.value = false;
  }
}

function canChangeWeek(delta: number) {
  const next = nextWeekValue(delta);
  return Boolean(next && next !== week.value);
}

async function changeWeek(delta: number) {
  const next = nextWeekValue(delta);
  if (!next) return;
  week.value = next;
  saveLastState();
  await loadSchedule(false);
}

const canJumpToCurrentWeek = computed(() => {
  const cur = calendar.value?.currentWeek;
  return Boolean(cur && String(cur) !== week.value);
});

async function jumpToCurrentWeek() {
  const cur = calendar.value?.currentWeek;
  if (!cur || String(cur) === week.value) return;
  slideDirection.value = Number(week.value || cur) > cur ? "prev" : "next";
  week.value = String(cur);
  activeDay.value = dayOfWeek();
  saveLastState();
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

async function reloadCaptcha() {
  captchaInput.value = "";
  captchaError.value = "";
  await jwxt.beginLogin().catch(() => undefined);
}

async function submitCaptcha() {
  if (!captchaInput.value.trim()) {
    captchaError.value = "请输入验证码";
    return;
  }
  const creds = await loadCreds().catch(() => null);
  if (!creds) {
    ElMessage.warning("未找到保存的账号，请先完成教务授权");
    return;
  }
  captchaSubmitting.value = true;
  captchaError.value = "";
  try {
    const ok = await jwxt.submitLogin(creds.username, creds.password, captchaInput.value.trim(), true);
    if (!ok) {
      captchaError.value = jwxt.error || "验证码错误，请重试";
      captchaInput.value = "";
      return;
    }
    ElMessage.success("授权成功");
    restoreLastState();
    restoreCachedCalendar();
    restoreLastScheduleCache();
    await loadCalendar();
    await loadSchedule(true);
  } finally {
    captchaSubmitting.value = false;
  }
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

/** 给 "YYYY-MM-DD" 加一天 */
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

function nextWeekValue(delta: number) {
  const values = weeks.value.map((w) => String(w.value)).filter(Boolean);
  const current = week.value || String(calendar.value?.currentWeek || parsed.value?.currentWeek || "");
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

const weekTones = [
  { bg: "linear-gradient(135deg, rgba(222,120,148,0.34), rgba(255,255,255,0.62))", border: "#de7894", text: "#5a2434" },
  { bg: "linear-gradient(135deg, rgba(159,130,233,0.32), rgba(255,255,255,0.62))", border: "#9f82e9", text: "#36266a" },
  { bg: "linear-gradient(135deg, rgba(232,109,75,0.32), rgba(255,255,255,0.62))", border: "#e86d4b", text: "#67301f" },
  { bg: "linear-gradient(135deg, rgba(112,215,186,0.34), rgba(255,255,255,0.62))", border: "#52bfa4", text: "#195448" },
  { bg: "linear-gradient(135deg, rgba(233,170,76,0.32), rgba(255,255,255,0.62))", border: "#e3a13e", text: "#654415" },
  { bg: "linear-gradient(135deg, rgba(79,128,191,0.32), rgba(255,255,255,0.62))", border: "#4f80bf", text: "#203f68" },
  { bg: "linear-gradient(135deg, rgba(223,74,105,0.30), rgba(255,255,255,0.64))", border: "#df4a69", text: "#6a2031" },
  { bg: "linear-gradient(135deg, rgba(143,188,232,0.34), rgba(255,255,255,0.64))", border: "#79aee0", text: "#244b70" },
  { bg: "linear-gradient(135deg, rgba(231,223,69,0.30), rgba(255,255,255,0.66))", border: "#d6cb2d", text: "#5a5418" },
];

function hashName(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return h;
}

function toneFor(name: string) {
  return weekTones[hashName(name) % weekTones.length];
}

function normalizeSlotRange(bigSlot: number, course: ScheduleCourse) {
  const fallbackStart = Math.max(1, Math.min(10, bigSlot * 2 - 1));
  const fallbackEnd = Math.max(fallbackStart, Math.min(10, bigSlot * 2));
  const start = Number.isFinite(course.startSlot) ? Number(course.startSlot) : fallbackStart;
  const end = Number.isFinite(course.endSlot) ? Number(course.endSlot) : fallbackEnd;
  const safeStart = Math.max(1, Math.min(10, start));
  const safeEnd = Math.max(safeStart, Math.min(10, end));
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
  parsed.value = cached.data;
  scheduleSavedAt.value = cached.savedAt;
  if (!semester.value) semester.value = cached.data.currentSemester || "";
  if (!week.value) week.value = String(cached.data.currentWeek || "");
  return true;
}

function saveScheduleCache() {
  if (!parsed.value) return;
  const key = scheduleCacheKey(parsed.value.currentSemester || semester.value, week.value || parsed.value.currentWeek);
  writeCache(key, parsed.value);
  try { localStorage.setItem(LAST_CACHE_KEY, key); } catch { /* ignore */ }
}
</script>

<style scoped lang="scss">
.schedule-page {
  /* 不强制撑满视口高，避免内容短时多出可滚区 */
  padding: calc(env(safe-area-inset-top) + 14px) 14px calc(env(safe-area-inset-bottom) + 18px);
  background:
    radial-gradient(circle at 18% 0%, rgba(174, 211, 255, 0.36), transparent 32%),
    radial-gradient(circle at 88% 14%, rgba(183, 232, 219, 0.32), transparent 30%),
    linear-gradient(180deg, #edf4ff 0%, #f7fbff 42%, #f8fafc 100%);
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
.sem-select {
  flex: 1;
  min-width: 0;
  max-width: 260px;
}
/* 把 el-select 撑成 38px 高（默认 size=small 是 28-32px，太矮），跟 icon-btn 对齐 */
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
@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
.toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.8fr);
  gap: 10px;
  max-width: 720px;
  margin: 0 auto 12px;
}
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
.week-title:disabled {
  cursor: default;
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
.content,
.state-card {
  max-width: 720px;
  margin: 0 auto;
}
.content {
  touch-action: pan-y;
}
.state-card {
  min-height: calc(100dvh - 180px);
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  gap: 12px;
  padding: 20px;
}
.state-card .big {
  font-size: 44px;
  color: #168776;
}
.state-card h2 {
  margin: 0;
  font-size: 20px;
}
.state-card p {
  margin: 0;
  color: #667085;
  line-height: 1.7;
}
.captcha-row {
  display: flex;
  gap: 10px;
  align-items: center;
  width: min(100%, 360px);
}
.captcha-row img {
  width: 112px;
  height: 42px;
  object-fit: contain;
  border: 1px solid #dde4ee;
  border-radius: 9px;
  background: #fff;
}
.error-text {
  color: #dc2626 !important;
  font-size: 13px;
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
.day-timeline {
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  touch-action: pan-y;
}
.day-grid-body {
  display: grid;
  grid-template-columns: 50px minmax(0, 1fr);
  grid-template-rows: repeat(10, minmax(58px, 6.2dvh));
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
  position: sticky;
  top: calc(env(safe-area-inset-top) + 2px);
  z-index: 3;
  margin-bottom: 6px;
  padding: 3px 0;
  background: rgba(247, 251, 255, 0.86);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}
.time-head,
.week-day-head {
  min-width: 0;
  height: 38px;
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
  font-size: 12px;
  font-weight: 700;
}
.week-day-head b {
  margin-top: 3px;
  font-size: 10px;
  font-weight: 600;
}
.week-day-head.today {
  border-color: #168776;
  background: #e8f6f3;
  color: #116b5f;
}
.week-grid-body {
  position: relative;
  grid-template-rows: repeat(10, minmax(48px, 5.8dvh));
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
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.58),
    0 6px 14px rgba(24, 34, 51, 0.08);
  backdrop-filter: blur(12px) saturate(145%);
  -webkit-backdrop-filter: blur(12px) saturate(145%);
  cursor: pointer;
  touch-action: manipulation;
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
  min-height: 220px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 10px;
  color: #8a94a6;
}
.empty-day .el-icon {
  font-size: 36px;
}

/* 滑动切日动画 */
.day-pane {
  will-change: transform, opacity;
}
.slide-left-enter-active,
.slide-left-leave-active,
.slide-right-enter-active,
.slide-right-leave-active {
  transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.22s;
}
.slide-left-enter-from {
  transform: translateX(24%);
  opacity: 0;
}
.slide-left-leave-to {
  transform: translateX(-24%);
  opacity: 0;
}
.slide-right-enter-from {
  transform: translateX(-24%);
  opacity: 0;
}
.slide-right-leave-to {
  transform: translateX(24%);
  opacity: 0;
}
.next-card,
.next-card span,
.next-card em,
.next-card b {
  display: none;
}

/* ===== 周次选择 dialog 里的网格 ===== */
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

/* ===== 移动端：恢复显示 top（紧凑学期+刷新+视图切换） + 仍隐藏旧 toolbar/summary ===== */
@media (max-width: 760px) {
  /* toolbar 旧的双选择器已经从模板移除，但保险起见仍 hide 类 */
  .toolbar { display: none; }
  .summary { display: none; }
  .schedule-page {
    padding-top: calc(env(safe-area-inset-top) + 8px);
    padding-left: 8px;
    padding-right: 8px;
  }

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
    grid-template-rows: repeat(10, minmax(52px, 6dvh));
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

  .week-grid-head {
    top: calc(env(safe-area-inset-top) + 0px);
  }

  .week-day-head {
    height: 34px;
    border-radius: 8px;
  }

  .week-day-head span {
    font-size: 11px;
  }

  .week-day-head b {
    font-size: 9px;
  }

  .week-grid-body {
    grid-template-rows: repeat(10, minmax(44px, 5.5dvh));
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

@media (min-width: 760px) {
  .schedule-page {
    padding-top: 28px;
  }
}

@media (max-width: 390px) {
  .schedule-page {
    padding-left: 6px;
    padding-right: 6px;
  }
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
    grid-template-rows: repeat(10, minmax(48px, 5.6dvh));
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
    grid-template-rows: repeat(10, minmax(40px, 5.2dvh));
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
