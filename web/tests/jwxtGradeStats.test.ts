import assert from "node:assert/strict";
import test from "node:test";
import { collapseTranscriptGrades, transcriptGradeStats } from "../src/utils/jwxtGradeStats";

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

test("等级成绩优按 4.5 绩点计入汇总", () => {
  const stats = transcriptGradeStats([
    { semester: "2025-2026-1", courseCode: "1911130005", courseName: "军事技能", score: "优", credits: 2 },
  ]);

  assert.equal(stats.credits, 2);
  assert.equal(stats.gpa, 4.5);
});

test("当前官方成绩单必修课样本汇总为 47.8 学分和 3.78 GPA", () => {
  const scores: Array<[string, number]> = [
    ["97", 1], ["92", 2], ["81", 3], ["95", 1], ["86", 4], ["87", 1],
    ["优", 2], ["82", 2], ["84", 0.5], ["87", 1], ["91", 3], ["88", 0.8],
    ["89", 2], ["87", 0.5], ["88", 0.25], ["84", 4], ["84", 1], ["99", 2],
    ["88", 0.5], ["83", 0.25], ["92", 1], ["93", 1], ["87", 4], ["93", 3],
    ["85", 2], ["85", 2], ["78", 2], ["84", 1],
  ];
  const stats = transcriptGradeStats(scores.map(([score, credits], index) => ({
    semester: index < 16 ? "2025-2026-1" : "2025-2026-2",
    courseCode: `course-${index}`,
    courseName: `课程 ${index}`,
    score,
    credits,
  })));

  assert.equal(stats.credits, 47.8);
  assert.equal(stats.gpa.toFixed(2), "3.78");
});
