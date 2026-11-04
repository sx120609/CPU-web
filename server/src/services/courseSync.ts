import { prisma } from "../prisma";
import type { GradeRow, PyfaCourse, ScheduleResult } from "./jwxtParser";
import { splitTeacherNames } from "./courseReviews";

/**
 * 从教务导入“我的课程”。
 *
 * 成绩给出修过的课（有课程代码、学期、成绩），培养方案给出计划修读的课（代码、学分、开课单位），
 * 课表给出本学期在修的课和任课老师（只有课程名，没有代码，按课程名对回代码）。
 */

export type CourseSource = "grade" | "schedule" | "pyfa";

export type SyncedCourse = {
  code: string;
  name: string;
  credits?: number;
  category?: string;
  college?: string;
  source: CourseSource;
  semester?: string;
  score?: string;
  teacherNames: string[];
};

const SOURCE_RANK: Record<CourseSource, number> = { grade: 3, schedule: 2, pyfa: 1 };

/** 课表和成绩里的课程名写法不完全一致：去空白、全角括号统一，再去掉末尾的括号说明。 */
export function courseNameKeys(name: string) {
  const compact = name.replace(/\s+/gu, "").replace(/（/gu, "(").replace(/）/gu, ")");
  const bare = compact.replace(/\([^)]*\)$/u, "");
  return bare && bare !== compact ? [compact, bare] : [compact];
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function buildSyncedCourses(input: {
  grades: GradeRow[];
  pyfa: PyfaCourse[];
  schedules: ScheduleResult[];
}): SyncedCourse[] {
  const byCode = new Map<string, SyncedCourse>();

  for (const p of input.pyfa) {
    const code = cleanText(p.courseCode);
    const name = cleanText(p.courseName);
    if (!code || !name) continue;
    byCode.set(code, {
      code,
      name,
      credits: p.credits,
      category: cleanText(p.attr) || undefined,
      college: cleanText(p.unit) || undefined,
      source: "pyfa",
      teacherNames: [],
    });
  }

  // 同一门课可能有多次成绩（补考、重修），保留最新学期的那条。
  const grades = [...input.grades].sort((a, b) => cleanText(a.semester).localeCompare(cleanText(b.semester)));
  for (const g of grades) {
    const code = cleanText(g.courseCode);
    const name = cleanText(g.courseName);
    if (!code || !name) continue;
    const existing = byCode.get(code);
    byCode.set(code, {
      code,
      name: existing?.name || name,
      credits: existing?.credits ?? g.credits,
      category: existing?.category || cleanText(g.courseAttr) || undefined,
      college: existing?.college,
      source: "grade",
      semester: cleanText(g.semester) || undefined,
      score: cleanText(g.score) || undefined,
      teacherNames: [],
    });
  }

  const codeByName = new Map<string, string>();
  for (const course of byCode.values()) {
    for (const key of courseNameKeys(course.name)) if (!codeByName.has(key)) codeByName.set(key, course.code);
  }

  for (const schedule of input.schedules) {
    const semester = cleanText(schedule.currentSemester);
    for (const cell of schedule.cells ?? []) {
      for (const item of cell.courses ?? []) {
        const name = cleanText(item.name);
        if (!name) continue;
        const code = courseNameKeys(name).map((key) => codeByName.get(key)).find(Boolean);
        if (!code) continue;
        const course = byCode.get(code)!;
        for (const teacher of splitTeacherNames(item.teacher)) {
          if (!course.teacherNames.includes(teacher)) course.teacherNames.push(teacher);
        }
        // 课表里有、还没出成绩：本学期在修。
        if (course.source === "pyfa") {
          course.source = "schedule";
          course.semester = semester || course.semester;
        }
      }
    }
  }

  return [...byCode.values()];
}

/** 成绩里出现过的学期，新的在前；用来补拉往期课表找老师。 */
export function gradeSemesters(grades: GradeRow[], exclude: string[] = [], limit = 6) {
  const skip = new Set(exclude.filter(Boolean));
  const semesters = [...new Set(grades.map((g) => cleanText(g.semester)).filter((s) => s && !skip.has(s)))];
  return semesters.sort((a, b) => b.localeCompare(a)).slice(0, limit);
}

export type CourseSyncSummary = {
  examined: number;
  taken: number;
  current: number;
  planned: number;
  coursesCreated: number;
  teachersLinked: number;
};

/** 把导入结果写进本校课程目录和本人的课程记录。全部批量写，不逐门查询。 */
export async function applyCourseSync(userId: number, schoolId: string, courses: SyncedCourse[]): Promise<CourseSyncSummary> {
  const summary: CourseSyncSummary = {
    examined: courses.length,
    taken: courses.filter((c) => c.source === "grade").length,
    current: courses.filter((c) => c.source === "schedule").length,
    planned: courses.filter((c) => c.source === "pyfa").length,
    coursesCreated: 0,
    teachersLinked: 0,
  };
  if (!courses.length) return summary;
  const codes = courses.map((c) => c.code);

  const before = await prisma.course.findMany({ where: { schoolId, code: { in: codes } } });
  const beforeByCode = new Map(before.map((c) => [c.code, c]));
  const missing = courses.filter((c) => !beforeByCode.has(c.code));
  if (missing.length) {
    const created = await prisma.course.createMany({
      data: missing.map((c) => ({
        schoolId,
        code: c.code,
        name: c.name,
        teacher: "",
        credits: c.credits ?? null,
        category: c.category ?? null,
        college: c.college ?? null,
      })),
      skipDuplicates: true,
    });
    summary.coursesCreated = created.count;
  }
  // 已有课程只补空着的信息，不覆盖别人同步过的内容。
  const fills = courses.flatMap((c) => {
    const row = beforeByCode.get(c.code);
    if (!row) return [];
    const data: Record<string, unknown> = {};
    if (row.credits == null && c.credits != null) data.credits = c.credits;
    if (!row.category && c.category) data.category = c.category;
    if (!row.college && c.college) data.college = c.college;
    return Object.keys(data).length ? [prisma.course.update({ where: { id: row.id }, data })] : [];
  });
  if (fills.length) await prisma.$transaction(fills);

  const rows = await prisma.course.findMany({ where: { schoolId, code: { in: codes } }, select: { id: true, code: true } });
  const idByCode = new Map(rows.map((r) => [r.code, r.id]));

  const teacherNames = [...new Set(courses.flatMap((c) => c.teacherNames))];
  if (teacherNames.length) {
    await prisma.teacher.createMany({
      data: teacherNames.map((name) => ({ schoolId, name })),
      skipDuplicates: true,
    });
    const teachers = await prisma.teacher.findMany({ where: { schoolId, name: { in: teacherNames } }, select: { id: true, name: true } });
    const teacherId = new Map(teachers.map((t) => [t.name, t.id]));
    const links = courses.flatMap((c) => {
      const courseId = idByCode.get(c.code);
      if (!courseId) return [];
      return c.teacherNames.flatMap((name) => {
        const id = teacherId.get(name);
        return id ? [{ courseId, teacherId: id, source: "jwxt-schedule" }] : [];
      });
    });
    if (links.length) {
      const linked = await prisma.courseTeacher.createMany({ data: links, skipDuplicates: true });
      summary.teachersLinked = linked.count;
    }
  }

  const existingLinks = await prisma.userCourse.findMany({
    where: { userId, courseId: { in: [...idByCode.values()] } },
  });
  const linkByCourse = new Map(existingLinks.map((l) => [l.courseId, l]));
  const now = new Date();
  const creates: Array<Record<string, unknown>> = [];
  const updates: Array<ReturnType<typeof prisma.userCourse.update>> = [];
  for (const c of courses) {
    const courseId = idByCode.get(c.code);
    if (!courseId) continue;
    const teacherText = c.teacherNames.length ? c.teacherNames.join("、") : null;
    const link = linkByCourse.get(courseId);
    if (!link) {
      creates.push({ userId, courseId, source: c.source, semester: c.semester ?? null, score: c.score ?? null, teacherNames: teacherText, syncedAt: now });
      continue;
    }
    // 来源只升不降：修过的课不会因为这次没拉到成绩就变回“计划修读”。
    const previous = (link.source in SOURCE_RANK ? link.source : "pyfa") as CourseSource;
    const keepPrevious = SOURCE_RANK[previous] > SOURCE_RANK[c.source];
    updates.push(prisma.userCourse.update({
      where: { id: link.id },
      data: keepPrevious
        ? { teacherNames: teacherText ?? link.teacherNames, syncedAt: now }
        : {
            source: c.source,
            semester: c.semester ?? link.semester,
            score: c.score ?? link.score,
            teacherNames: teacherText ?? link.teacherNames,
            syncedAt: now,
          },
    }));
  }
  if (creates.length) await prisma.userCourse.createMany({ data: creates as any, skipDuplicates: true });
  for (let i = 0; i < updates.length; i += 100) await prisma.$transaction(updates.slice(i, i + 100));
  return summary;
}
