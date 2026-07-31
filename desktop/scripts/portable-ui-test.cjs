#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const script = fs.readFileSync(path.join(root, "build", "portable-preheat.nsi"), "utf8");
const prepare = fs.readFileSync(path.join(root, "scripts", "prepare-nsis.cjs"), "utf8");
const selfInstall = fs.readFileSync(path.join(root, "electron", "self-install.ts"), "utf8");

assert.deepEqual(packageJson.build.win.target, ["portable"], "Windows 仍应使用 portable 自解压包");
assert.equal(packageJson.build.portable.splashImage, undefined, "预热阶段不应再加载低 DPI 位图");
assert.match(script, /ManifestDPIAware true/, "预热窗口必须声明高 DPI 感知");
assert.match(script, /STR:启动预热中/, "预热窗口应只显示简洁状态文字");
assert.match(script, /GetDlgItem \$2 \$0 1004/, "预热窗口应复用真实解压进度条");
assert.match(script, /SetDetailsPrint none/, "解压文件名不应覆盖固定预热文案");
assert.match(script, /HideWindow[\s\S]*ExecWait/, "进入 Electron 安装器前应收起预热窗口");
assert.match(prepare, /portable-preheat\.nsi/, "本地和 CI 打包前都应安装自定义 portable 模板");
assert.match(
  selfInstall,
  /for \(let attempt = 0; attempt < 3; attempt \+= 1\)[\s\S]*countRunning\(exePath\)/,
  "覆盖更新必须重复确认旧版进程已经全部退出"
);
assert.match(selfInstall, /旧版本仍在运行，暂时无法安全更新/, "旧版无法退出时必须中止覆盖并明确提示");

console.log("Windows 安装检查通过：portable 高 DPI 预热与旧进程退出确认均已覆盖。");
