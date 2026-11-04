import assert from "node:assert/strict";
import test from "node:test";
import type { GradeRow, PyfaCourse, ScheduleResult } from "../src/services/jwxtParser";
import {
  normalizeReviewRatings,
  rankingScore,
  ratingDistribution,
  splitTeacherNames,
  summarizeRatings,
} from "../src/services/courseReviews";
import { buildSyncedCourses, courseNameKeys, gradeSemesters } from "../src/services/courseSync";
import { catalogCategories, matchesCourseQuery, queryCatalog, type CatalogCourse } from "../src/services/courseCatalog";

function grade(courseCode: string, courseName: string, semester: string, score = "85"): GradeRow {
  return { courseCode, courseName, semester, score, scoreNum: Number(score) || null, credits: 2, courseAttr: "必修" };
}

function pyfa(courseCode: string, courseName: string, extra: Partial<PyfaCourse> = {}): PyfaCourse {
  return { courseCode, courseName, credits: 3, attr: "选修", unit: "药学院", ...extra };
}

function schedule(semester: string, courses: Array<{ name: string; teacher?: string }>): ScheduleResult {
  return {
    title: "",
    semesters: [],
    currentSemester: semester,
    weeks: [],
    currentWeek: "",
    cells: [{ day: 1, bigSlot: 1, courses: courses.map((c) => ({ ...c, weeks: "1-16(周)", weekList: [] })) }],
  } as ScheduleResult;
}

function course(id: number, overrides: Partial<CatalogCourse> = {}): CatalogCourse {
  return {
    id,
    code: `C${id}`,
    name: `课程${id}`,
    credits: 2,
    category: "必修",
    college: null,
    teachers: [],
    stats: { count: 0, recommend: 0, reward: 0, difficulty: 0, grading: 0 },
    lastReviewAt: null,
    ...overrides,
  };
}

test("评分四项都要在 1–5 之间，旧数据的 score 当作给分", () => {
  assert.deepEqual(normalizeReviewRatings({ difficulty: 2, reward: 4, recommend: 5, score: 3 }), { difficulty: 2, reward: 4, recommend: 5, givingScore: 3 });
  assert.equal(normalizeReviewRatings({ difficulty: 2, reward: 4, recommend: 5 }), null);
  assert.equal(normalizeReviewRatings({ difficulty: 0, reward: 4, recommend: 5, givingScore: 3 }), null);
  assert.equal(normalizeReviewRatings({ difficulty: 9, reward: 4, recommend: 5, givingScore: 3 }), null);
  assert.equal(normalizeReviewRatings("5"), null);
});

test("教师栏按常见分隔符拆开，去掉括号说明和占位词", () => {
  assert.deepEqual(splitTeacherNames("王明、李华,张三（主讲） 待定"), ["王明", "李华", "张三"]);
  assert.deepEqual(splitTeacherNames("王明;王明"), ["王明"]);
  assert.deepEqual(splitTeacherNames(undefined), []);
});

test("统计按评分平均，分布按推荐度计数", () => {
  const rows = [
    { difficulty: 2, reward: 4, recommend: 5, givingScore: 4 },
    { difficulty: 4, reward: 3, recommend: 3, givingScore: 2 },
  ];
  assert.deepEqual(summarizeRatings(rows), { count: 2, recommend: 4, reward: 3.5, difficulty: 3, grading: 3 });
  assert.deepEqual(summarizeRatings([]), { count: 0, recommend: 0, reward: 0, difficulty: 0, grading: 0 });
  assert.deepEqual(ratingDistribution(rows), [0, 0, 1, 0, 1]);
});

test("排序推荐度：一篇五星排不过十篇四星半", () => {
  const one = { count: 1, recommend: 5, reward: 0, difficulty: 0, grading: 0 };
  const many = { count: 10, recommend: 4.5, reward: 0, difficulty: 0, grading: 0 };
  assert.ok(rankingScore(many) > rankingScore(one));
  assert.equal(rankingScore({ ...one, count: 0 }), 0);
});

test("导入：成绩优先于培养方案，同一门课取最新学期的成绩", () => {
  const courses = buildSyncedCourses({
    pyfa: [pyfa("A1", "药理学", { unit: "药学院" }), pyfa("B2", "有机化学")],
    grades: [grade("A1", "药理学", "2024-2025-1", "60"), grade("A1", "药理学", "2024-2025-2", "88")],
    schedules: [],
  });
  const a1 = courses.find((c) => c.code === "A1")!;
  assert.equal(a1.source, "grade");
  assert.equal(a1.semester, "2024-2025-2");
  assert.equal(a1.score, "88");
  assert.equal(a1.college, "药学院");
  assert.equal(courses.find((c) => c.code === "B2")!.source, "pyfa");
});

test("导入：课表按课程名对回代码，补上老师，没出成绩的课标为在修", () => {
  const courses = buildSyncedCourses({
    pyfa: [pyfa("B2", "有机化学"), pyfa("C3", "生物化学（实验）")],
    grades: [grade("A1", "药理学", "2024-2025-1")],
    schedules: [
      schedule("2025-2026-1", [{ name: "有 机 化学", teacher: "李华、王明" }, { name: "生物化学", teacher: "赵六" }, { name: "不在目录里的课", teacher: "钱七" }]),
      schedule("2024-2025-1", [{ name: "药理学", teacher: "张三" }]),
    ],
  });
  const byCode = new Map(courses.map((c) => [c.code, c]));
  assert.deepEqual(byCode.get("B2")!.teacherNames, ["李华", "王明"]);
  assert.equal(byCode.get("B2")!.source, "schedule");
  assert.equal(byCode.get("B2")!.semester, "2025-2026-1");
  assert.deepEqual(byCode.get("C3")!.teacherNames, ["赵六"]);
  assert.equal(byCode.get("A1")!.source, "grade");
  assert.deepEqual(byCode.get("A1")!.teacherNames, ["张三"]);
  assert.equal(courses.length, 3);
});

test("课程名比对忽略空白、全角括号和末尾说明", () => {
  assert.deepEqual(courseNameKeys("生物化学（实验）"), ["生物化学(实验)", "生物化学"]);
  assert.deepEqual(courseNameKeys(" 药 理学 "), ["药理学"]);
});

test("往期课表只补成绩里出现过的学期，新的在前", () => {
  const grades = [grade("A", "a", "2023-2024-1"), grade("B", "b", "2024-2025-2"), grade("C", "c", "2024-2025-1"), grade("D", "d", "2024-2025-2")];
  assert.deepEqual(gradeSemesters(grades, ["2024-2025-2"], 6), ["2024-2025-1", "2023-2024-1"]);
  assert.deepEqual(gradeSemesters(grades, [], 1), ["2024-2025-2"]);
});

test("搜索：每个词都要命中课程名、代码或老师", () => {
  const c = course(1, { code: "YX101", name: "药理学", teachers: [{ id: 1, name: "王明", courseTeacherId: 1 }] });
  assert.ok(matchesCourseQuery(c, "药理 王明"));
  assert.ok(matchesCourseQuery(c, "yx101"));
  assert.ok(!matchesCourseQuery(c, "药理 李华"));
});

test("列表排序：默认按评价数，搜索时代码完全一致的排第一", () => {
  const catalog = [
    course(1, { code: "A100", name: "高等数学", stats: { count: 5, recommend: 3, reward: 3, difficulty: 4, grading: 3 } }),
    course(2, { code: "A10", name: "高等数学实验", stats: { count: 1, recommend: 5, reward: 3, difficulty: 2, grading: 4 } }),
    course(3, { code: "B1", name: "大学英语" }),
  ];
  assert.deepEqual(queryCatalog(catalog, {}).map((c) => c.id), [1, 2, 3]);
  assert.deepEqual(queryCatalog(catalog, { q: "A10" }).map((c) => c.id), [2, 1]);
  assert.deepEqual(queryCatalog(catalog, { sort: "easy" }).map((c) => c.id), [2, 1, 3]);
  assert.deepEqual(queryCatalog(catalog, { reviewedOnly: true, ids: new Set([1, 3]) }).map((c) => c.id), [1]);
});

test("课程性质按出现次数列出", () => {
  const catalog = [course(1, { category: "选修" }), course(2, { category: "必修" }), course(3, { category: "必修" }), course(4, { category: null })];
  assert.deepEqual(catalogCategories(catalog), ["必修", "选修"]);
});
