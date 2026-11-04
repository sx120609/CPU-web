import type { CourseStats } from "./courseReviews";
import { rankingScore } from "./courseReviews";

/** 课程列表里的一门课：目录信息 + 可见评分统计。整校一份，缓存后在内存里筛选排序。 */
export type CatalogCourse = {
  id: number;
  code: string;
  name: string;
  credits: number | null;
  category: string | null;
  college: string | null;
  teachers: Array<{ id: number; name: string; courseTeacherId: number }>;
  stats: CourseStats;
  lastReviewAt: number | null;
};

export type CourseSort = "hot" | "recommend" | "recent" | "easy" | "code";

export const COURSE_SORTS: CourseSort[] = ["hot", "recommend", "recent", "easy", "code"];

function normalize(text: string) {
  return text.toLowerCase().replace(/\s+/gu, "");
}

function haystack(course: CatalogCourse) {
  return normalize([course.code, course.name, course.college ?? "", course.category ?? "", ...course.teachers.map((t) => t.name)].join(" "));
}

/** 空格分开的每个词都要命中（课程名、代码、老师、开课单位任一处）。 */
export function matchesCourseQuery(course: CatalogCourse, q: string) {
  const tokens = q.split(/\s+/u).map(normalize).filter(Boolean);
  if (!tokens.length) return true;
  const text = haystack(course);
  return tokens.every((token) => text.includes(token));
}

/** 搜索时：代码完全一致 > 课程名开头一致 > 课程名包含 > 只命中老师等其他字段。 */
function relevance(course: CatalogCourse, q: string) {
  const needle = normalize(q);
  if (!needle) return 0;
  const code = normalize(course.code);
  const name = normalize(course.name);
  if (code === needle) return 4;
  if (name === needle) return 3.5;
  if (name.startsWith(needle) || code.startsWith(needle)) return 3;
  if (name.includes(needle)) return 2;
  return 1;
}

export function compareCourses(sort: CourseSort, q = "") {
  return (a: CatalogCourse, b: CatalogCourse) => {
    if (q) {
      const diff = relevance(b, q) - relevance(a, q);
      if (diff) return diff;
    }
    switch (sort) {
      case "recommend": {
        const diff = rankingScore(b.stats) - rankingScore(a.stats);
        if (diff) return diff;
        break;
      }
      case "recent": {
        const diff = (b.lastReviewAt ?? 0) - (a.lastReviewAt ?? 0);
        if (diff) return diff;
        break;
      }
      case "easy": {
        // 没有评价的课排在后面；难度低、给分高的在前。
        if (!a.stats.count !== !b.stats.count) return a.stats.count ? -1 : 1;
        const diff = (a.stats.difficulty - a.stats.grading) - (b.stats.difficulty - b.stats.grading);
        if (diff) return diff;
        break;
      }
      case "code":
        return a.code.localeCompare(b.code);
      default:
        break;
    }
    const byCount = b.stats.count - a.stats.count;
    if (byCount) return byCount;
    const byRecent = (b.lastReviewAt ?? 0) - (a.lastReviewAt ?? 0);
    if (byRecent) return byRecent;
    return a.code.localeCompare(b.code);
  };
}

export function queryCatalog(catalog: CatalogCourse[], options: {
  q?: string;
  sort?: CourseSort;
  category?: string;
  reviewedOnly?: boolean;
  ids?: Set<number>;
}) {
  const q = (options.q ?? "").trim().slice(0, 60);
  const sort = options.sort ?? "hot";
  return catalog
    .filter((course) => !options.ids || options.ids.has(course.id))
    .filter((course) => !options.category || course.category === options.category)
    .filter((course) => !options.reviewedOnly || course.stats.count > 0)
    .filter((course) => matchesCourseQuery(course, q))
    .sort(compareCourses(sort, q));
}

/** 筛选栏里的课程性质，按出现次数排，最多 8 个。 */
export function catalogCategories(catalog: CatalogCourse[]) {
  const counts = new Map<string, number>();
  for (const course of catalog) if (course.category) counts.set(course.category, (counts.get(course.category) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name]) => name);
}
