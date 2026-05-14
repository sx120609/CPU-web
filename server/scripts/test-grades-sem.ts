import { promises as fs } from "node:fs";
import path from "node:path";
import { parseGrades } from "../src/services/jwxtParser";

async function main() {
  const dir = path.join(process.cwd(), ".debug");
  const files = await fs.readdir(dir);
  const f = files.filter((x) => x.includes("-grades-list.html")).sort().pop();
  if (!f) { console.log("no grades-list file"); return; }
  const html = await fs.readFile(path.join(dir, f), "utf8");
  const r = parseGrades(html);
  console.log(`成绩条数: ${r.list.length}`);
  console.log(`学期可选: ${r.semesters.length}`);
  console.log(`前 5 个学期: ${r.semesters.slice(0, 5).map((s) => s.value).join(", ")}`);
}
main().catch(console.error);
