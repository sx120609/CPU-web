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

export const courseApi = {
  list: (q?: string) => request.get<Course[]>("/courses", q ? { q } : {}),
  detail: (id: number) => request.get<{ course: Course; ratings: CourseRating[] }>(`/courses/${id}`),
};
