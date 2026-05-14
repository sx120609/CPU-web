import { promises as fs } from "node:fs";
import path from "node:path";
import { parseCalendar } from "../src/services/jwxtParser";

async function findFile(prefix: string): Promise<string | null> {
  const dir = path.join(process.cwd(), ".debug");
  const files = await fs.readdir(dir).catch(() => []);
  const matched = files.filter((f) => f.includes(prefix)).sort();
  return matched.length ? path.join(dir, matched[matched.length - 1]) : null;
}

async function main() {
  const f = await findFile("-calendar.html");
  if (!f) { console.log("no calendar file"); return; }
  const html = await fs.readFile(f, "utf8");
  const r = parseCalendar(html);
  console.log("学期:", r.currentSemester);
  console.log("学期始:", r.semesterStart);
  console.log("学期末:", r.semesterEnd);
  console.log("今天:", r.today);
  console.log("当前周:", r.currentWeek);
  console.log("共", r.weeks.length, "周");
  console.log("前 5 周:");
  for (const w of r.weeks.slice(0, 5)) {
    console.log(`  第 ${w.week} 周 (${w.monday} ~ ${w.sunday}):`, w.days.join(" | "));
  }
}
main().catch(console.error);
