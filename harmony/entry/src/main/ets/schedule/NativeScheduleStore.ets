export interface NativeScheduleSemester {
  value: string;
  label: string;
  current: boolean;
}

export interface NativeScheduleWeek {
  value: string;
  label: string;
  current: boolean;
}

export interface NativeScheduleCourse {
  name: string;
  nativeId?: string;
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
  orphaned?: boolean;
  customStartTime?: string;
  customEndTime?: string;
}

export interface NativeScheduleCell {
  day: number;
  bigSlot: number;
  courses: NativeScheduleCourse[];
}

export interface NativeCalendarWeek {
  week: number;
  days: string[];
  monday: string;
  sunday: string;
}

// 学期配置的调休：off 放假，swap 这天上 source 那天的课。
export interface NativeScheduleAdjustment {
  date: string;
  kind: string;
  source?: string;
  note?: string;
}

// 桥接层规整过的节次时间（snapshot.periods）。
export interface NativeSchedulePeriod {
  number: number;
  startTime: string;
  endTime: string;
}

export interface NativeCalendarPeriod {
  id: number;
  name?: string;
  start: string;
  end: string;
}

// Compatibility for old servers without period configuration. Configured periods
// take precedence; their count and times drive the grid, editor and exports.
const BUNDLED_PERIODS: NativeSchedulePeriod[] = [
  { number: 1, startTime: '08:00', endTime: '08:45' },
  { number: 2, startTime: '08:55', endTime: '09:40' },
  { number: 3, startTime: '09:55', endTime: '10:40' },
  { number: 4, startTime: '10:50', endTime: '11:35' },
  { number: 5, startTime: '13:30', endTime: '14:15' },
  { number: 6, startTime: '14:25', endTime: '15:10' },
  { number: 7, startTime: '15:25', endTime: '16:10' },
  { number: 8, startTime: '16:20', endTime: '17:05' },
  { number: 9, startTime: '18:30', endTime: '19:15' },
  { number: 10, startTime: '19:25', endTime: '20:10' },
  { number: 11, startTime: '20:20', endTime: '21:05' }
];

export interface NativeScheduleCalendar {
  periods?: NativeCalendarPeriod[];
  source?: string;
  semesters?: NativeScheduleSemester[];
  currentSemester?: string;
  currentWeek: number;
  semesterStart: string;
  semesterEnd: string;
  weeks: NativeCalendarWeek[];
  adjustments?: NativeScheduleAdjustment[];
}

export interface NativeScheduleResult {
  source?: string;
  semesters: NativeScheduleSemester[];
  weeks: NativeScheduleWeek[];
  currentSemester: string;
  currentWeek: string;
  cells: NativeScheduleCell[];
}

interface NativeScheduleAuth {
  authenticated: boolean;
  identity?: string;
}

export interface NativeScheduleSnapshot {
  version: number;
  completeSemester?: boolean;
  source?: string;
  fetchedAt?: number | string;
  periods?: NativeSchedulePeriod[];
  data?: NativeScheduleResult;
  calendar?: NativeScheduleCalendar;
  auth: NativeScheduleAuth;
  error?: string;
}

export interface NativeScheduleRequest {
  id: string;
  semester: string;
  week: string;
  force: boolean;
}

export interface NativeCourseBlock {
  day: number;
  bigSlot: number;
  startSlot: number;
  endSlot: number;
  course: NativeScheduleCourse;
}

interface NativeScheduleCacheEntry {
  snapshot: NativeScheduleSnapshot;
  savedAt: number;
}

interface PersistedScheduleCache {
  version: number;
  accountScope: string;
  semester: string;
  week: string;
  day: number;
  viewMode: string;
  snapshots: NativeScheduleSnapshot[];
}

export type NativeScheduleStatus = 'idle' | 'loading' | 'loaded' | 'unauthorized' | 'failed';
export type NativeScheduleRequester = (request: NativeScheduleRequest) => void;
export type NativeScheduleChangeListener = () => void;
// 拿到登录后的课表快照（整学期或单周）时收到快照；退出登录、换账号时收到 undefined。
export type NativeScheduleSnapshotListener = (snapshot?: NativeScheduleSnapshot) => void;

const CACHE_LIFETIME_MS: number = 30 * 24 * 60 * 60 * 1000;
const MAX_SEMESTERS: number = 4;

@Observed
export class NativeScheduleStore {
  status: NativeScheduleStatus = 'idle';
  result?: NativeScheduleResult;
  calendar?: NativeScheduleCalendar;
  periods: NativeSchedulePeriod[] = BUNDLED_PERIODS.slice();
  selectedSemester: string = '';
  selectedWeek: string = '';
  selectedDay: number = (new Date().getDay() || 7);
  detailVisible: boolean = false;
  weekPickerVisible: boolean = false;
  palette: string = 'color-glass';
  dark: boolean = false;
  backgroundPath: string = '';
  backgroundOpacity: number = 0.18;
  viewMode: string = 'week';
  errorMessage: string = '';
  lastUpdatedAt: number = 0;
  source: string = '';
  bridgeReady: boolean = false;
  dataRevision: number = 0;

  private requester?: NativeScheduleRequester;
  private listener?: NativeScheduleChangeListener;
  private cache: Map<string, NativeScheduleCacheEntry> = new Map<string, NativeScheduleCacheEntry>();
  private navigationSemesters: NativeScheduleSemester[] = [];
  private navigationWeeks: NativeScheduleWeek[] = [];
  private activeRequestId: string = '';
  private requestGeneration: number = 0;
  private pendingKey: string = '';
  private pendingForce: boolean = false;
  private refreshBarrier: number = 0;
  private requestTimer: number = -1;
  private accountScope: string = '';
  private persistence?: (raw: string) => void;
  private snapshotListener?: NativeScheduleSnapshotListener;

  attachPersistence(writer: (raw: string) => void): void { this.persistence = writer; }

  attachSnapshotListener(listener: NativeScheduleSnapshotListener): void { this.snapshotListener = listener; }

  restoreCache(raw: string): void {
    if (this.result || this.accountScope || !raw) return;
    try {
      const saved = JSON.parse(raw) as PersistedScheduleCache;
      if (saved.version !== 1 || !saved.accountScope || !Array.isArray(saved.snapshots)) return;
      saved.snapshots.forEach((snapshot: NativeScheduleSnapshot) => {
        const time = this.snapshotTime(snapshot);
        if (snapshot.version === 1 && snapshot.auth?.authenticated && !snapshot.error &&
          snapshot.data && Array.isArray(snapshot.data.cells) && snapshot.fetchedAt &&
          Number.isFinite(time) && time <= Date.now() && Date.now() - time <= CACHE_LIFETIME_MS) this.remember(snapshot);
      });
      const entry = this.freshCache(saved.semester, saved.week);
      if (!entry) { this.cache.clear(); return; }
      this.accountScope = saved.accountScope;
      this.selectedSemester = saved.semester;
      this.selectedWeek = saved.week;
      this.selectedDay = saved.day >= 1 && saved.day <= 7 ? saved.day : (new Date().getDay() || 7);
      this.viewMode = saved.viewMode === 'day' ? 'day' : 'week';
      this.applySnapshot(entry.snapshot, true);
      this.snapshotListener?.(entry.snapshot);
    } catch (_) { this.cache.clear(); }
  }

  private persistCache(): void {
    if (!this.persistence) return;
    const snapshots: NativeScheduleSnapshot[] = [];
    this.cache.forEach((entry: NativeScheduleCacheEntry) => snapshots.push(entry.snapshot));
    const saved: PersistedScheduleCache = { version: 1, accountScope: this.accountScope,
      semester: this.selectedSemester, week: this.selectedWeek, day: this.selectedDay,
      viewMode: this.viewMode, snapshots };
    this.persistence(this.accountScope && snapshots.length ? JSON.stringify(saved) : '');
  }

  attach(requester: NativeScheduleRequester, listener: NativeScheduleChangeListener): void {
    this.requester = requester;
    this.listener = listener;
  }

  markBridgeReady(): void {
    this.bridgeReady = true;
    this.notify();
    if (this.status === 'idle' || this.status === 'failed' ||
      (this.status === 'loading' && !this.activeRequestId)) this.load(false);
  }

  markBridgeUnavailable(message: string = ''): void {
    this.bridgeReady = false;
    this.cancelRequest();
    if (message) this.fail(message);
  }

  private cancelRequest(): void {
    this.activeRequestId = '';
    this.pendingKey = '';
    this.pendingForce = false;
    clearTimeout(this.requestTimer);
  }

  load(force: boolean): void {
    if (!force) {
      const cached = this.freshCache(this.selectedSemester, this.selectedWeek);
      if (cached) {
        if (this.status === 'loaded' && this.result === cached.snapshot.data && !this.errorMessage) return;
        this.cancelRequest();
        this.applySnapshot(cached.snapshot, true);
        return;
      }
    }
    const key = `${this.selectedSemester}|${this.selectedWeek}`;
    if (this.activeRequestId && this.pendingKey === key && (!force || this.pendingForce)) return;
    this.cancelRequest();
    if (force) {
      this.refreshBarrier = Date.now();
    }
    if (!this.bridgeReady || !this.requester) {
      if (!this.result) this.status = 'loading';
      this.notify();
      return;
    }
    this.requestGeneration += 1;
    this.activeRequestId = `schedule-${Date.now()}-${this.requestGeneration}`;
    this.pendingKey = key;
    this.pendingForce = force;
    const requestId = this.activeRequestId;
    this.requestTimer = setTimeout(() => {
      if (this.activeRequestId !== requestId) return;
      this.cancelRequest();
      this.fail('请求超时，请检查网络后重试');
    }, 60000);
    this.status = 'loading';
    this.errorMessage = '';
    this.notify();
    this.requester({
      id: this.activeRequestId,
      semester: this.selectedSemester,
      week: this.selectedWeek,
      force
    });
  }

  selectSemester(value: string): void {
    const semester = value.trim();
    if (!semester || semester === this.selectedSemester) return;
    this.selectedSemester = semester;
    this.navigationWeeks = [];
    this.selectedWeek = '';
    this.result = undefined;
    this.calendar = undefined;
    this.load(false);
  }

  selectWeek(value: string): void {
    const week = value.trim();
    if (!week || week === this.selectedWeek) return;
    this.selectedWeek = week;
    this.cancelRequest();
    const cached = this.freshCache(this.selectedSemester, week);
    if (cached) {
      this.applySnapshot(cached.snapshot, true);
      this.notifyPriority();
      return;
    }
    this.result = undefined;
    this.load(false);
  }

  selectDay(day: number): void {
    if (day < 1 || day > 7 || this.selectedDay === day) return;
    this.selectedDay = day;
    this.notify();
  }

  setViewMode(mode: string): void {
    const normalized = mode === 'day' ? 'day' : 'week';
    if (this.viewMode === normalized) return;
    this.viewMode = normalized;
    this.notify();
  }

  returnToCurrentWeek(): void {
    this.cancelRequest();
    this.selectedSemester = '';
    this.navigationWeeks = [];
    this.selectedWeek = '';
    this.selectedDay = new Date().getDay() || 7;
    this.result = undefined;
    this.calendar = undefined;
    this.load(false);
  }

  acceptResult(id: string, raw: string): void {
    if (!id || id !== this.activeRequestId) return;
    const refreshed = this.pendingForce;
    this.cancelRequest();
    let snapshot: NativeScheduleSnapshot;
    try {
      snapshot = JSON.parse(raw) as NativeScheduleSnapshot;
    } catch (_) {
      this.fail('课表数据无法读取');
      return;
    }
    if (!snapshot.auth?.authenticated) {
      this.cache.clear();
      this.detailVisible = false;
      this.weekPickerVisible = false;
      this.refreshBarrier = Date.now();
      this.status = 'unauthorized';
      this.navigationWeeks = [];
      this.errorMessage = '';
      this.result = undefined;
      this.calendar = undefined;
      this.notify();
      this.snapshotListener?.(undefined);
      return;
    }
    if (snapshot.error) {
      this.fail(snapshot.error);
      return;
    }
    if (snapshot.version !== 1 || !snapshot.data || !Array.isArray(snapshot.data.cells)) {
      this.fail('教务系统未返回有效课表');
      return;
    }
    if (this.selectedSemester && snapshot.data.currentSemester !== this.selectedSemester) {
      this.fail('教务系统返回了其他学期的课表，请重新选择');
      return;
    }
    if (refreshed) {
      const obsolete: string[] = [];
      this.cache.forEach((_entry: NativeScheduleCacheEntry, key: string) => {
        if (key.startsWith(snapshot.data!.currentSemester + '|')) obsolete.push(key);
      });
      obsolete.forEach((key: string) => this.cache.delete(key));
    }
    this.remember(snapshot);
    this.applySnapshot(snapshot, false);
    this.snapshotListener?.(snapshot);
  }

  acceptPrefetched(raw: string): void {
    let snapshot: NativeScheduleSnapshot;
    try {
      snapshot = JSON.parse(raw) as NativeScheduleSnapshot;
    } catch (_) {
      return;
    }
    if (snapshot.version !== 1 || !snapshot.auth?.authenticated || !snapshot.data || snapshot.error) return;
    const time = this.snapshotTime(snapshot);
    if (time < this.refreshBarrier || Date.now() - time > CACHE_LIFETIME_MS) return;
    let known = false;
    let newer = false;
    this.cache.forEach((entry: NativeScheduleCacheEntry) => {
      if (entry.snapshot.data?.currentSemester === snapshot.data?.currentSemester) {
        known = true;
        if (entry.savedAt > time) newer = true;
      }
    });
    if (!known || newer) return;
    this.remember(snapshot);
    this.snapshotListener?.(snapshot);
    if (snapshot.completeSemester && !this.activeRequestId && snapshot.data.currentSemester === this.selectedSemester) {
      this.applySnapshot(snapshot, false);
    }
  }

  handleAuthChanged(scope: string = ''): boolean {
    if (scope && scope === this.accountScope) return false;
    this.accountScope = scope;
    this.requestGeneration += 1;
    this.cancelRequest();
    this.refreshBarrier = Date.now();
    this.cache.clear();
    this.result = undefined;
    this.navigationSemesters = [];
    this.navigationWeeks = [];
    this.calendar = undefined;
    this.detailVisible = false;
    this.weekPickerVisible = false;
    this.selectedSemester = '';
    this.selectedWeek = '';
    this.errorMessage = '';
    this.lastUpdatedAt = 0;
    this.status = 'idle';
    this.persistCache();
    this.snapshotListener?.(undefined);
    if (this.bridgeReady && this.requester) {
      this.load(false);
      return true;
    }
    this.notify();
    return true;
  }

  visibleCells(): NativeScheduleCell[] {
    if (!this.result) return [];
    const week = Number(this.selectedWeek || this.result.currentWeek);
    const visible: NativeScheduleCell[] = [];
    this.result.cells.forEach((cell: NativeScheduleCell) => {
      const courses = cell.courses.filter((course: NativeScheduleCourse) => {
        return !course.weekList?.length || !Number.isFinite(week) || course.weekList.includes(week);
      });
      if (courses.length > 0) visible.push({ day: cell.day, bigSlot: cell.bigSlot, courses });
    });
    return visible;
  }

  blocksForDay(day: number): NativeCourseBlock[] {
    return this.mergedBlocks(this.visibleCells(), day);
  }

  // 任意一周某天的课块，合并规则与课表页一致；小组件按日期展开整学期时用。
  blocksInWeek(cells: NativeScheduleCell[], day: number, week: number): NativeCourseBlock[] {
    const visible: NativeScheduleCell[] = [];
    cells.forEach((cell: NativeScheduleCell) => {
      const courses = cell.courses.filter((course: NativeScheduleCourse) => {
        return !course.weekList?.length || course.weekList.includes(week);
      });
      if (courses.length > 0) visible.push({ day: cell.day, bigSlot: cell.bigSlot, courses });
    });
    return this.mergedBlocks(visible, day);
  }

  private mergedBlocks(cells: NativeScheduleCell[], day: number): NativeCourseBlock[] {
    const blocks: NativeCourseBlock[] = [];
    const maxSlot = this.slotCount();
    cells.filter((cell: NativeScheduleCell) => cell.day === day).forEach((cell: NativeScheduleCell) => {
      cell.courses.forEach((course: NativeScheduleCourse) => {
        const fallbackStart = Math.max(1, Math.min(maxSlot, cell.bigSlot * 2 - 1));
        const fallbackEnd = Math.max(fallbackStart, Math.min(maxSlot, cell.bigSlot * 2));
        const startSlot = Math.max(1, Math.min(maxSlot, Number(course.startSlot) || fallbackStart));
        const endSlot = Math.max(startSlot, Math.min(maxSlot, Number(course.endSlot) || fallbackEnd));
        const block: NativeCourseBlock = { day, bigSlot: cell.bigSlot, startSlot, endSlot, course };
        const index = blocks.findIndex((candidate: NativeCourseBlock) => this.canMergeBlocks(candidate, block));
        if (index < 0) {
          blocks.push({ day, bigSlot: Math.ceil(startSlot / 2), startSlot, endSlot,
            course: this.courseWithRange(course, startSlot, endSlot) });
          return;
        }
        const previous = blocks[index];
        previous.endSlot = Math.max(previous.endSlot, endSlot);
        previous.bigSlot = Math.ceil(previous.startSlot / 2);
        previous.course = this.courseWithRange(previous.course, previous.startSlot, previous.endSlot, course);
      });
    });
    return blocks.sort((left: NativeCourseBlock, right: NativeCourseBlock) => left.startSlot - right.startSlot);
  }

  private canMergeBlocks(left: NativeCourseBlock, right: NativeCourseBlock): boolean {
    if (left.course.customId || right.course.customId) return left.course.customId === right.course.customId
      && this.rangesOverlap(left, right);
    const sameName = this.identityPart(left.course.name) === this.identityPart(right.course.name);
    const sameTeacher = this.teachersCompatible(left.course.teacher, right.course.teacher);
    const sameLocation = this.locationsCompatible(left.course.location, right.course.location);
    const overlaps = this.rangesOverlap(left, right);
    const adjacent = left.endSlot + 1 === right.startSlot || right.endSlot + 1 === left.startSlot;
    const leftIdentity = this.explicitIdentity(left.course);
    const rightIdentity = this.explicitIdentity(right.course);
    if (leftIdentity && rightIdentity && leftIdentity !== rightIdentity) return false;
    return sameName && sameTeacher && sameLocation && (overlaps || adjacent);
  }

  private rangesOverlap(left: NativeCourseBlock, right: NativeCourseBlock): boolean {
    return left.startSlot <= right.endSlot && right.startSlot <= left.endSlot;
  }

  private teachersCompatible(left?: string, right?: string): boolean {
    const a = this.teacherIdentity(left);
    const b = this.teacherIdentity(right);
    return !a || !b || a === b;
  }

  private locationsCompatible(left?: string, right?: string): boolean {
    const a = this.locationIdentity(left);
    const b = this.locationIdentity(right);
    return !a || !b || a === b;
  }

  private explicitIdentity(course: NativeScheduleCourse): string {
    if (course.sourceKey) return `source:${course.sourceKey}`;
    if (course.nativeId && (course.nativeId.startsWith('source:') || course.nativeId.startsWith('custom:'))) {
      return course.nativeId;
    }
    return '';
  }

  private identityPart(value?: string): string {
    return (value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '')
      .replace(/[.,，。:：;；/\\()[\]{}【】_—–~～-]+/g, '');
  }

  private teacherIdentity(value?: string): string {
    return this.identityPart(value).replace(/(?:其他正高级|其他副高级|正高级|副高级|主任医师|副主任医师|高级实验师|副研究员|实验师|研究员|副教授|教授|讲师|助教|未评级)$/u, '');
  }

  private locationIdentity(value?: string): string {
    const compact = this.identityPart(value);
    const match = compact.match(/[a-z]?\d{2,4}[a-z]?$/i);
    if (!match) return compact;
    const prefix = compact.slice(0, compact.length - match[0].length);
    if (!prefix || !/[a-z0-9]$/i.test(prefix)) return match[0];
    return compact;
  }

  private slotLabel(start: number, end: number): string {
    const first = String(start).padStart(2, '0');
    return start === end ? `${first}节` : `${first}-${String(end).padStart(2, '0')}节`;
  }

  private courseWithRange(course: NativeScheduleCourse, startSlot: number, endSlot: number, next?: NativeScheduleCourse): NativeScheduleCourse {
    const weekList: number[] = [];
    (course.weekList ?? []).forEach((week: number) => {
      if (!weekList.includes(week)) weekList.push(week);
    });
    (next?.weekList ?? []).forEach((week: number) => {
      if (!weekList.includes(week)) weekList.push(week);
    });
    weekList.sort((a: number, b: number) => a - b);
    return { name: course.name, nativeId: course.nativeId ?? next?.nativeId, teacher: course.teacher ?? next?.teacher, weeks: weekList.length ? this.weekText(weekList) : (course.weeks || next?.weeks || ''), weekList,
      location: course.location ?? next?.location, slotNote: this.slotLabel(startSlot, endSlot), startSlot, endSlot,
      sourceKey: course.sourceKey, customId: course.customId, custom: course.custom, orphaned: course.orphaned,
      customStartTime: course.customStartTime ?? next?.customStartTime, customEndTime: course.customEndTime ?? next?.customEndTime };
  }

  private weekText(values: number[]): string {
    if (!values.length) return '';
    const ranges: string[] = [];
    let start = values[0];
    let end = values[0];
    values.slice(1).forEach((value: number) => {
      if (value === end + 1) { end = value; return; }
      ranges.push(start === end ? `${start}` : `${start}-${end}`);
      start = value; end = value;
    });
    ranges.push(start === end ? `${start}` : `${start}-${end}`);
    return `${ranges.join('、')}周`;
  }

  semesterOptions(): NativeScheduleSemester[] {
    return this.navigationSemesters;
  }

  weekOptions(): NativeScheduleWeek[] {
    return this.result?.weeks ?? this.navigationWeeks;
  }

  previewWeek(week: string): NativeScheduleStore {
    const preview = new NativeScheduleStore();
    preview.dataRevision = this.dataRevision;
    preview.selectedSemester = this.selectedSemester;
    preview.selectedWeek = week;
    preview.selectedDay = this.selectedDay;
    preview.viewMode = this.viewMode;
    preview.calendar = this.calendar;
    preview.periods = this.periods;
    preview.source = this.source;
    // Adjacent pages may only display a matching cached week or a complete term.
    const cached = this.freshCache(this.selectedSemester, week);
    preview.result = week === this.selectedWeek ? this.result : cached?.snapshot.data;
    preview.status = week === this.selectedWeek ? this.status : preview.result ? 'loaded' : 'loading';
    preview.errorMessage = week === this.selectedWeek ? this.errorMessage : '';
    return preview;
  }

  selectedSemesterIndex(): number {
    return Math.max(0, this.semesterOptions().findIndex((item: NativeScheduleSemester) => item.value === this.selectedSemester));
  }

  selectedWeekIndex(): number {
    return Math.max(0, this.weekOptions().findIndex((item: NativeScheduleWeek) => item.value === this.selectedWeek));
  }

  canMoveWeek(delta: number): boolean {
    const index = this.weekOptions().findIndex((item: NativeScheduleWeek) => item.value === this.selectedWeek);
    return index >= 0 && index + delta >= 0 && index + delta < this.weekOptions().length;
  }

  moveWeek(delta: number): void {
    if (!this.canMoveWeek(delta)) return;
    this.selectWeek(this.weekOptions()[this.selectedWeekIndex() + delta].value);
  }

  dayDate(day: number): string {
    const week = Number(this.selectedWeek || this.result?.currentWeek || 0);
    const calendarWeek = this.calendar?.weeks?.find((item: NativeCalendarWeek) => item.week === week);
    const value = calendarWeek?.days?.[day - 1] ?? '';
    return value.length >= 10 ? value.substring(5) : value;
  }

  isToday(day: number): boolean {
    const week = Number(this.selectedWeek || this.result?.currentWeek || 0);
    const value = this.calendar?.weeks?.find((item: NativeCalendarWeek) => item.week === week)?.days?.[day - 1];
    if (!value) return false;
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return value === today;
  }

  currentWeekValue(): string {
    if (this.calendar?.currentWeek) return String(this.calendar.currentWeek);
    const current = this.weekOptions().find((item: NativeScheduleWeek) => item.current);
    return current?.value ?? this.result?.currentWeek ?? '';
  }

  slotCount(): number {
    return this.periods.reduce((count: number, period: NativeSchedulePeriod) => Math.max(count, period.number), 1);
  }

  slots(): number[] {
    const slots: number[] = [];
    for (let number = 1; number <= this.slotCount(); number++) slots.push(number);
    return slots;
  }

  slotStart(number: number): string {
    return this.periods.find((period: NativeSchedulePeriod) => period.number === number)?.startTime ?? '';
  }

  slotEnd(number: number): string {
    return this.periods.find((period: NativeSchedulePeriod) => period.number === number)?.endTime ?? '';
  }

  private snapshotPeriods(snapshot: NativeScheduleSnapshot): NativeSchedulePeriod[] {
    const configured = snapshot.calendar?.periods?.map((period: NativeCalendarPeriod): NativeSchedulePeriod =>
      ({ number: period.id, startTime: period.start, endTime: period.end }));
    const valid = (configured?.length ? configured : snapshot.periods ?? [])
      .filter((period: NativeSchedulePeriod) => Number.isInteger(period.number) && period.number >= 1 && period.number <= 30)
      .sort((left: NativeSchedulePeriod, right: NativeSchedulePeriod) => left.number - right.number);
    return valid.length ? valid : BUNDLED_PERIODS.slice();
  }

  private applySnapshot(snapshot: NativeScheduleSnapshot, fromCache: boolean): void {
    if (!snapshot.data) return;
    this.rememberNavigationSemesters(snapshot);
    this.result = snapshot.data;
    this.navigationWeeks = snapshot.data.weeks;
    this.calendar = snapshot.calendar;
    this.periods = this.snapshotPeriods(snapshot);
    if (!this.selectedSemester) this.selectedSemester = snapshot.data.currentSemester;
    if (!this.selectedWeek) {
      this.selectedWeek = snapshot.data.currentWeek || (snapshot.calendar?.currentWeek ? String(snapshot.calendar.currentWeek) : '');
    }
    this.source = snapshot.source ?? snapshot.data.source ?? '';
    this.lastUpdatedAt = this.snapshotTime(snapshot);
    this.errorMessage = '';
    this.status = 'loaded';
    if (!fromCache && this.selectedDay < 1) this.selectedDay = 1;
    this.notify();
  }

  private rememberNavigationSemesters(snapshot: NativeScheduleSnapshot): void {
    const canonical = this.uniqueSemesters(snapshot.calendar?.semesters?.length
      ? snapshot.calendar.semesters
      : snapshot.data?.semesters);
    // A term selected from the picker is a data request, not a new authority
    // for the picker. Older JWXT pages sometimes echo course/history filters as
    // bogus term options. Keep the last verified option set while switching,
    // otherwise one broken historic response can turn five real terms into a
    // long, unusable list. A fresh automatic/current-term load is allowed to
    // replace it so the list can advance naturally when a new term begins.
    if (!this.navigationSemesters.length || !this.selectedSemester) {
      this.navigationSemesters = canonical;
    }
  }

  private uniqueSemesters(items?: NativeScheduleSemester[]): NativeScheduleSemester[] {
    const values: NativeScheduleSemester[] = [];
    const indexByValue: Map<string, number> = new Map<string, number>();
    items?.forEach((item: NativeScheduleSemester) => {
      const value = item.value.trim();
      if (!value) return;
      const index = indexByValue.get(value);
      if (index === undefined) {
        indexByValue.set(value, values.length);
        values.push({ value, label: item.label || value, current: item.current });
      } else if (item.current) {
        values[index].current = true;
      }
    });
    return values;
  }

  private fail(message: string): void {
    this.errorMessage = message || '课表暂时无法加载，请重试';
    this.status = this.result ? 'loaded' : 'failed';
    this.notify();
  }

  private remember(snapshot: NativeScheduleSnapshot): void {
    if (!snapshot.data) return;
    const semester = snapshot.data.currentSemester;
    const week = snapshot.data.currentWeek;
    const entry: NativeScheduleCacheEntry = { snapshot, savedAt: this.snapshotTime(snapshot) };
    if (snapshot.completeSemester) {
      const obsoleteKeys: string[] = [];
      this.cache.forEach((_value: NativeScheduleCacheEntry, key: string) => {
        if (key.startsWith(`${semester}|`)) obsoleteKeys.push(key);
      });
      obsoleteKeys.forEach((key: string) => this.cache.delete(key));
      this.cache.set(`${semester}|*`, entry);
    } else {
      this.cache.set(`${semester}|${week}`, entry);
    }
    this.trimCache();
    this.dataRevision += 1;
    this.persistCache();
  }

  private freshCache(semester: string, week: string): NativeScheduleCacheEntry | undefined {
    if (!semester) return undefined;
    const entry = this.cache.get(`${semester}|*`) ?? this.cache.get(`${semester}|${week}`);
    if (!entry) return undefined;
    if (Date.now() - entry.savedAt > CACHE_LIFETIME_MS) {
      this.cache.delete(`${semester}|*`);
      this.cache.delete(`${semester}|${week}`);
      return undefined;
    }
    return entry;
  }

  private trimCache(): void {
    const semesters: string[] = [];
    this.cache.forEach((_value: NativeScheduleCacheEntry, key: string) => {
      const semester = key.split('|')[0];
      if (!semesters.includes(semester)) semesters.push(semester);
    });
    while (semesters.length > MAX_SEMESTERS) {
      const oldest = semesters.shift();
      if (!oldest) break;
      const keys: string[] = [];
      this.cache.forEach((_value: NativeScheduleCacheEntry, key: string) => {
        if (key.startsWith(`${oldest}|`)) keys.push(key);
      });
      keys.forEach((key: string) => this.cache.delete(key));
    }
  }

  private snapshotTime(snapshot: NativeScheduleSnapshot): number {
    if (typeof snapshot.fetchedAt === 'number') return snapshot.fetchedAt;
    if (typeof snapshot.fetchedAt === 'string') {
      const parsed = Date.parse(snapshot.fetchedAt);
      if (Number.isFinite(parsed)) return parsed;
    }
    return Date.now();
  }

  private notifyPriority(): void {
    if (!this.requester || !this.selectedSemester || !this.selectedWeek) return;
    this.requester({
      id: '',
      semester: this.selectedSemester,
      week: this.selectedWeek,
      force: false
    });
  }

  private notify(): void {
    this.persistCache();
    this.listener?.();
  }
}
