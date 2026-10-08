import assert from "node:assert/strict";
import test from "node:test";
import { COLLEGE_FEED_SOURCES, isOwnCollegeBoard } from "../src/services/collegeFeedSources";
import { crawlSchoolFeedSource } from "../src/services/schoolCrawlerCore";

function listResponse(body: string, url: string) {
  const bytes = new TextEncoder().encode(body);
  return {
    ok: true,
    status: 200,
    url,
    headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
    arrayBuffer: async () => bytes.buffer,
  } as unknown as Response;
}

async function parse(t: { after: (fn: () => void) => void }, html: string) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: URL | RequestInfo) => listResponse(html, String(input))) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const result = await crawlSchoolFeedSource({ slug: "t", listUrl: "https://x.cpu.edu.cn/56/list{page}.htm", maxPages: 1 }, { dryRun: true });
  return result.items.map((item) => [item.externalId, item.title, item.publishedAt.slice(0, 10)]);
}

test("学院通知源的 slug 和学院名各不相同，地址都在学校域名下", () => {
  assert.equal(new Set(COLLEGE_FEED_SOURCES.map((source) => source.slug)).size, COLLEGE_FEED_SOURCES.length);
  assert.equal(new Set(COLLEGE_FEED_SOURCES.map((source) => source.name)).size, COLLEGE_FEED_SOURCES.length);
  for (const source of COLLEGE_FEED_SOURCES) {
    assert.match(new URL(source.listUrl.replace("{page}", "")).hostname, /\.cpu\.edu\.cn$/);
    assert.match(source.slug, /^[a-z]+-notice$/);
  }
});

test("带缩略图的列表取标题链接，日期拆成“日”和“年-月”也能认", async (t) => {
  const items = await parse(t, `
    <ul class="news_list">
      <li class="news n1">
        <div class="news_imgs"><a href="/5c/23/c9040a220195/page.htm"></a></div>
        <div class="news_meta"><span class="news_day">02</span><span class="news_year">2025-04</span></div>
        <div class="news_title"><a href="/5c/23/c9040a220195/page.htm" title="中药学院诚聘英才">中药学院诚聘英才</a></div>
        <a class="news_ckxq" href="/5c/23/c9040a220195/page.htm">查看详情</a>
      </li>
    </ul>`);
  assert.deepEqual(items, [["c9040a220195", "中药学院诚聘英才", "2025-04-02"]]);
});

test("不用 li 和 tr 排版的列表按文章链接所在的行解析", async (t) => {
  const items = await parse(t, `
    <ul><li><a href="/main.htm">首页</a></li><li><a href="/56/list.htm">通知公告</a></li></ul>
    <div class="jzlb"><div class="btt3"><a href="/bb/7f/c56a244607/page.htm">人工智能学院继续接收2027年硕士推免生通知</a></div><div class="fbsj4">2026-09-28</div></div>
    <div class="jzlb"><div class="btt3"><a href="/ba/58/c56a244312/page.htm">关于朱雍等同志职务聘任的公示</a></div><div class="fbsj4">2026-09-18</div></div>`);
  assert.deepEqual(items, [
    ["c56a244607", "人工智能学院继续接收2027年硕士推免生通知", "2026-09-28"],
    ["c56a244312", "关于朱雍等同志职务聘任的公示", "2026-09-18"],
  ]);
});

test("只有资料里填的学院和板块对得上时，学院板块才默认显示", () => {
  assert.equal(isOwnCollegeBoard({ feedDepartment: "药学院" }, " 药学院 "), true);
  assert.equal(isOwnCollegeBoard({ feedDepartment: "药学院" }, "中药学院"), false);
  assert.equal(isOwnCollegeBoard({ feedDepartment: "药学院" }, null), false);
  // 不是学院的部门不因为用户乱填而变成默认。
  assert.equal(isOwnCollegeBoard({ feedDepartment: "科学技术研究院" }, "科学技术研究院"), false);
});
