import type { CourseReviewRatings, CourseStats } from "@/api/course";

export type RatingKey = keyof CourseReviewRatings;

/** 四项评分的名称和 1–5 分各自的意思；难度越低越轻松，给分越高越松。 */
export const RATING_FIELDS: Array<{ key: RatingKey; label: string; hint: string; levels: string[] }> = [
  { key: "recommend", label: "推荐度", hint: "会推荐给后面的同学吗", levels: ["不推荐", "不太推荐", "一般", "推荐", "非常推荐"] },
  { key: "reward", label: "收获", hint: "学到的东西多不多", levels: ["几乎没有", "较少", "一般", "较多", "很多"] },
  { key: "difficulty", label: "难度", hint: "听课、作业和考试的压力", levels: ["很轻松", "较轻松", "适中", "较难", "很难"] },
  { key: "givingScore", label: "给分", hint: "最后的成绩给得怎么样", levels: ["很严", "偏严", "正常", "偏松", "很松"] },
];

const STAT_KEY: Record<RatingKey, keyof CourseStats> = {
  recommend: "recommend",
  reward: "reward",
  difficulty: "difficulty",
  givingScore: "grading",
};

export function ratingWord(key: RatingKey, value: number) {
  const field = RATING_FIELDS.find((f) => f.key === key)!;
  const index = Math.min(5, Math.max(1, Math.round(value))) - 1;
  return field.levels[index];
}

export function statValue(stats: CourseStats, key: RatingKey) {
  return Number(stats[STAT_KEY[key]] || 0);
}

/** 列表里的一行简评：“难度适中 · 给分偏松”。 */
export function statSummary(stats: CourseStats) {
  if (!stats.count) return "";
  const difficulty = ratingWord("difficulty", stats.difficulty);
  return [difficulty === "适中" ? "难度适中" : difficulty, `给分${ratingWord("givingScore", stats.grading)}`].join(" · ");
}

export function scoreText(value: number) {
  return value ? value.toFixed(1) : "—";
}

export function courseMetaLine(course: { code: string; credits: number | null; category: string | null; college?: string | null }, withCollege = false) {
  return [
    course.code,
    course.credits ? `${course.credits} 学分` : "",
    course.category ?? "",
    withCollege ? course.college ?? "" : "",
  ].filter(Boolean).join(" · ");
}

export function syncedAgo(iso: string | null | undefined) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return "";
  const day = 24 * 60 * 60 * 1000;
  if (diff < 60 * 60 * 1000) return "刚刚更新";
  if (diff < day) return `${Math.floor(diff / (60 * 60 * 1000))} 小时前更新`;
  return `${Math.floor(diff / day)} 天前更新`;
}

/** 超过这么久没导入过，进页面时在后台自动更新一次。 */
export const AUTO_SYNC_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
