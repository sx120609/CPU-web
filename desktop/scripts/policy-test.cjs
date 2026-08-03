#!/usr/bin/env node
// 地址策略的断言测试。跑之前要先 npm run build。
//
//   node scripts/policy-test.cjs
//
// 这里测的是"本应用不是通用浏览器"这条产品约束。它靠一组白名单实现，
// 白名单一旦被放宽（比如有人为了修某个跳转顺手加了通配），
// 特权桥就会跟着漏给站外页面，而这种回归在手工点击时基本发现不了。

const assert = require("node:assert/strict");
const path = require("node:path");

const dist = path.join(__dirname, "..", "dist", "electron");
let policy;
let shared;
try {
  policy = require(path.join(dist, "policy.js"));
  shared = require(path.join(dist, "shared.js"));
} catch (error) {
  console.error("找不到编译产物，请先执行 npm run build。");
  console.error(error.message);
  process.exit(1);
}

const { asNavigableUrl, asInjectableUrl, asSiteUrl, scriptMatchesUrl, createAuthNavigationRule } = policy;
const { isUrlMatched } = shared;

let passed = 0;
let failed = 0;

const check = (name, fn) => {
  try {
    fn();
    passed += 1;
  } catch (error) {
    failed += 1;
    console.error(`✗ ${name}\n  ${error.message.split("\n")[0]}`);
  }
};

/* ---------------------------------------------------------- 可导航地址 */

check("学习通放行", () => {
  assert.ok(asNavigableUrl("https://i.chaoxing.com/"));
  assert.ok(asNavigableUrl("https://passport2.chaoxing.com/login"));
  assert.ok(asNavigableUrl("https://mooc1.chaoxing.com/mycourse"));
});

check("学校统一认证放行（机构账号登录要跳）", () => {
  assert.ok(asNavigableUrl("https://id.cpu.edu.cn/authserver/login"));
});

check("主站放行（主窗口就是它）", () => {
  assert.ok(asSiteUrl("https://cpu.lizmt.cn/"));
  assert.ok(asNavigableUrl("https://cpu.lizmt.cn/forum"));
});

check("站外地址一律不放行", () => {
  for (const url of [
    "https://www.google.com/",
    "https://github.com/",
    "https://lizmt.cn/",               // 主站的父域不算主站
    "https://example.com/chaoxing.com" // 路径里带白名单域名不算数
  ]) {
    assert.equal(asNavigableUrl(url), undefined, `不该放行 ${url}`);
  }
});

check("后缀拼接不能骗过主机匹配", () => {
  for (const url of [
    "https://chaoxing.com.evil.tld/",
    "https://notchaoxing.com/",
    "https://evil-chaoxing.com/",
    "https://xchaoxing.com/"
  ]) {
    assert.equal(asNavigableUrl(url), undefined, `不该放行 ${url}`);
  }
});

check("大小写与端口不影响判定", () => {
  assert.ok(asNavigableUrl("https://I.ChaoXing.COM/"));
  assert.ok(asNavigableUrl("https://i.chaoxing.com:443/"));
});

check("非 https 一律拒绝", () => {
  for (const url of [
    "http://i.chaoxing.com/",
    "file:///C:/Windows/System32/drivers/etc/hosts",
    "ftp://i.chaoxing.com/",
    "javascript:alert(1)",
    "data:text/html,<h1>x</h1>",
    "about:blank"
  ]) {
    assert.equal(asNavigableUrl(url), undefined, `不该放行 ${url}`);
  }
});

check("畸形输入不抛异常", () => {
  for (const url of ["", "   ", "not a url", "https://", "://x", "https://[", String(null)]) {
    assert.equal(asNavigableUrl(url), undefined);
  }
});

/* ------------------------------------------------- 可注入地址（更窄一层） */

check("可注入范围比可导航范围窄", () => {
  const sso = "https://id.cpu.edu.cn/authserver/login";
  assert.ok(asNavigableUrl(sso), "统一认证应当可导航");
  assert.equal(asInjectableUrl(sso), undefined, "统一认证不该被注入脚本，更不该拿到特权桥");
});

check("主站可导航但绝不可注入", () => {
  const site = "https://cpu.lizmt.cn/forum";
  assert.ok(asNavigableUrl(site));
  // 刷课脚本没有任何理由跑在自己的站点上，跑了就等于把脚本特权桥递给主站页面
  assert.equal(asInjectableUrl(site), undefined);
});

check("超星域名可注入", () => {
  assert.ok(asInjectableUrl("https://mooc1.chaoxing.com/mycourse"));
});

/* ------------------------------------------------- OAuth 授权窗口放行规则 */

check("授权窗口只放行主站与本次回环回调", () => {
  const rule = createAuthNavigationRule("http://127.0.0.1:43127");
  assert.equal(rule("https://cpu.lizmt.cn/api/oauth/authorize?x=1"), true);
  assert.equal(rule("http://127.0.0.1:43127/oauth/callback?code=x"), true);
  // 换个端口就不是本次登录的回调了
  assert.equal(rule("http://127.0.0.1:43128/oauth/callback"), false);
  assert.equal(rule("http://localhost:43127/oauth/callback"), false);
  assert.equal(rule("https://evil.tld/oauth/callback"), false);
  assert.equal(rule("https://i.chaoxing.com/"), false);
});

/* ------------------------------------------------------------ @match */

check("@match 的 * 协议通配降级为只匹配 https", () => {
  assert.equal(isUrlMatched("*://*.chaoxing.com/*", "http://i.chaoxing.com/x"), false);
  assert.equal(isUrlMatched("*://*.chaoxing.com/*", "https://i.chaoxing.com/x"), true);
});

check("显式 http 的 @match 规则作废", () => {
  assert.equal(isUrlMatched("http://*.chaoxing.com/*", "https://i.chaoxing.com/x"), false);
});

check("裸 * 主机通配不被接受", () => {
  assert.equal(isUrlMatched("*://*/*", "https://evil.tld/x"), false);
});

check("*.example 不匹配 example 本身以外的相似域", () => {
  assert.equal(isUrlMatched("*://*.chaoxing.com/*", "https://evilchaoxing.com/x"), false);
  assert.equal(isUrlMatched("*://*.chaoxing.com/*", "https://a.chaoxing.com/x"), true);
});

/* ------------------------------------------- 两道关卡必须同时通过才注入 */

check("脚本 @match 命中但站点不在收口表内，仍然不注入", () => {
  // 假想一个声明了过宽 @match 的脚本：收口表要能兜住
  const greedy = { matches: ["*://*.cpu.edu.cn/*", "*://*.chaoxing.com/*"] };
  assert.equal(scriptMatchesUrl(greedy, "https://id.cpu.edu.cn/authserver/login"), false);
  assert.equal(scriptMatchesUrl(greedy, "https://i.chaoxing.com/"), true);
});

check("站点在收口表内但脚本 @match 不命中，也不注入", () => {
  const narrow = { matches: ["*://mooc1.chaoxing.com/*"] };
  assert.equal(scriptMatchesUrl(narrow, "https://i.chaoxing.com/"), false);
  assert.equal(scriptMatchesUrl(narrow, "https://mooc1.chaoxing.com/mycourse"), true);
});

/* ----------------------------------- 内置脚本的实际 @match 必须已被收窄 */

check("内置脚本不再声明 *.edu.cn 这类泛匹配", () => {
  const fs = require("node:fs");
  const source = fs.readFileSync(path.join(__dirname, "..", "assets", "userscripts", "monkey.js"), "utf8");
  const header = source.match(/\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/);
  assert.ok(header, "用户脚本缺少元数据头");
  const matches = [...header[1].matchAll(/^\s*\/\/\s*@match\s+(.+?)\s*$/gm)].map((m) => m[1]);
  assert.ok(matches.length > 0, "用户脚本没有声明 @match");
  for (const pattern of matches) {
    assert.ok(!/\*\.edu\.cn/.test(pattern), `@match 仍包含教育网泛匹配：${pattern}`);
    assert.ok(pattern.startsWith("https://"), `@match 应当限定 https：${pattern}`);
  }
});

check("学习通助手品牌、版本和进入课程引导已写入内置回退脚本", () => {
  const fs = require("node:fs");
  const source = fs.readFileSync(path.join(__dirname, "..", "assets", "userscripts", "monkey.js"), "utf8");
  assert.match(source, /^\/\/ @name\s+药大拾间·学习通助手$/m);
  assert.match(source, /^\/\/ @version\s+2\.2\.11$/m);
  assert.match(source, /cpu-learning-personal-center-guide-v3/);
  assert.match(source, /cpu-learning-course-guide-v3/);
  assert.match(source, /章节、作业或考试/);
  assert.match(source, /AI 答题额度已用完/);
  assert.match(source, /助手已停止继续请求/);
  assert.match(source, /response\.status === 429/);
  assert.match(source, /cpu-learning-assistant-panel/);
  assert.match(source, /data-action="toggle-runtime"/);
  assert.match(source, /章节测验答完自动提交/);
  assert.match(source, /cpu-learning-assistant-position-v1/);
  assert.match(source, /解题思路/);
  assert.match(source, /data-action="screenshot-search"/);
  assert.match(source, /GM_cpuCaptureArea/);
  assert.match(source, /reasoningEffort/);
  assert.doesNotMatch(source, /<details class="cpu-la-(?:sources|reasoning)/);
  assert.match(source, /formatLearningDisplayText/);
  assert.doesNotMatch(source, /cpu-la-footer/);
  assert.doesNotMatch(source, /切记填写完要刷新页面才会生效/);
  assert.doesNotMatch(source, /题库秘钥配置请点击这个按钮|label:\s*"公告"|label:\s*"运行框"/);
  assert.doesNotMatch(source, /Auto Ask/);
  assert.doesNotMatch(source, /工具\s*→\s*刷题|这里改了不会生效/);
});

console.log(`\n${passed} 项通过，${failed} 项失败。`);
process.exit(failed === 0 ? 0 : 1);
