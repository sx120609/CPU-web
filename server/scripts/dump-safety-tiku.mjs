/**
 * 将江苏省安全平台题库（database.db 的 tiku 表）导出为 JSON，
 * 供 src/services/safetyPlatform.ts 通过 resolveJsonModule 直接加载。
 *
 * 用法：npm run tiku:dump -- </path/to/database.db>
 * 默认读取 server/ 下的 database.db。
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = path.resolve(process.argv[2] || path.join(serverRoot, "database.db"));
const outPath = path.join(serverRoot, "src", "services", "safetyPlatformTiku.json");

const csv = execFileSync("sqlite3", ["-csv", dbPath, "SELECT questionId, answer, quesType FROM tiku ORDER BY questionId;"], {
  encoding: "utf8",
}).trim();

const rows = [];
for (const line of csv.split("\n")) {
  if (!line.trim()) continue;
  const fields = line.split(",");
  if (fields.length !== 3) {
    console.warn(`跳过无法解析的行：${line}`);
    continue;
  }
  const [questionId, answer, quesType] = fields.map((field) => field.trim());
  if (!questionId || !quesType) continue;
  rows.push({ questionId, answer, quesType });
}

writeFileSync(outPath, JSON.stringify(rows, null, 2) + "\n");
console.log(`已导出 ${rows.length} 条题库到 ${path.relative(serverRoot, outPath)}`);