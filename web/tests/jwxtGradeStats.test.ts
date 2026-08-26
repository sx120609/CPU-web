import assert from "node:assert/strict";
import test from "node:test";
import { collapseTranscriptGrades } from "../src/utils/jwxtGradeStats";

test("同一学期同一课程代码的重复成绩只保留一条", () => {
  const rows = collapseTranscriptGrades([
    { semester: "2025-2026-1", courseCode: "1112070132", courseName: "形势与政策", score: "96", credits: 0.25 },
    { semester: "2025-2026-1", courseCode: "1112070132", courseName: "形势与政策", score: "96", credits: 0.25 },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.courseCode, "1112070132");
});

test("不同学期或不同课程代码的同名课程分别保留", () => {
  const rows = collapseTranscriptGrades([
    { semester: "2024-2025-1", courseCode: "1112070128", courseName: "形势与政策", score: "88", credits: 0.25 },
    { semester: "2024-2025-2", courseCode: "1112070131", courseName: "形势与政策", score: "88", credits: 0.25 },
    { semester: "2025-2026-1", courseCode: "1112070132", courseName: "形势与政策", score: "96", credits: 0.25 },
    { semester: "2025-2026-2", courseCode: "1112070133", courseName: "形势与政策", score: "95", credits: 0.25 },
  ]);

  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((row) => row.courseCode), [
    "1112070128",
    "1112070131",
    "1112070132",
    "1112070133",
  ]);
});

test("同一学期同一课程代码存在多次成绩时保留通过且较高的一条", () => {
  const rows = collapseTranscriptGrades([
    { semester: "2025-2026-1", courseCode: "1112070132", courseName: "形势与政策", score: "55", credits: 0.25 },
    { semester: "2025-2026-1", courseCode: "1112070132", courseName: "形势与政策", score: "86", credits: 0.25 },
    { semester: "2025-2026-1", courseCode: "1112070132", courseName: "形势与政策", score: "96", credits: 0.25 },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.score, "96");
});
