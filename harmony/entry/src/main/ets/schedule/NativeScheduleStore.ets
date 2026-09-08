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
  startSlot: number;
  endSlot: number;
  course: NativeScheduleCourse;
}

interface NativeScheduleCacheEntry {
  snapshot: NativeScheduleSnapshot;
  savedAt: number;
}

export type NativeScheduleStatus = 'idle' | 'loading' | 'loaded' | 'unauthorized' | 'failed';
export type NativeScheduleRequester = (request: NativeScheduleRequest) => void;
export type NativeScheduleChangeListener = () => void;

const CACHE_LIFETIME_MS: number = 12 * 60 * 60 * 1000;
const MAX_SEMESTERS: number = 4;

@Observed
export class NativeScheduleStore {
  status: NativeScheduleStatus = 'idle';
  result?: NativeScheduleResult;
  calendar?: NativeScheduleCalendar;
  selectedSemester: string = '';
  selectedWeek: string = '';
  selectedDay: number = 1;
  viewMode: string = 'week';
  errorMessage: string = '';
  lastUpdatedAt: number = 0;
  source: string = '';
  bridgeReady: boolean = false;

  private requester?: NativeScheduleRequester;
  private listener?: NativeScheduleChangeListener;
  private cache: Map<string, NativeScheduleCacheEntry> = new Map<string, NativeScheduleCacheEntry>();
  private activeRequestId: string = '';
  private requestGeneration: number = 0;

  attach(requester: NativeScheduleRequester, listener: NativeScheduleChangeListener): void {
    this.requester = requester;
    this.listener = listener;
  }

  markBridgeReady(): void {
    this.bridgeReady = true;
    this.notify();
    if (this.status === 'idle' || this.status === 'failed') this.load(false);
  }

  load(force: boolean): void {
    if (!force) {
      const cached = this.freshCache(this.selectedSemester, this.selectedWeek);
      if (cached) {
        this.applySnapshot(cached.snapshot, true);
        return;
      }
    }
    if (!this.bridgeReady || !this.requester) {
      if (!this.result) this.status = 'loading';
      this.notify();
      return;
    }
    this.requestGeneration += 1;
    this.activeRequestId = `schedule-${Date.now()}-${this.requestGeneration}`;
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
    const current = this.currentWeekValue();
    this.selectedWeek = current;
    this.load(false);
  }

  selectWeek(value: string): void {
    const week = value.trim();
    if (!week || week === this.selectedWeek) return;
    this.selectedWeek = week;
    const cached = this.freshCache(this.selectedSemester, week);
    if (cached) {
      this.applySnapshot(cached.snapshot, true);
      this.notifyPriority();
      return;
    }
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
    const current = this.currentWeekValue();
    if (!current) return;
    if (current === this.selectedWeek) {
      this.notifyPriority();
      return;
    }
    this.selectWeek(current);
  }

  acceptResult(id: string, raw: string): void {
    if (id !== this.activeRequestId) return;
    let snapshot: NativeScheduleSnapshot;
    try {
      snapshot = JSON.parse(raw) as NativeScheduleSnapshot;
    } catch (_) {
      this.fail('课表数据无法读取');
      return;
    }
    if (!snapshot.auth?.authenticated) {
      this.status = 'unauthorized';
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
    if (!snapshot.data || !Array.isArray(snapshot.data.cells)) {
      this.fail('教务系统未返回有效课表');
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
    if (!snapshot.auth?.authenticated || !snapshot.data || snapshot.error) return;
    this.remember(snapshot);
    if (snapshot.data.currentSemester === this.selectedSemester && snapshot.data.currentWeek === this.selectedWeek) {
      this.applySnapshot(snapshot, false);
    }
  }

  handleAuthChanged(): void {
    this.requestGeneration += 1;
    this.activeRequestId = '';
    this.cache.clear();
    this.result = undefined;
    this.calendar = undefined;
    this.selectedSemester = '';
    this.selectedWeek = '';
    this.errorMessage = '';
    this.lastUpdatedAt = 0;
    this.status = 'idle';
    if (this.bridgeReady && this.requester) {
      this.load(false);
      return;
    }
    this.notify();
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
    const blocks: NativeCourseBlock[] = [];
    this.visibleCells().filter((cell: NativeScheduleCell) => cell.day === day).forEach((cell: NativeScheduleCell) => {
      cell.courses.forEach((course: NativeScheduleCourse) => {
        blocks.push({
          day,
          startSlot: course.startSlot ?? Math.max(1, cell.bigSlot * 2 - 1),
          endSlot: course.endSlot ?? Math.max(1, cell.bigSlot * 2),
          course
        });
      });
    });
    return blocks.sort((left: NativeCourseBlock, right: NativeCourseBlock) => left.startSlot - right.startSlot);
  }

  semesterOptions(): NativeScheduleSemester[] {
    if (this.calendar?.semesters?.length) return this.calendar.semesters;
    return this.result?.semesters ?? [];
  }

  weekOptions(): NativeScheduleWeek[] {
    return this.result?.weeks ?? [];
  }

  selectedSemesterIndex(): number {
    return Math.max(0, this.semesterOptions().findIndex((item: NativeScheduleSemester) => item.value === this.selectedSemester));
  }

  selectedWeekIndex(): number {
    return Math.max(0, this.weekOptions().findIndex((item: NativeScheduleWeek) => item.value === this.selectedWeek));
  }

  dayDate(day: number): string {
    const week = Number(this.selectedWeek || this.result?.currentWeek || 0);
    const calendarWeek = this.calendar?.weeks?.find((item: NativeCalendarWeek) => item.week === week);
    const value = calendarWeek?.days?.[day - 1] ?? '';
    return value.length >= 10 ? value.substring(5) : value;
  }

  isToday(day: number): boolean {
    const value = this.dayDate(day);
    if (!value) return false;
    const now = new Date();
    const today = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
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
    const entry: NativeScheduleCacheEntry = { snapshot, savedAt: Date.now() };
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
    this.listener?.();
  }
}
