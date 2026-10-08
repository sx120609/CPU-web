import assert from "node:assert/strict";
import test from "node:test";
import { marked } from "marked";
import { normalizeBareUrlBoundaries } from "../../web/src/utils/markdownNormalize";

// Same options as web/src/utils/markdown.ts.
marked.setOptions({ breaks: true, gfm: true });

function render(markdown: string) {
  return marked.parse(normalizeBareUrlBoundaries(markdown), { async: false }) as string;
}

function hrefs(markdown: string) {
  return Array.from(render(markdown).matchAll(/href="([^"]*)"/gu), (match) => decodeURI(match[1].replace(/&amp;/gu, "&")));
}

test("链接后直接接中文正文时，正文不进入链接", () => {
  assert.deepEqual(hrefs("打开 https://cputime.cn/jwxt查看成绩"), ["https://cputime.cn/jwxt"]);
  assert.match(render("打开 https://cputime.cn/jwxt查看成绩"), /<\/a>查看成绩/u);
  assert.deepEqual(hrefs("官网：https://www.cpu.edu.cn.具体以官网为准"), ["https://www.cpu.edu.cn"]);
});

test("链接后的中文标点、全角符号和省略号不进入链接", () => {
  for (const [markdown, expected] of [
    ["打开 https://cputime.cn/jwxt。然后登录", "https://cputime.cn/jwxt"],
    ["访问https://cputime.cn/jwxt～", "https://cputime.cn/jwxt"],
    ["入口在 https://cputime.cn/jwxt…", "https://cputime.cn/jwxt"],
    ["（详见 https://cputime.cn/jwxt）", "https://cputime.cn/jwxt"],
    ["地址「https://cputime.cn/jwxt」", "https://cputime.cn/jwxt"],
  ] as const) {
    assert.deepEqual(hrefs(markdown), [expected], markdown);
  }
});

test("加粗的链接不会把星号带进链接", () => {
  assert.deepEqual(hrefs("**https://cputime.cn/jwxt**。"), ["https://cputime.cn/jwxt"]);
  assert.match(render("**https://cputime.cn/jwxt**。"), /<strong><a [^>]*>https:\/\/cputime\.cn\/jwxt<\/a><\/strong>/u);
});

test("显式 Markdown 链接的地址末尾多出的标点会被去掉", () => {
  assert.deepEqual(hrefs("[教务数据](https://cputime.cn/jwxt。)"), ["https://cputime.cn/jwxt"]);
  assert.deepEqual(hrefs("[教务数据](https://cputime.cn/jwxt.)"), ["https://cputime.cn/jwxt"]);
});

test("www 开头的裸链接同样在中文处结束", () => {
  assert.deepEqual(hrefs("www.cpu.edu.cn查看通知"), ["http://www.cpu.edu.cn"]);
  assert.match(render("www.cpu.edu.cn查看通知"), />www\.cpu\.edu\.cn<\/a>查看通知/u);
});

test("路径或参数里的中文保持在链接内", () => {
  assert.deepEqual(hrefs("https://zh.wikipedia.org/wiki/中国药科大学"), ["https://zh.wikipedia.org/wiki/中国药科大学"]);
  assert.deepEqual(hrefs("搜索 https://cputime.cn/search?q=成绩，然后筛选"), ["https://cputime.cn/search?q=成绩"]);
});

test("代码、已有的尖括号链接和后面跟空格的链接保持原样", () => {
  const source = [
    "`https://cputime.cn/jwxt查看`",
    "<https://cputime.cn/jwxt>",
    "打开 https://cputime.cn/jwxt 查看成绩",
  ].join("\n");
  assert.equal(normalizeBareUrlBoundaries(source), source);
  assert.deepEqual(hrefs("打开 https://cputime.cn/jwxt 查看成绩"), ["https://cputime.cn/jwxt"]);
});

// Cases from campusAssistant.test.ts, which CI skips because it needs a database.
test("中文标点后的长段正文不进入链接，显式链接、尖括号链接和中文路径保持原样", () => {
  const sentence = "用手机或电脑的系统浏览器打开 https://cputime.cn。药大拾间是学生自主开发维护的独立、非官方校园服务站点。";
  assert.equal(
    normalizeBareUrlBoundaries(sentence),
    "用手机或电脑的系统浏览器打开 <https://cputime.cn>。药大拾间是学生自主开发维护的独立、非官方校园服务站点。",
  );
  const preserved = [
    "`https://cputime.cn。代码说明`",
    "[站点](https://cputime.cn/中文路径)",
    "<https://cputime.cn/中文路径>",
    "https://cputime.cn/中文路径",
  ].join("\n");
  assert.equal(normalizeBareUrlBoundaries(preserved), preserved);
});
