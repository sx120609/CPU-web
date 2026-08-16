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
  assert.equal(stats.gpa, (2.3 * 3 + 4.6 * 0.25) / 3.25);
});

test("成绩单汇总把等级成绩与导出样本隔离验证", () => {
  // “良=3.5”与方法页一致；“优=2.5”只是当前第一账号导出结果的兼容证据，
  // 方法页没有把单字符“优”单独列出，不能据此反推学校明文规则。
  const good = row({ courseCode: "GOOD", courseName: "等级良样本", score: "良", scoreNum: null, credits: 1 });
  assert.equal(isTranscriptPassing(good), true);
  assert.equal(transcriptGradePoint(good), 3.5);

  const military = row({ courseCode: "MILITARY", courseName: "军事技能", score: "优", scoreNum: null, credits: 2 });
  assert.equal(isTranscriptPassing(military), true);
  assert.equal(transcriptGradePoint(military), 2.5);

  const stats = transcriptGradeStats([
    military,
    row({ courseCode: "PASS", score: "70", scoreNum: 70, credits: 3 }),
  ]);
  assert.equal(stats.credits, 5);
  assert.equal(stats.gpa, (2.5 * 2 + 2 * 3) / 5);
});
