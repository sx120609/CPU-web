#!/usr/bin/env node
// 外壳没有 CSS 构建步骤，类名冲突会直接进入安装包。这里守住开关与更新进度条
// 的命名边界，避免通用的 .track/.fill 再次把所有开关压扁或裁掉滑块。

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "src", "shell", "index.html"), "utf8");
const renderer = fs.readFileSync(path.join(root, "src", "shell", "renderer.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "shell", "style.css"), "utf8");

assert.doesNotMatch(renderer, /\u5f00\u901a\u8bba\u575b/, "论坛默认开放后不应再显示开通论坛信誉奖励");

assert.match(html, /class="switch-track"/, "静态开关必须使用专属 switch-track 类名");
assert.match(renderer, /className = "switch-track"/, "动态开关必须使用专属 switch-track 类名");
assert.match(html, /class="update-track"/, "更新进度条必须使用专属 update-track 类名");
assert.match(css, /\.switch-track\s*\{[\s\S]*?height:\s*22px/, "开关轨道高度应保持为 22px");
assert.match(css, /\.update-track\s*\{[\s\S]*?height:\s*5px/, "更新进度条高度应保持为 5px");
assert.match(html, /© 2026 药大拾间客户端 · 校园互助与服务平台/, "客户端页脚应复用主站版权文案");
assert.match(html, /Mom0ka27/, "关于区域应标注客户端初版贡献者");
assert.match(html, /SoraNoNeko\/cpu_net/, "关于区域应保留校园网连接模块的上游来源");
assert.match(html, /shushoujiu/, "关于区域应保留学习通辅助脚本原作者署名");
assert.match(renderer, /about-version[\s\S]*info\.version/, "关于区域应展示当前客户端版本");
assert.match(renderer, /about-product[\s\S]*info\?\.platform === "darwin"/, "关于区域应按平台展示客户端名称");
assert.match(html, /id="auth-login"[^>]*>去首页登录</, "未登录入口应回到首页这一套登录状态");
assert.match(renderer, /shell\.auth\.sync\(/, "账号卡片应先静默同步首页登录状态");
assert.match(html, /id="script-version"/, "学习通助手区域应展示独立脚本版本与更新状态");
assert.match(renderer, /shell\.script\.getUpdateState\(\)/, "学习通助手区域应读取云端更新状态");
assert.match(html, /id="script-check-update"/, "学习通助手区域应提供手动检查更新按钮");
assert.match(renderer, /shell\.script\.checkUpdate\(\)/, "手动检查助手更新应调用独立云端检查");
const scriptBinding = renderer.slice(renderer.indexOf("const bindScript"), renderer.indexOf("const setAboutUpdateStatus"));
const scriptUpdateBinding = scriptBinding.match(/el\("script-check-update"\)[\s\S]*?\n  \}\);/)?.[0] ?? "";
assert.ok(scriptUpdateBinding, "应找到助手手动更新事件");
assert.doesNotMatch(scriptUpdateBinding, /\bsay\(/, "助手更新状态必须留在助手卡片内，不应写到页面底部通用状态栏");
assert.match(html, /id="about-check-update"/, "关于区域应提供手动检查客户端更新按钮");
assert.match(renderer, /shell\.update\.check\(\)/, "手动检查客户端更新应调用跨平台版本检查");
assert.match(renderer, /runtimePlatform === "darwin"[\s\S]*新版 DMG/, "macOS 手动检查发现新版后应引导下载 DMG");

const htmlClassNames = [...html.matchAll(/\bclass=["']([^"']*)["']/g)]
  .flatMap((match) => match[1].split(/\s+/))
  .filter(Boolean);

for (const generic of ["track", "thumb", "fill"]) {
  const cssSelector = new RegExp(`(^|[},])\\\\s*\\\\.${generic}(?=[\\\\s.{:#>,+~\\\\[])`, "m");
  assert.ok(!htmlClassNames.includes(generic), `HTML 不应再使用通用 .${generic} 类名`);
  assert.doesNotMatch(renderer, new RegExp(`className\\\\s*=\\\\s*["']${generic}["']`), `动态节点不应再使用通用 .${generic} 类名`);
  assert.doesNotMatch(css, cssSelector, `CSS 不应再声明通用 .${generic} 选择器`);
}

console.log("外壳样式命名检查通过：开关与更新进度条已隔离。");
