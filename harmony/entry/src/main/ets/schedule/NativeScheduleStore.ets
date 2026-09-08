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

export interface NativeScheduleCalendar {
  source?: string;
  semesters?: NativeScheduleSemester[];
  currentSemester?: string;
  currentWeek: number;
  semesterStart: string;
  semesterEnd: string;
  weeks: NativeCalendarWeek[];
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

const CACHE_LIFETIME_MS: number = 30 * 24 * 60 * 60 * 1000;
const MAX_SEMESTERS: number = 4;

@Observed
export class NativeScheduleStore {
  status: NativeScheduleStatus = 'idle';
  result?: NativeScheduleResult;
  calendar?: NativeScheduleCalendar;
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
  private navigationWeeks: NativeScheduleWeek[] = [];
  private activeRequestId: string = '';
  private requestGeneration: number = 0;
  private pendingKey: string = '';
  private refreshBarrier: number = 0;
  private requestTimer: number = -1;
  private accountScope: string = '';
  private persistence?: (raw: string) => void;

  attachPersistence(writer: (raw: string) => void): void { this.persistence = writer; }

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
    if (!force && this.activeRequestId && this.pendingKey === key) return;
    this.cancelRequest();
    if (force) {
      this.refreshBarrier = Date.now();
      this.cache.clear();
    }
    if (!this.bridgeReady || !this.requester) {
      if (!this.result) this.status = 'loading';
      this.notify();
      return;
    }
    this.requestGeneration += 1;
    this.activeRequestId = `schedule-${Date.now()}-${this.requestGeneration}`;
    this.pendingKey = key;
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
    this.remember(snapshot);
    this.applySnapshot(snapshot, false);
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
    const groups: Map<string, NativeCourseBlock[]> = new Map<string, NativeCourseBlock[]>();
    this.visibleCells().filter((cell: NativeScheduleCell) => cell.day === day).forEach((cell: NativeScheduleCell) => {
      cell.courses.forEach((course: NativeScheduleCourse) => {
        const fallbackStart = Math.max(1, Math.min(11, cell.bigSlot * 2 - 1));
        const fallbackEnd = Math.max(fallbackStart, Math.min(11, cell.bigSlot * 2));
        let startSlot = Math.max(1, Math.min(11, Number(course.startSlot) || fallbackStart));
        let endSlot = Math.max(startSlot, Math.min(11, Number(course.endSlot) || fallbackEnd));
        if (endSlot < fallbackStart || startSlot > fallbackEnd) {
          startSlot = fallbackStart;
          endSlot = fallbackEnd;
        }
        const key = [course.customId ?? '', course.name, course.teacher ?? '', course.location ?? '', course.weeks]
          .map((value: string) => value.trim().replace(/\s+/g, ' ')).join('|');
        const list = groups.get(key) ?? [];
        list.push({ day, bigSlot: cell.bigSlot, startSlot, endSlot, course });
        groups.set(key, list);
      });
    });
    const blocks: NativeCourseBlock[] = [];
    groups.forEach((list: NativeCourseBlock[]) => {
      const merged: NativeCourseBlock[] = [];
      list.sort((left: NativeCourseBlock, right: NativeCourseBlock) => left.startSlot - right.startSlot || left.endSlot - right.endSlot);
      list.forEach((block: NativeCourseBlock) => {
        const previous = merged[merged.length - 1];
        if (previous && block.startSlot <= previous.endSlot + 1) {
          previous.endSlot = Math.max(previous.endSlot, block.endSlot);
          previous.course = this.courseWithRange(previous.course, previous.startSlot, previous.endSlot);
        } else {
          merged.push({ day: block.day, bigSlot: Math.ceil(block.startSlot / 2), startSlot: block.startSlot,
            endSlot: block.endSlot, course: this.courseWithRange(block.course, block.startSlot, block.endSlot) });
        }
      });
      merged.forEach((block: NativeCourseBlock) => blocks.push(block));
    });
    return blocks.sort((left: NativeCourseBlock, right: NativeCourseBlock) => left.startSlot - right.startSlot);
  }

  private slotLabel(start: number, end: number): string {
    const first = String(start).padStart(2, '0');
    return start === end ? `${first}节` : `${first}-${String(end).padStart(2, '0')}节`;
  }

  private courseWithRange(course: NativeScheduleCourse, startSlot: number, endSlot: number): NativeScheduleCourse {
    return { name: course.name, teacher: course.teacher, weeks: course.weeks, weekList: course.weekList,
      location: course.location, slotNote: this.slotLabel(startSlot, endSlot), startSlot, endSlot,
      sourceKey: course.sourceKey, customId: course.customId, custom: course.custom, orphaned: course.orphaned };
  }

  semesterOptions(): NativeScheduleSemester[] {
    if (this.calendar?.semesters?.length) return this.calendar.semesters;
    return this.result?.semesters ?? [];
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

  private applySnapshot(snapshot: NativeScheduleSnapshot, fromCache: boolean): void {
    if (!snapshot.data) return;
    this.result = snapshot.data;
    this.navigationWeeks = snapshot.data.weeks;
    this.calendar = snapshot.calendar;
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
