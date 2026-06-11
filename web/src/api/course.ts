import { request, type RequestOptions } from "./request";

export interface CourseTeacherInfo {
  /** Teacher.id */
  id: number;
  name: string;
  /** CourseTeacher 关联表 id（发课评写入 CourseRating.courseTeacherId 用） */
  courseTeacherId: number;
}

export interface Course {
  id: number;
  code: string;
  name: string;
  /** 兼容旧字段：分隔符拼接的字符串（"王老师、李老师"），新代码请用 teachers */
  teacher: string;
  teachers: CourseTeacherInfo[];
  credits?: number;
  category?: string;
  college?: string;
  ratingCount: number;
  avgDifficulty: number;
  avgReward: number;
  avgRecommend: number;
  avgScore: number;
}

export interface CourseRating {
  id: number;
  topicId: number;
  courseId: number;
  /** 评分针对的具体老师（可能为 null —— 早期点评未指定） */
  teacherId: number | null;
  teacherName: string | null;
  authorId: number;
  difficulty: number;
  reward: number;
  recommend: number;
  givingScore: number;
  semester?: string;
  createdAt: string;
}

export interface CourseSyncResult {
  examined: number;
  coursesCreated: number;
  coursesExisting: number;
  linksCreated: number;
  linksUpdated: number;
  breakdown: { fromGrade: number; fromPyfa: number };
}

export const courseApi = {
  list: (q?: string, mine = false, options?: RequestOptions) =>
    request.get<Course[]>("/courses", { ...(q ? { q } : {}), ...(mine ? { mine: 1 } : {}) }, options),
  detail: (id: number, options?: RequestOptions) =>
    request.get<{ course: Course; ratings: CourseRating[] }>(`/courses/${id}`, undefined, options),
  /** 同步当前用户的教务课程（X-Jwxt-Token 由全局拦截器自动注入） */
  sync: () => request.post<CourseSyncResult>("/courses/sync"),
  /** 为课程添加一位授课老师（登录用户即可；重复时返回已有关联） */
  addTeacher: (courseId: number, name: string) =>
    request.post<CourseTeacherInfo>(`/courses/${courseId}/teachers`, { name }),
};
