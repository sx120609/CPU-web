#!/usr/bin/env node

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const main = readFileSync(path.join(__dirname, "..", "dist", "electron", "main.js"), "utf8");
const shell = readFileSync(path.join(__dirname, "..", "src", "shell", "renderer.js"), "utf8");
const shellHtml = readFileSync(path.join(__dirname, "..", "src", "shell", "index.html"), "utf8");

assert.match(main, /userscript:get-learning-policy/, "the assistant must refresh answer-mode policy while the client is running");
assert.match(main, /available === false/, "the host must reject a tier disabled during guest-unlimited access");

assert.match(main, /guest-unlimited/, "客户端必须识别服务端临时免登录策略");
assert.match(main, /\/api\/site\/learning-assistant\/responses/, "临时模式必须走服务端免额度入口");
assert.match(main, /\/api\/oauth\/v1\/responses/, "恢复限制后必须走 OAuth 额度入口");
assert.match(main, /x-cpu-desktop-client/, "免登录请求必须标记为桌面客户端请求");
assert.match(main, /response\.status === 401 \|\| response\.status === 403/, "服务端关闭临时策略后必须立即回退");
assert.match(shell, /限时无限/, "工具页应明确显示临时不限次数状态");
assert.match(shell, /登录后按每日额度与 AI 点数使用/, "工具页应支持恢复账号额度后的动态文案");
assert.match(shell, /learningAssistant\?\.answerModes/, "工具页答题模式必须读取服务端下发的档位配置");
assert.match(shell, /mode\.pointMultiplier/, "工具页必须显示服务端实时下发的点数倍率");
assert.match(shell, /QUOTA_RULES_CACHE_KEY[\s\S]*localStorage/, "工具页断网时必须读取最近一次成功的档位缓存");
assert.match(shell, /key:\s*"max"[^\n]*pointMultiplier:\s*5[^\n]*available:\s*false/, "首次离线启动必须使用保守的 5 点最高档基线且默认关闭");
assert.match(shell, /void refreshQuotaRules\(\)/, "工具页首开不得等待额度接口，断网时也必须立即可用");
assert.doesNotMatch(shell, /await refreshQuotaRules\(\)/, "工具页首开不得被额度接口超时阻塞");
assert.doesNotMatch(shellHtml, /(?:快速判断|深入分析|挑战难题)\s*·\s*(?:1|1\.5|2)\s*点/, "工具页 HTML 不得继续写死档位点数");

console.log("学习通助手动态访问策略检查通过：免登录与账号额度均由服务端控制。");
