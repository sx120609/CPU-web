/**
 * 离线验证 jwxtParser，用 .debug/ 里的真实 HTML 跑一遍
 * 运行：npx tsx scripts/test-parser.ts
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { parseSchedule, parseGrades, parseExams } from "../src/services/jwxtParser";

async function findFile(prefix: string): Promise<string | null> {
  const dir = path.join(process.cwd(), ".debug");
  const files = await fs.readdir(dir).catch(() => []);
  // 取最新的
  const matched = files.filter((f) => f.includes(prefix)).sort();
  return matched.length ? path.join(dir, matched[matched.length - 1]) : null;
}

async function main() {
  // 课表
  const schedFile = await findFile("-schedule.html");
  if (schedFile) {
    console.log("\n========== 课表 ==========");
    console.log("文件:", schedFile);
    const html = await fs.readFile(schedFile, "utf8");
    const r = parseSchedule(html);
    console.log("标题:", r.title);
    console.log("当前学期:", r.currentSemester, "| 学期数:", r.semesters.length);
    console.log("当前周:", r.currentWeek, "| 周数:", r.weeks.length);
    console.log("单元格数:", r.cells.length);
    console.log("\n前 3 个单元格:");
    for (const c of r.cells.slice(0, 3)) {
      console.log(`  周${c.day} 第${c.bigSlot}大节:`);
      for (const co of c.courses) {
        console.log(`    📘 ${co.name} | 师:${co.teacher ?? "?"} | 周:${co.weeks} → [${co.weekList.join(",")}] | 教:${co.location} | 节:${co.slotNote} → ${co.startSlot}-${co.endSlot}`);
      }
    }
    console.log(`\n总共解析出 ${r.cells.reduce((s, c) => s + c.courses.length, 0)} 节课程实例`);
  }

  // 成绩列表 (cjcx_list)
  const gradeFile = await findFile("-grades-list.html") || await findFile("-grades.html");
  if (gradeFile) {
    console.log("\n========== 成绩 ==========");
    console.log("文件:", gradeFile);
    const html = await fs.readFile(gradeFile, "utf8");
    const r = parseGrades(html);
    console.log("学期可选:", r.semesters.length);
    console.log("成绩条数:", r.list.length);
    console.log("前 3 条:");
    for (const g of r.list.slice(0, 3)) {
      console.log(`  [${g.semester}] ${g.courseName} = ${g.score} | 学分${g.credits} | 绩点${g.gpa} | ${g.courseType ?? "—"}`);
    }
  }

  // 考试列表
  const examFile = await findFile("-exam-list.html") || await findFile("-exam.html");
  if (examFile) {
    console.log("\n========== 考试 ==========");
    console.log("文件:", examFile);
    const html = await fs.readFile(examFile, "utf8");
    const r = parseExams(html);
    console.log("学期可选:", r.semesters.length);
    console.log("考试条数:", r.list.length);
    for (const e of r.list.slice(0, 3)) {
      console.log(`  📝 ${e.courseName} | 时:${e.examTime} | 地:${e.location} | 座:${e.seat}`);
    }
  }
}

main().catch(console.error);
