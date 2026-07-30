#!/usr/bin/env node

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const main = readFileSync(path.join(__dirname, "..", "dist", "electron", "main.js"), "utf8");
const shell = readFileSync(path.join(__dirname, "..", "src", "shell", "renderer.js"), "utf8");

assert.match(main, /guest-unlimited/, "客户端必须识别服务端临时免登录策略");
assert.match(main, /\/api\/site\/learning-assistant\/responses/, "临时模式必须走服务端免额度入口");
assert.match(main, /\/api\/oauth\/v1\/responses/, "恢复限制后必须走 OAuth 额度入口");
assert.match(main, /x-cpu-desktop-client/, "免登录请求必须标记为桌面客户端请求");
assert.match(main, /response\.status === 401 \|\| response\.status === 403/, "服务端关闭临时策略后必须立即回退");
assert.match(shell, /限时无限/, "工具页应明确显示临时不限次数状态");
assert.match(shell, /登录后按每日额度与 AI 点数使用/, "工具页应支持恢复账号额度后的动态文案");

console.log("学习通助手动态访问策略检查通过：免登录与账号额度均由服务端控制。");
