import assert from "node:assert/strict";
import test from "node:test";
import { crawlSchoolFeedSource } from "../src/services/schoolCrawlerCore";

type MockResponse = {
  ok: boolean;
  status: number;
  url: string;
  headers: Headers;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

function response(body: string, url: string): MockResponse {
  const bytes = new TextEncoder().encode(body);
  return {
    ok: true,
    status: 200,
    url,
    headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
    arrayBuffer: async () => bytes.buffer,
  };
}

test("crawler resolves school URLs, parses mixed list layouts and keeps downloadable links", async (t) => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  const list = `
    <ul><li><div class="news_title"><a href="/notice/a.htm" title="第一条">第一条</a></div><time>2026.9.1</time></li></ul>
    <table><tr><td><a href="//jwc.cpu.edu.cn/notice/b.htm">第二条</a></td><td class="date">2026年09月02日</td></tr></table>`;
  const detail = `
    <div class="wp_articlecontent">
      <p>正文</p>
      <p><a href="/_upload/article/files/a.pdf">附件.pdf</a></p>
      <img src="/_upload/article/images/a.png">
    </div>`;

  globalThis.fetch = (async (input: URL | RequestInfo) => {
    const url = String(input);
    requested.push(url);
    if (url.endsWith("/list.htm")) return response(list, url) as unknown as Response;
    if (url.endsWith("/notice/a.htm") || url.endsWith("/notice/b.htm")) return response(detail, url) as unknown as Response;
    throw new Error(`unexpected URL ${url}`);
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await crawlSchoolFeedSource({
    slug: "test",
    listUrl: "http://jwc.cpu.edu.cn/list{page}.htm",
    maxPages: 1,
  });

  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items.map((item) => item.url), [
    "https://jwc.cpu.edu.cn/notice/a.htm",
    "https://jwc.cpu.edu.cn/notice/b.htm",
  ]);
  assert.match(result.items[0].content, /https:\/\/jwc\.cpu\.edu\.cn\/_upload\/article\/files\/a\.pdf/);
  assert.match(result.items[0].content, /https:\/\/jwc\.cpu\.edu\.cn\/_upload\/article\/images\/a\.png/);
  assert.ok(requested.every((url) => url.startsWith("https://jwc.cpu.edu.cn/")));
});

test("crawler marks protocol-relative WeChat shells as external", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: URL | RequestInfo) => {
    const url = String(input);
    if (url.endsWith("/list.htm")) return response(
      `<ul><li><a href="/notice.htm">通知</a><span class="date">2026-09-01</span></li></ul>`,
      url,
    ) as unknown as Response;
    return response(
      `<div class="wp_articlecontent"><p>详情请点击下方链接</p><a href="//mp.weixin.qq.com/s/example">阅读全文</a></div>`,
      url,
    ) as unknown as Response;
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await crawlSchoolFeedSource({
    slug: "test",
    listUrl: "https://yjsy.cpu.edu.cn/list.htm",
    maxPages: 1,
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].isExternal, true);
  assert.equal(result.items[0].effectiveUrl, "https://mp.weixin.qq.com/s/example");
});

test("crawler falls back to the configured HTTP URL when HTTPS is unavailable", async (t) => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = (async (input: URL | RequestInfo) => {
    const url = String(input);
    requested.push(url);
    if (url.startsWith("https://")) throw new Error("TLS unavailable");
    if (url.endsWith("/list.htm")) return response(
      `<li><a href="/notice.htm">通知</a><time>2026-09-01</time></li>`,
      url,
    ) as unknown as Response;
    return response("<div class=wp_articlecontent>正文</div>", url) as unknown as Response;
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await crawlSchoolFeedSource({ slug: "test", listUrl: "http://jwc.cpu.edu.cn/list.htm", maxPages: 1 });
  assert.equal(result.items[0].url, "http://jwc.cpu.edu.cn/notice.htm");
  assert.equal(result.items[0].effectiveUrl, "http://jwc.cpu.edu.cn/notice.htm");
  assert.deepEqual(requested.slice(0, 2), [
    "https://jwc.cpu.edu.cn/list.htm",
    "http://jwc.cpu.edu.cn/list.htm",
  ]);
});
