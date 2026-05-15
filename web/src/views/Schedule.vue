<template>
  <main class="schedule-page">
    <header class="top">
      <div>
        <div class="eyebrow">药大垎坊</div>
        <h1>课表</h1>
      </div>
      <div class="top-actions">
        <button type="button" class="icon-btn" aria-label="刷新课表" @click="loadSchedule(true)">
          <el-icon><Refresh /></el-icon>
        </button>
        <button type="button" class="icon-btn" aria-label="返回首页" @click="$router.push('/home')">
          <el-icon><House /></el-icon>
        </button>
      </div>
    </header>

    <section v-if="jwxt.isLoggedIn" class="toolbar">
      <el-select v-model="semester" size="large" placeholder="学期" @change="loadSchedule(false)">
        <el-option v-for="s in semesters" :key="s.value" :value="s.value" :label="s.label" />
      </el-select>
      <el-select v-model="week" size="large" placeholder="周次" @change="loadSchedule(false)">
        <el-option v-for="w in weeks" :key="w.value" :value="w.value" :label="w.label" />
      </el-select>
    </section>

    <section v-if="jwxt.isLoggedIn" class="week-switcher">
      <button type="button" class="week-btn" :disabled="!canChangeWeek(-1)" @click="changeWeek(-1)">
        <el-icon><ArrowLeft /></el-icon>
        上一周
      </button>
      <div class="week-title">
        <b>第 {{ week || parsed?.currentWeek || "--" }} 周</b>
        <span v-if="currentWeekRange">{{ currentWeekRange }}</span>
      </div>
      <button type="button" class="week-btn" :disabled="!canChangeWeek(1)" @click="changeWeek(1)">
        下一周
        <el-icon><ArrowRight /></el-icon>
      </button>
    </section>

    <section v-if="jwxt.isLoggedIn" class="week-strip">
      <button
        v-for="d in dayTabs"
        :key="d.day"
        type="button"
        class="day-pill"
        :class="{ active: activeDay === d.day, today: d.isToday }"
        @click="activeDay = d.day"
      >
        <span>{{ d.label }}</span>
        <b>{{ d.date || "--" }}</b>
      </button>
    </section>

    <section v-if="autoLoading" class="state-card">
      <el-icon class="big is-loading"><Loading /></el-icon>
      <h2>正在自动授权</h2>
      <p>使用本机保存的学校账号读取课表。</p>
    </section>

    <section v-else-if="jwxt.needCaptcha && hasCreds" class="state-card">
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

    <section v-else-if="!jwxt.isLoggedIn" class="state-card">
      <el-icon class="big"><Lock /></el-icon>
      <h2>需要先授权教务数据</h2>
      <p>授权后可把这个页面添加到桌面书签，之后快速打开查看课表。本站不保存学校密码和验证码。</p>
      <el-button type="primary" size="large" @click="$router.push({ name: 'jwxt', query: { redirect: '/schedule' } })">
        前往授权
      </el-button>
    </section>

    <section v-else class="content" v-loading="loading" @touchstart.passive="onTouchStart" @touchend.passive="onTouchEnd">
      <div class="summary">
        <div>
          <span>第 {{ week || parsed?.currentWeek || "--" }} 周</span>
          <b>{{ activeDayLabel }}</b>
          <small v-if="cacheText">{{ cacheText }}</small>
        </div>
        <em>{{ dayCourses.length }} 节课</em>
      </div>

      <div v-if="dayCourses.length" class="course-list">
        <article v-for="item in dayCourses" :key="`${item.bigSlot}-${item.index}`" class="course-card" :style="{ '--accent': colorFor(item.course.name) }">
          <div class="time">
            <b>第 {{ item.bigSlot }} 大节</b>
            <span>{{ bigSlotTime(item.bigSlot) }}</span>
          </div>
          <div class="course-main">
            <h2>{{ item.course.name }}</h2>
            <p v-if="item.course.location"><el-icon><Location /></el-icon>{{ item.course.location }}</p>
            <p v-if="item.course.teacher"><el-icon><User /></el-icon>{{ item.course.teacher }}</p>
            <p class="muted">{{ item.course.weeks }}<span v-if="item.course.slotNote"> · {{ item.course.slotNote }}</span></p>
          </div>
        </article>
      </div>

      <div v-else class="empty-day">
        <el-icon><Moon /></el-icon>
        <p>这一天没有课程</p>
      </div>

      <div v-if="nextCourse" class="next-card">
        <span>下一节</span>
        <b>{{ nextCourse.course.name }}</b>
        <em>第 {{ nextCourse.bigSlot }} 大节 · {{ bigSlotTime(nextCourse.bigSlot) }}</em>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { ArrowLeft, ArrowRight, House, Loading, Lock, Location, Moon, Picture, Refresh, User } from "@element-plus/icons-vue";
import { jwxtApi } from "@/api/jwxt";
import { useJwxtStore } from "@/stores/jwxt";
import { hasCreds as hasSavedCreds, loadCreds } from "@/utils/credCrypto";

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
interface LastState { semester: string; week: string; activeDay: number }

const jwxt = useJwxtStore();
const parsed = ref<ScheduleResult | null>(null);
const calendar = ref<CalendarResult | null>(null);
const semester = ref("");
const week = ref("");
const activeDay = ref(dayOfWeek());
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
let touchStartX = 0;
let touchStartY = 0;

onMounted(async () => {
  jwxt.hydrate();
  hasCreds.value = hasSavedCreds();
  await jwxt.refreshStatus();
  if (!jwxt.isLoggedIn && hasCreds.value) {
    autoLoading.value = true;
    try { await jwxt.tryAutoLogin({ force: true }); }
    finally { autoLoading.value = false; }
  }
  if (jwxt.isLoggedIn) {
    restoreLastState();
    restoreCachedCalendar();
    restoreLastScheduleCache();
    await loadCalendar();
    await loadSchedule();
  }
});

const semesters = computed(() => parsed.value?.semesters ?? []);
const weeks = computed(() => parsed.value?.weeks ?? []);
const currentWeekInfo = computed(() => calendar.value?.weeks.find((w) => w.week === Number(week.value)) ?? null);
const currentWeekRange = computed(() => {
  const w = currentWeekInfo.value;
  if (!w) return "";
  return `${shortDate(w.monday)} - ${shortDate(w.sunday)}`;
});
const dayTabs = computed(() => {
  const labels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const days = currentWeekInfo.value ? [...currentWeekInfo.value.days.slice(1), currentWeekInfo.value.days[0]] : [];
  const today = todayKey();
  return labels.map((label, i) => ({
    day: i + 1,
    label,
    date: shortDate(days[i] ?? ""),
    isToday: days[i] === today,
  }));
});
const activeDayLabel = computed(() => dayTabs.value.find((d) => d.day === activeDay.value)?.label ?? "今日");
const cacheText = computed(() => scheduleSavedAt.value ? `本地缓存 ${formatCacheTime(scheduleSavedAt.value)}` : "");
const dayCourses = computed<FlatCourse[]>(() => {
  const list: FlatCourse[] = [];
  for (const cell of parsed.value?.cells ?? []) {
    if (cell.day !== activeDay.value) continue;
    cell.courses.forEach((course, index) => list.push({ bigSlot: cell.bigSlot, index, course }));
  }
  return list.sort((a, b) => a.bigSlot - b.bigSlot);
});
const nextCourse = computed(() => {
  if (activeDay.value !== dayOfWeek()) return null;
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  return dayCourses.value.find((item) => bigSlotStart(item.bigSlot) >= minutes) ?? dayCourses.value[0] ?? null;
});

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

async function prevDay() {
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
  if (activeDay.value < 7) {
    activeDay.value += 1;
    saveLastState();
    return;
  }
  if (!canChangeWeek(1)) return;
  activeDay.value = 1;
  await changeWeek(1);
}

function onTouchStart(e: TouchEvent) {
  const t = e.changedTouches[0];
  touchStartX = t.clientX;
  touchStartY = t.clientY;
}

function onTouchEnd(e: TouchEvent) {
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStartX;
  const dy = t.clientY - touchStartY;
  if (Math.abs(dx) < 54 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
  if (dx < 0) void nextDay();
  else void prevDay();
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

function bigSlotTime(slot: number) {
  return ["08:00-09:35", "10:00-11:35", "13:30-15:05", "15:25-17:00", "18:30-20:05"][slot - 1] ?? "";
}

function bigSlotStart(slot: number) {
  return [480, 600, 810, 925, 1110][slot - 1] ?? 0;
}

const colors = ["#168776", "#2563eb", "#c2410c", "#7c3aed", "#0f766e", "#be123c", "#4d7c0f", "#0369a1"];
function colorFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return colors[h % colors.length];
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
  min-height: 100dvh;
  padding: calc(env(safe-area-inset-top) + 14px) 14px calc(env(safe-area-inset-bottom) + 18px);
  background: #f6f8fb;
  color: #172033;
}
.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0 auto 14px;
  max-width: 720px;
}
.eyebrow {
  color: #168776;
  font-size: 12px;
  font-weight: 700;
}
h1 {
  margin: 2px 0 0;
  font-size: 30px;
  line-height: 1.1;
  letter-spacing: 0;
}
.top-actions {
  display: flex;
  gap: 8px;
}
.icon-btn {
  width: 42px;
  height: 42px;
  border: 1px solid #dde4ee;
  border-radius: 12px;
  background: #fff;
  color: #172033;
  display: grid;
  place-items: center;
  touch-action: manipulation;
}
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
  border-radius: 13px;
  background: #e8f6f3;
  color: #116b5f;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
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
  grid-template-columns: repeat(7, minmax(54px, 1fr));
  gap: 7px;
  overflow-x: auto;
  scrollbar-width: none;
}
.week-strip::-webkit-scrollbar {
  display: none;
}
.day-pill {
  min-width: 54px;
  border: 1px solid #dde4ee;
  border-radius: 13px;
  background: #fff;
  padding: 8px 4px;
  color: #5c6677;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  touch-action: manipulation;
}
.day-pill span {
  font-size: 12px;
}
.day-pill b {
  font-size: 13px;
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
.course-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.course-card {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  gap: 12px;
  background: #fff;
  border: 1px solid #e8edf4;
  border-left: 5px solid var(--accent);
  border-radius: 14px;
  padding: 13px 12px;
  box-shadow: 0 6px 18px rgba(24, 34, 51, 0.05);
}
.time {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: #667085;
}
.time b {
  color: var(--accent);
  font-size: 13px;
}
.time span {
  font-size: 12px;
}
.course-main {
  min-width: 0;
}
.course-main h2 {
  margin: 0 0 7px;
  font-size: 17px;
  line-height: 1.35;
}
.course-main p {
  margin: 4px 0 0;
  color: #475467;
  display: flex;
  align-items: center;
  gap: 5px;
  line-height: 1.45;
  word-break: break-word;
}
.course-main .muted {
  color: #8a94a6;
  font-size: 12px;
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
.next-card {
  margin-top: 14px;
  padding: 13px 14px;
  border-radius: 14px;
  background: #e8f6f3;
  color: #116b5f;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.next-card span,
.next-card em {
  font-size: 12px;
  font-style: normal;
}
.next-card b {
  font-size: 15px;
}

@media (min-width: 760px) {
  .schedule-page {
    padding-top: 28px;
  }
}

@media (max-width: 390px) {
  .schedule-page {
    padding-left: 10px;
    padding-right: 10px;
  }
  .course-card {
    grid-template-columns: 78px minmax(0, 1fr);
    padding: 12px 10px;
  }
  .course-main h2 {
    font-size: 16px;
  }
  .week-switcher {
    grid-template-columns: 82px minmax(0, 1fr) 82px;
    gap: 6px;
  }
  .week-btn {
    font-size: 12px;
  }
}
</style>
