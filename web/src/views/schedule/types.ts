export interface ScheduleCourse {
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

export interface ScheduleCell {
  day: number;
  bigSlot: number;
  courses: ScheduleCourse[];
}

export interface ScheduleResult {
  semesters: { value: string; label: string; current: boolean }[];
  weeks: { value: string; label: string; current: boolean }[];
  currentSemester: string;
  currentWeek: string;
  cells: ScheduleCell[];
}

export interface CalendarWeek {
  week: number;
  days: string[];
  monday: string;
  sunday: string;
}

export interface CalendarResult {
  currentWeek: number;
  semesterStart: string;
  semesterEnd: string;
  weeks: CalendarWeek[];
}

export interface SemesterDescriptor {
  startYear: number;
  endYear: number;
  season: "first" | "second";
}

export interface OfficialSemesterCalendar {
  start: string;
  end: string;
  weeks: number;
}

export interface FlatCourse {
  bigSlot: number;
  index: number;
  course: ScheduleCourse;
}

export interface CacheEnvelope<T> {
  savedAt: number;
  data: T;
}

export type ViewMode = "day" | "week";

export interface LastState {
  semester: string;
  week: string;
  activeDay: number;
  viewMode?: ViewMode;
}

export interface WeekCourseBlock {
  day: number;
  bigSlot: number;
  startSlot: number;
  endSlot: number;
  index: number;
  course: ScheduleCourse;
}

export interface ScheduleBackgroundSettings {
  imageDataUrl: string;
  overlayOpacity: number;
  blur: number;
}

export interface SchedulePageModel {
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
