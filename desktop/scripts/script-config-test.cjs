#!/usr/bin/env node

const assert = require("node:assert/strict");
const path = require("node:path");

const { buildScriptConfig, DEFAULT_SCRIPT_CONFIG, NEEDS_RELOAD } = require(path.join(
  __dirname,
  "..",
  "dist",
  "electron",
  "script-config.js",
));

const config = buildScriptConfig({
  interval: 99,
  minAccuracy: 0,
  submitDelayMin: 1,
  submitDelayMax: 600,
  answerIntervalMin: 12,
  answerIntervalMax: 4,
});

assert.equal(config.interval, DEFAULT_SCRIPT_CONFIG.interval, "旧版换章等待覆盖值必须失效");
assert.equal(config.minAccuracy, 1, "旧版脚本兼容值必须要求所有题目均有答案");
assert.equal(config.submitDelayMin, DEFAULT_SCRIPT_CONFIG.submitDelayMin, "旧版提交等待最小值必须失效");
assert.equal(config.submitDelayMax, DEFAULT_SCRIPT_CONFIG.submitDelayMax, "旧版提交等待最大值必须失效");
assert.equal(config.answerIntervalMin, 12, "每题最短等待仍应允许用户调整");
assert.equal(config.answerIntervalMax, 12, "每题最长等待不得小于最短等待");
assert.deepEqual(
  NEEDS_RELOAD,
  ["autoVideo", "autoJump", "autoSubmit", "autoExam", "answerIntervalMin", "answerIntervalMax"],
  "重载键只应包含仍对用户开放的运行快照设置",
);

console.log("学习通助手配置精简检查通过。");
