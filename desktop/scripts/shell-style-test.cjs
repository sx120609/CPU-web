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
const main = fs.readFileSync(path.join(root, "electron", "main.ts"), "utf8");

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
assert.match(css, /\.about-card \.card-head > div\s*\{[\s\S]*?display:\s*grid;[\s\S]*?gap:\s*3px/, "关于标题与客户端名称必须纵向分行");
assert.match(css, /\.about-product\s*\{[\s\S]*?margin:\s*0;/, "关于副标题不得再用负边距挤进标题");
assert.doesNotMatch(css, /\.about-product\s*\{[\s\S]*?margin-top:\s*-\d+px/, "关于副标题不得通过负边距与标题重叠");
assert.match(main, /process\.platform !== "darwin"[\s\S]*?Menu\.setApplicationMenu\(null\);[\s\S]*?return;/, "Windows 必须彻底移除会被 Alt 唤出的传统菜单栏");
assert.match(html, /id="auth-login"[^>]*>去首页登录</, "未登录入口应回到首页这一套登录状态");
assert.match(renderer, /shell\.auth\.sync\(/, "账号卡片应先静默同步首页登录状态");
assert.match(html, /id="auth-sponsor-go"[^>]*>前往赞助</, "账号卡片应提供赞助获取 AI 点数入口");
assert.match(renderer, /assistantPointsPerYuan[\s\S]*auth-sponsor-rate/, "赞助入口应展示服务端下发的实时兑换比例");
assert.match(renderer, /shell\.tabs\.openSponsor\(\)/, "赞助入口应在客户端主站标签中打开赞助页面");
assert.match(html, /id="brand-home"[^>]*aria-label="返回药大拾间首页"/, "左侧品牌入口必须是可访问的首页按钮");
assert.match(renderer, /brand-home[\s\S]*shell\.tabs\.openHome\(\)/, "点击品牌入口必须调用首页导航");
assert.match(renderer, /tab-group tab-group-primary/, "首页与工具必须渲染为一组连结标签");
assert.match(renderer, /title\.dataset\.label = tab\.title/, "标签标题必须提供粗体占位文本");
assert.match(css, /\.tab-group-primary\s*\{[\s\S]*?overflow:\s*hidden;[\s\S]*?border:/, "首页与工具必须共享稳定的连结外框");
assert.match(css, /\.tab-group-primary \.tab\[data-kind="site"\]\s*\{\s*width:\s*132px;/, "首页标签必须保持固定宽度");
assert.match(css, /\.tab-group-primary \.tab\[data-kind="tools"\]\s*\{\s*width:\s*56px;/, "工具标签必须保持固定宽度");
assert.match(css, /\.tab-title::after\s*\{[\s\S]*?content:\s*attr\(data-label\);[\s\S]*?font-weight:\s*600;/, "非激活标签必须为激活粗体预留宽度");
assert.match(main, /tabs:open-home[\s\S]*navigateSite\(new URL\("\/", oauthConfig\.origin\)\.href\)/, "首页按钮必须导航到主站根地址，而非只切换标签");
assert.match(html, /id="script-version"/, "学习通助手区域应展示独立脚本版本与更新状态");
assert.match(renderer, /shell\.script\.getUpdateStates\(\)/, "助手区域应同时读取两套独立云端更新状态");
assert.match(html, /id="script-check-update"/, "学习通助手区域应提供手动检查更新按钮");
assert.match(html, /id="multiplatform-script-check-update"/, "多平台助手区域应提供同款手动检查更新按钮");
assert.match(renderer, /shell\.script\.checkUpdate\(kind\)/, "两套助手手动更新应调用各自的独立云端检查");
assert.doesNotMatch(renderer, /OCS v4\.15\.3 随客户端更新/, "多平台 OCS 不得继续显示为随客户端更新");
assert.doesNotMatch(html, /cfg-(?:interval|minAccuracy|submitDelayMin|submitDelayMax)/, "工具页不应继续暴露无意义的正确率、切章和提交等待设置");
assert.doesNotMatch(renderer, /"(?:interval|minAccuracy|submitDelayMin|submitDelayMax)"/, "已删除的节奏设置不应继续绑定到界面");
assert.match(renderer, /仅在全部题目都已获得答案时提交/, "自动提交说明应准确描述答案完整性条件");
const scriptBinding = renderer.slice(renderer.indexOf("const bindScript"), renderer.indexOf("const setAboutUpdateStatus"));
const scriptUpdateBinding = scriptBinding.match(/el\("script-check-update"\)[\s\S]*?\n  \}\);/)?.[0] ?? "";
assert.ok(scriptUpdateBinding || /bindUpdateButton\("script-check-update"/.test(scriptBinding), "应找到助手手动更新事件");
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
