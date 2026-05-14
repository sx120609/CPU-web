import { request } from "./request";

export interface Course {
  id: number;
  code: string;
  name: string;
  teacher: string;
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
  list: (q?: string, mine = false) =>
    request.get<Course[]>("/courses", { ...(q ? { q } : {}), ...(mine ? { mine: 1 } : {}) }),
  detail: (id: number) => request.get<{ course: Course; ratings: CourseRating[] }>(`/courses/${id}`),
  /** 同步当前用户的教务课程（X-Jwxt-Token 由全局拦截器自动注入） */
  sync: () => request.post<CourseSyncResult>("/courses/sync"),
};
