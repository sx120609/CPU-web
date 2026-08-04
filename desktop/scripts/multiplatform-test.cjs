#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "assets", "userscripts", "multiplatform.js"), "utf8");
const main = fs.readFileSync(path.join(root, "electron", "main.ts"), "utf8");
const config = fs.readFileSync(path.join(root, "electron", "config.ts"), "utf8");
const learningPreload = fs.readFileSync(path.join(root, "electron", "learning-preload.ts"), "utf8");
const credentialStore = fs.readFileSync(path.join(root, "electron", "chaoxing-credentials.ts"), "utf8");
const shellHtml = fs.readFileSync(path.join(root, "src", "shell", "index.html"), "utf8");
const shellRenderer = fs.readFileSync(path.join(root, "src", "shell", "renderer.js"), "utf8");
const sitePreload = fs.readFileSync(path.join(root, "electron", "site-preload.ts"), "utf8");

const header = source.match(/\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/)?.[1] || "";
assert.match(header, /@name\s+药大拾间·全平台网课助手/);
assert.match(header, /@version\s+4\.15\.3/);
assert.match(header, /@connect\s+desktop\.localhost/);
const connects = [...header.matchAll(/^\s*\/\/\s*@connect\s+(.+?)\s*$/gm)].map((match) => match[1]);
assert.deepEqual(connects, ["desktop.localhost"], "不得保留外部题库联网权限");
assert.doesNotMatch(header, /\*\.(?:edu|org)\.cn/, "不得恢复教育网泛域名权限");

for (const project of ["ZHSProject", "CXProject", "IcveMoocProject", "ZJYProject", "ICourseProject", "YKTProject"]) {
  assert.match(source, new RegExp(`\\b${project}\\b`), `缺少 OCS 平台项目 ${project}`);
}
assert.match(source, /药大拾间桌面端关闭后台节流/, "桌面端不应显示浏览器前台运行警告");
assert.doesNotMatch(source, /禁止最小化浏览器、切屏/, "不得保留与桌面后台能力冲突的提示");
for (const host of ["zhihuishu.com", "icve.com.cn", "icourse163.org", "yuketang.cn"]) {
  assert.match(header, new RegExp(host.replaceAll(".", "\\.")), `缺少 ${host} 的脚本匹配`);
  assert.match(config, new RegExp(`"${host.replaceAll(".", "\\.")}"`), `宿主未放行 ${host}`);
}

assert.match(main, /builtin-multiplatform-helper/);
assert.match(main, /matching\.some\(\(script\) => script\.id === "builtin-chaoxing-helper"\)/, "超星必须避免双引擎并跑");
assert.match(main, /https:\/\/desktop\.localhost\/ocs-ai/);
assert.match(main, /bridge\.requestAi/);
assert.match(main, /common\.settings\.upload/);
assert.match(main, /config\.autoSubmit === true \? "100" : "save"/, "关闭提交时必须暂存答案");

assert.match(shellHtml, /id="platform-dialog"/);
assert.match(shellRenderer, /shell\.tabs\.openLearning\(platform\.id\)/);
assert.match(sitePreload, /openLearning: \(platformId\?: string\)/);
assert.match(shellRenderer, /shell\.learningCredentials\.setRemember/);
assert.match(credentialStore, /safeStorage\.encryptString/);
assert.match(credentialStore, /learning-login-\$\{platformId\}\.bin/);
assert.match(learningPreload, /learning-credentials:context/);
assert.match(learningPreload, /learning-credentials:offer/);
assert.match(learningPreload, /MutationObserver/, "动态登录弹窗出现后也应识别密码框");

console.log("多平台助手检查通过：六个平台、CPU AI、提交保护、平台入口与加密凭据均已覆盖。");
