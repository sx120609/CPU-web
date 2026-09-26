import assert from "node:assert/strict";
import test from "node:test";
import {
  collapseTranscriptGrades,
  isTranscriptPassing,
  transcriptGradePoint,
  transcriptGradeStats,
} from "../../web/src/utils/jwxtGradeStats";

const row = (overrides: Record<string, unknown> = {}) => ({
  semester: "2025-2026-1",
  courseCode: "TEST-001",
  courseName: "测试课程",
  score: "80",
  scoreNum: 80,
  credits: 1,
  ...overrides,
});

test("成绩单统计优先保留补考后的通过记录，并把重复课程合并为一门课", () => {
  const rows = [
    row({ courseCode: "ANATOMY", courseName: "人体解剖生理学", score: "56", scoreNum: 56, credits: 3 }),
    row({ courseCode: "ANATOMY", courseName: "人体解剖生理学", score: "73", scoreNum: 73, credits: 3, examType: "补考" }),
    row({ courseCode: "POLICY", courseName: "形势与政策", score: "96", scoreNum: 96, credits: 0.25 }),
    row({ courseCode: "POLICY", courseName: "形势与政策", score: "96", scoreNum: 96, credits: 0.25 }),
  ];

  const collapsed = collapseTranscriptGrades(rows);
  const stats = transcriptGradeStats(rows);

  assert.equal(isTranscriptPassing(rows[0]), false);
  assert.equal(collapsed.length, 2);
  assert.equal(stats.rows.length, 2);
  assert.equal(stats.credits, 3.25);
  // 补考成绩无论分数高低都按 1.0 绩点计入（与 web/tests/jwxtGradeStats.test.ts 的补考口径一致）。
  assert.equal(transcriptGradePoint(rows[1]), 1);
  assert.equal(stats.gpa, (1 * 3 + 4.6 * 0.25) / 3.25);
});

test("成绩单汇总按教务详情口径换算等级成绩", () => {
  // 等级成绩与教务详情、电子成绩单一致：优 = 4.5，良 = 3.5。
  const good = row({ courseCode: "GOOD", courseName: "等级良样本", score: "良", scoreNum: null, credits: 1 });
  assert.equal(isTranscriptPassing(good), true);
  assert.equal(transcriptGradePoint(good), 3.5);

  const military = row({ courseCode: "MILITARY", courseName: "军事技能", score: "优", scoreNum: null, credits: 2 });
  assert.equal(isTranscriptPassing(military), true);
  assert.equal(transcriptGradePoint(military), 4.5);

  const stats = transcriptGradeStats([
    military,
    row({ courseCode: "PASS", score: "70", scoreNum: 70, credits: 3 }),
  ]);
  assert.equal(stats.credits, 5);
  assert.equal(stats.gpa, (4.5 * 2 + 2 * 3) / 5);
});
