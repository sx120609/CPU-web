import { request, type RequestOptions } from "./request";
import type { Topic } from "./topic";

export interface CourseTeacherInfo {
  /** Teacher.id */
  id: number;
  name: string;
  /** CourseTeacher 关联 id，写课评时放进 metadata.courseTeacherId */
  courseTeacherId: number;
}

/** 可见点评的平均分（1–5）；count 为 0 时其余都是 0。 */
export interface CourseStats {
  count: number;
  recommend: number;
  reward: number;
  difficulty: number;
  /** 给分 */
  grading: number;
}

export type CourseSource = "grade" | "schedule" | "pyfa";

export interface CourseMine {
  /** grade 修过 / schedule 本学期在修 / pyfa 培养方案里 */
  source: CourseSource;
  semester: string | null;
  score: string | null;
  /** 教务课表里的任课老师 */
  teacherNames: string[];
  review: { topicId: number; pending: boolean } | null;
}

export interface Course {
  id: number;
  code: string;
  name: string;
  credits: number | null;
  category: string | null;
  college: string | null;
  teachers: CourseTeacherInfo[];
  stats: CourseStats;
  lastReviewAt: number | null;
  mine?: CourseMine | null;
}

export interface CourseTeacherDetail extends CourseTeacherInfo {
  stats: CourseStats;
}

export interface CourseDetail {
  course: Course;
  /** 推荐度 1–5 分各有几人 */
  distribution: number[];
  teachers: CourseTeacherDetail[];
  /** 没写老师的点评数 */
  unassignedCount: number;
  mine: CourseMine | null;
  myReview: { topicId: number; pending: boolean } | null;
}

export interface CourseReviewRatings {
  difficulty: number;
  reward: number;
  recommend: number;
  givingScore: number;
}

export interface CourseReviewItem {
  topic: Topic;
  rating: CourseReviewRatings & {
    semester: string | null;
    courseTeacherId: number | null;
    teacherName: string | null;
  };
}

export interface CourseOverview {
  courseCount: number;
  reviewedCourseCount: number;
  reviewCount: number;
  categories: string[];
  mine: {
    total: number;
    taken: number;
    current: number;
    planned: number;
    reviewed: number;
    todo: number;
    syncedAt: string | null;
  };
}

export type CourseSort = "hot" | "recommend" | "recent" | "easy" | "code";
export type CourseScope = "all" | "mine" | "todo";

export interface CourseListQuery {
  q?: string;
  scope?: CourseScope;
  sort?: CourseSort;
  category?: string;
  reviewed?: boolean;
  page?: number;
  size?: number;
}

export interface CourseSyncResult {
  examined: number;
  taken: number;
  current: number;
  planned: number;
  coursesCreated: number;
  teachersLinked: number;
  /** 成绩或培养方案有一项没拉到 */
  partial: boolean;
  syncedAt: string;
}

/** 课评帖 metadata 里的字段 */
export interface CourseReviewMetadata {
  courseId: number;
  courseTeacherId?: number;
  teacherName?: string;
  semester?: string;
  ratings: CourseReviewRatings;
}

export const courseApi = {
  overview: (options?: RequestOptions) => request.get<CourseOverview>("/courses/overview", undefined, options),
  list: (query: CourseListQuery = {}, options?: RequestOptions) =>
    request.get<{ page: number; size: number; total: number; items: Course[] }>("/courses", {
      ...(query.q ? { q: query.q } : {}),
      ...(query.scope && query.scope !== "all" ? { scope: query.scope } : {}),
      ...(query.sort ? { sort: query.sort } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.reviewed ? { reviewed: 1 } : {}),
      ...(query.page && query.page > 1 ? { page: query.page } : {}),
      ...(query.size ? { size: query.size } : {}),
    }, options),
  detail: (id: number, options?: RequestOptions) => request.get<CourseDetail>(`/courses/${id}`, undefined, options),
  reviews: (id: number, query: { teacher?: number; sort?: "new" | "hot"; page?: number; size?: number } = {}, options?: RequestOptions) =>
    request.get<{ page: number; size: number; total: number; list: CourseReviewItem[] }>(`/courses/${id}/reviews`, {
      ...(query.teacher ? { teacher: query.teacher } : {}),
      ...(query.sort && query.sort !== "new" ? { sort: query.sort } : {}),
      ...(query.page && query.page > 1 ? { page: query.page } : {}),
      ...(query.size ? { size: query.size } : {}),
    }, options),
  /** 用 HttpOnly 浏览器会话里的教务身份导入课程；授权失效时返回 409 + 4011。 */
  sync: (options?: RequestOptions) => request.post<CourseSyncResult>("/courses/sync", undefined, options),
  addTeacher: (courseId: number, name: string) =>
    request.post<CourseTeacherInfo>(`/courses/${courseId}/teachers`, { name }),
};

export const COURSE_SOURCE_LABEL: Record<CourseSource, string> = {
  grade: "修过",
  schedule: "在修",
  pyfa: "培养方案",
};
