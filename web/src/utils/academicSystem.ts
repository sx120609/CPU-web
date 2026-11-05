import { computed } from "vue";
import { useSiteStore } from "@/stores/site";

/**
 * 教务页按学校档案显示视图：服务端在 /api/schools/current 里给出这所学校接了哪些教务视图
 * （schools/registry.ts 的 ACADEMIC_VIEWS）和原站入口。网页只认这份清单，不按学校名或教务类型判断。
 */
export type AcademicView =
  | "schedule"
  | "grades"
  | "levelExams"
  | "exams"
  | "transcript"
  | "progress"
  | "graduationAudit"
  | "retake"
  | "studentStatus"
  | "pyfa"
  | "selection"
  | "freeRooms"
  | "timetableSearch";

/** 学校信息还没取到（或旧服务端没给清单）时按默认学校的完整教务显示，和接入多校前一致。 */
const LEGACY_VIEWS: readonly AcademicView[] = [
  "schedule", "grades", "levelExams", "transcript", "progress", "graduationAudit", "retake", "studentStatus",
  "pyfa", "selection", "freeRooms", "timetableSearch",
];

export function academicViewSet(views: readonly string[] | null | undefined): ReadonlySet<string> {
  return new Set(Array.isArray(views) ? views : LEGACY_VIEWS);
}

/** 当前学校的教务视图集合；用 `.value.has("exams")` 判断。 */
export function useAcademicViews() {
  const site = useSiteStore();
  return computed(() => academicViewSet(site.school?.academicViews));
}

/** 当前学校教务页「前往原站」的入口；学校没给时为空。 */
export function useAcademicPortals() {
  const site = useSiteStore();
  return computed(() => site.school?.academicPortals ?? null);
}
