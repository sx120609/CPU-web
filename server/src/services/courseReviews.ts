import { prisma } from "../prisma";
import { FORUM_SELF_VISIBLE_REVIEW_STATUSES } from "./forumSubmission";
import { HttpError } from "../utils/response";

/**
 * 课程点评。
 *
 * 一篇课评就是课评板块里的一个帖子：正文、匿名、审核、举报、回复都走论坛；
 * 帖子 metadata 里的 courseId / courseTeacherId / ratings / semester 同步到 CourseRating，
 * 课程页的统计只算帖子仍然公开可见的那些评分（删帖、隐藏、审核中都不算）。
 */

export type CourseReviewRatings = {
  difficulty: number;
  reward: number;
  recommend: number;
  givingScore: number;
};

export type CourseStats = {
  count: number;
  recommend: number;
  reward: number;
  difficulty: number;
  grading: number;
};

export type RatingRow = CourseReviewRatings & {
  topicId: number;
  courseId: number;
  courseTeacherId: number | null;
  authorId: number;
  semester: string | null;
};

export const EMPTY_COURSE_STATS: CourseStats = { count: 0, recommend: 0, reward: 0, difficulty: 0, grading: 0 };

const TEACHER_NAME_MAX = 40;

function ratingValue(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  return rounded >= 1 && rounded <= 5 ? rounded : null;
}

/** 四项评分都要是 1–5；缺一项就不算有效课评。旧数据的 score 当作给分。 */
export function normalizeReviewRatings(raw: unknown): CourseReviewRatings | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const difficulty = ratingValue(r.difficulty);
  const reward = ratingValue(r.reward);
  const recommend = ratingValue(r.recommend);
  const givingScore = ratingValue(r.givingScore ?? r.score);
  if (!difficulty || !reward || !recommend || !givingScore) return null;
  return { difficulty, reward, recommend, givingScore };
}

/** 教务里的教师栏可能一格写几位老师：“王明、李华”“王明,李华”“王明 李华”。 */
export function splitTeacherNames(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  const names = raw
    .split(/[,，、;；/|\s]+/u)
    .map((name) => name.replace(/[（(][^）)]*[）)]/gu, "").trim())
    .filter((name) => name.length >= 2 && name.length <= TEACHER_NAME_MAX)
    .filter((name) => !/^(?:待定|未安排|无|暂无|教师|老师|未知)$/u.test(name));
  return [...new Set(names)];
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

export function summarizeRatings(rows: Array<Pick<RatingRow, "difficulty" | "reward" | "recommend" | "givingScore">>): CourseStats {
  if (!rows.length) return { ...EMPTY_COURSE_STATS };
  const sum = rows.reduce(
    (acc, row) => ({
      difficulty: acc.difficulty + row.difficulty,
      reward: acc.reward + row.reward,
      recommend: acc.recommend + row.recommend,
      grading: acc.grading + row.givingScore,
    }),
    { difficulty: 0, reward: 0, recommend: 0, grading: 0 },
  );
  const n = rows.length;
  return {
    count: n,
    recommend: round2(sum.recommend / n),
    reward: round2(sum.reward / n),
    difficulty: round2(sum.difficulty / n),
    grading: round2(sum.grading / n),
  };
}

/** 各分值的人数，课程页画分布条用。下标 0 对应 1 分。 */
export function ratingDistribution(rows: Array<Pick<RatingRow, "recommend">>) {
  const buckets = [0, 0, 0, 0, 0];
  for (const row of rows) buckets[row.recommend - 1] += 1;
  return buckets;
}

/**
 * 排序用的推荐度：评价少的课向全站平均收拢，避免一篇五星就排第一。
 * 先验相当于 3 篇平均分的评价。
 */
export function rankingScore(stats: CourseStats, prior = 3.5, weight = 3) {
  if (!stats.count) return 0;
  return (stats.recommend * stats.count + prior * weight) / (stats.count + weight);
}

/** 只留下帖子公开可见的评分，并带上帖子发布时间。 */
export async function loadVisibleRatings(where: { courseId?: number | { in: number[] }; authorId?: number } = {}) {
  const ratings = await prisma.courseRating.findMany({
    where,
    select: {
      topicId: true,
      courseId: true,
      courseTeacherId: true,
      authorId: true,
      difficulty: true,
      reward: true,
      recommend: true,
      givingScore: true,
      semester: true,
    },
  });
  if (!ratings.length) return [] as Array<RatingRow & { createdAt: Date }>;
  const visible = await prisma.topic.findMany({
    where: { id: { in: ratings.map((r) => r.topicId) }, hidden: false },
    select: { id: true, createdAt: true },
  });
  const createdAt = new Map(visible.map((t) => [t.id, t.createdAt]));
  return ratings
    .filter((r) => createdAt.has(r.topicId))
    .map((r) => ({ ...r, createdAt: createdAt.get(r.topicId)! }));
}

/** 课程表上的冗余统计（站内搜索等地方直接读），按可见评分重算。 */
export async function refreshCourseAggregate(courseId: number) {
  const stats = summarizeRatings(await loadVisibleRatings({ courseId }));
  await prisma.course.updateMany({
    where: { id: courseId },
    data: {
      ratingCount: stats.count,
      avgDifficulty: stats.difficulty,
      avgReward: stats.reward,
      avgRecommend: stats.recommend,
      avgScore: stats.grading,
    },
  });
}

function parseMetadata(raw: string | null | undefined): Record<string, any> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** 找到或建立“某门课的某位老师”，名字按同校同名归为一人。 */
export async function ensureCourseTeacher(input: {
  schoolId: string;
  courseId: number;
  name: string;
  createdById?: number | null;
  source: string;
}) {
  const name = input.name.trim().slice(0, TEACHER_NAME_MAX);
  if (!name) return null;
  const teacher = await prisma.teacher.upsert({
    where: { schoolId_name: { schoolId: input.schoolId, name } },
    update: {},
    create: { schoolId: input.schoolId, name, createdById: input.createdById ?? null },
  });
  return prisma.courseTeacher.upsert({
    where: { courseId_teacherId: { courseId: input.courseId, teacherId: teacher.id } },
    update: {},
    create: { courseId: input.courseId, teacherId: teacher.id, source: input.source },
    include: { teacher: true },
  });
}

async function resolveReviewTeacher(schoolId: string, courseId: number, authorId: number, metadata: Record<string, any>) {
  const requestedId = Number(metadata.courseTeacherId);
  if (Number.isInteger(requestedId) && requestedId > 0) {
    const existing = await prisma.courseTeacher.findFirst({ where: { id: requestedId, courseId }, select: { id: true } });
    if (existing) return existing.id;
  }
  if (typeof metadata.teacherName === "string" && metadata.teacherName.trim()) {
    const created = await ensureCourseTeacher({ schoolId, courseId, name: metadata.teacherName, createdById: authorId, source: "user-add" });
    return created?.id ?? null;
  }
  return null;
}

/**
 * 让 CourseRating 与帖子保持一致：发帖、编辑、审核通过后调用。
 * 帖子不在课评板块、不再带有效评分时删掉评分；换了课程时两门课的统计都重算。
 */
export async function syncTopicCourseRating(topicId: number) {
  const [topic, existing] = await Promise.all([
    prisma.topic.findUnique({
      where: { id: topicId },
      select: { id: true, authorId: true, metadata: true, board: { select: { type: true, schoolId: true } } },
    }),
    prisma.courseRating.findUnique({ where: { topicId }, select: { courseId: true } }),
  ]);
  const affected = new Set<number>();
  if (existing) affected.add(existing.courseId);

  const metadata = parseMetadata(topic?.metadata);
  const ratings = normalizeReviewRatings(metadata.ratings);
  const courseId = Number(metadata.courseId);
  const course = topic && topic.board?.type === "coursereview" && ratings && Number.isInteger(courseId) && courseId > 0
    ? await prisma.course.findFirst({ where: { id: courseId, schoolId: topic.board.schoolId }, select: { id: true, schoolId: true } })
    : null;

  if (!topic || !course || !ratings) {
    if (existing) await prisma.courseRating.deleteMany({ where: { topicId } });
  } else {
    const courseTeacherId = await resolveReviewTeacher(course.schoolId, course.id, topic.authorId, metadata);
    const semester = typeof metadata.semester === "string" && metadata.semester.trim() ? metadata.semester.trim().slice(0, 40) : null;
    const data = { courseId: course.id, courseTeacherId, authorId: topic.authorId, semester, ...ratings };
    await prisma.courseRating.upsert({
      where: { topicId },
      update: data,
      create: { topicId, ...data },
    });
    affected.add(course.id);
  }
  for (const id of affected) await refreshCourseAggregate(id);
}

/**
 * 每人每门课只写一篇；已有公开或审核中的课评时引导去修改原帖。
 * exceptTopicId 用于编辑原帖时排除自己。
 */
export async function findOwnCourseReview(authorId: number, courseId: number, exceptTopicId?: number) {
  const ratings = await prisma.courseRating.findMany({
    where: { authorId, courseId, ...(exceptTopicId ? { topicId: { not: exceptTopicId } } : {}) },
    select: { topicId: true },
  });
  if (!ratings.length) return null;
  const topic = await prisma.topic.findFirst({
    where: {
      id: { in: ratings.map((r) => r.topicId) },
      authorId,
      OR: [
        { hidden: false },
        { hidden: true, aiReviewStatus: { in: [...FORUM_SELF_VISIBLE_REVIEW_STATUSES] } },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, hidden: true },
  });
  return topic ? { topicId: topic.id, pending: topic.hidden } : null;
}

/** 发课评前的检查：选了本校课程、四项都打了分、没有重复。 */
export async function assertCourseReviewSubmission(input: {
  schoolId: string;
  authorId: number;
  metadata: Record<string, any> | null | undefined;
  exceptTopicId?: number;
}) {
  const metadata = input.metadata ?? {};
  const courseId = Number(metadata.courseId);
  if (!Number.isInteger(courseId) || courseId <= 0) throw new HttpError(400, 4000, "请选择要评价的课程");
  const course = await prisma.course.findFirst({ where: { id: courseId, schoolId: input.schoolId }, select: { id: true } });
  if (!course) throw new HttpError(400, 4000, "课程不存在");
  if (!normalizeReviewRatings(metadata.ratings)) throw new HttpError(400, 4000, "请给难度、收获、推荐度和给分都打分");
  const own = await findOwnCourseReview(input.authorId, courseId, input.exceptTopicId);
  if (own) {
    throw new HttpError(409, 4090, own.pending ? "你对这门课的点评正在审核，可以修改原来那篇" : "你已经评价过这门课，可以修改原来那篇");
  }
}
