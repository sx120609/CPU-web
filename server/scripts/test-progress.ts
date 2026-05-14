import { promises as fs } from "node:fs";
import path from "node:path";
import { parseProgress, parsePyfa } from "../src/services/jwxtParser";

async function findFile(prefix: string): Promise<string | null> {
  const dir = path.join(process.cwd(), ".debug");
  const files = await fs.readdir(dir).catch(() => []);
  const matched = files.filter((f) => f.includes(prefix)).sort();
  return matched.length ? path.join(dir, matched[matched.length - 1]) : null;
}

async function main() {
  const xywcqk = await findFile("-xywcqk.html");
  if (xywcqk) {
    const html = await fs.readFile(xywcqk, "utf8");
    const r = parseProgress(html);
    console.log("=== 学业完成情况 ===");
    console.log("总计:", r.totals);
    console.log("课程体系:");
    for (const s of r.summary) console.log("  ", JSON.stringify(s));
    console.log(`已完成必修: ${r.completed.length} 门`);
    console.log(`未完成必修: ${r.uncompleted.length} 门`);
    console.log("\n已完成前 3:");
    r.completed.slice(0, 3).forEach((c) => console.log("  ", c.courseName, c.score, c.credits, "学分"));
    console.log("未完成前 3:");
    r.uncompleted.slice(0, 3).forEach((c) => console.log("  ", c.courseName, c.semester, c.credits, "学分"));
  }
  const pyfa = await findFile("-pyfa.html");
  if (pyfa) {
    const html = await fs.readFile(pyfa, "utf8");
    const r = parsePyfa(html);
    console.log("\n=== 培养方案 ===");
    console.log(`共 ${r.list.length} 门课`);
    console.log("按学期统计:");
    for (const s of r.bySemester) console.log(`  ${s.semester}: ${s.courses} 门, ${s.credits.toFixed(1)} 学分`);
    console.log("\n前 3 门:");
    r.list.slice(0, 3).forEach((c) => console.log("  ", c.semester, c.courseName, c.credits, "学分", c.attr));
  }
}
main().catch(console.error);
