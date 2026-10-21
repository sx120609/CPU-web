import assert from "node:assert/strict";
import test from "node:test";
import {
  documentTitle,
  normalizeSeoPath,
  parseSeoTopicId,
  plainText,
  renderRobotsTxt,
  renderSeoHtml,
  renderSitemapXml,
  resolvePageSeo,
  resolveStaticPageSeo,
  SITE_HOME_TITLE,
  type PageSeo,
} from "../src/services/seo";

const ORIGIN = "https://cputime.cn";
const INDEX_HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>药大拾间 · 中国药科大学校园互助与服务平台</title>
    <meta name="description" content="默认描述" />
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>`;

test("paths are normalized before lookup", () => {
  assert.equal(normalizeSeoPath("/"), "/");
  assert.equal(normalizeSeoPath(""), "/");
  assert.equal(normalizeSeoPath("/announcements/"), "/announcements");
  assert.equal(normalizeSeoPath("//forum//topic/12"), "/forum/topic/12");
  assert.equal(normalizeSeoPath("/%E5%85%AC%E5%91%8A"), "/公告");
  assert.equal(normalizeSeoPath("/%E0%A4%A"), "/%E0%A4%A");
});

test("the home page has the full site title and is canonical at the root", () => {
  for (const path of ["/", "/home", "/home/", "/index.html"]) {
    const seo = resolveStaticPageSeo(path)!;
    assert.equal(seo.title, SITE_HOME_TITLE, path);
    assert.equal(seo.path, "/", path);
    assert.equal(seo.index, true, path);
    assert.ok(seo.keywords?.includes("中国药科大学"), path);
  }
});

test("public pages get their own title and description", () => {
  const announcements = resolveStaticPageSeo("/announcements")!;
  assert.equal(announcements.title, "校园公告 · 药大拾间");
  assert.equal(announcements.index, true);
  assert.match(announcements.description, /教务处/);

  const download = resolveStaticPageSeo("/downloads")!;
  assert.equal(download.path, "/download");
  assert.equal(documentTitle("课表"), "课表 · 药大拾间");
});

test("personal, account and unknown pages are not indexed", () => {
  for (const path of [
    "/login",
    "/register",
    "/profile",
    "/profile/privacy",
    "/messages",
    "/post",
    "/post/12/edit",
    "/admin",
    "/vip",
    "/u/42",
    "/agenda",
    "/schedule/share/abc",
    "/search/results",
    "/workshop/mine",
    "/services/tools/filestore/submit/x",
    "/services/tools/questionnaires/x",
    "/services/tools/not-a-tool",
    "/no-such-page",
  ]) {
    const seo = resolveStaticPageSeo(path);
    assert.ok(seo, path);
    assert.equal(seo.index, false, path);
  }
});

test("topics, boards and workshop works are resolved from the database", async () => {
  assert.equal(resolveStaticPageSeo("/forum/topic/123"), null);
  assert.equal(resolveStaticPageSeo("/forum/b/jwc-notice"), null);
  assert.equal(resolveStaticPageSeo("/workshop/30a7b72d-8389-4823-8819-7a61bc64093c"), null);
  // Malformed ids never reach the database.
  const malformed = await resolvePageSeo("/forum/topic/abc", ORIGIN);
  assert.equal(malformed.index, false);
  assert.equal(malformed.title, "帖子 · 药大拾间");
});

test("topic ids accept only positive database integers", () => {
  assert.equal(parseSeoTopicId("28447"), 28447);
  for (const bad of ["0", "-1", "1e3", "12.0", "2147483648", ""]) assert.equal(parseSeoTopicId(bad), null, bad);
});

test("an indexable page gets canonical, Open Graph and structured data", () => {
  const html = renderSeoHtml(INDEX_HTML, resolveStaticPageSeo("/home")!, ORIGIN);
  assert.match(html, /<title>药大拾间 · 中国药科大学校园互助与服务平台<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/cputime\.cn\/" \/>/);
  assert.match(html, /<meta property="og:url" content="https:\/\/cputime\.cn\/" \/>/);
  assert.match(html, /"@type":"WebSite"/);
  assert.doesNotMatch(html, /name="robots"/);
  assert.equal(html.match(/<meta name="description"/g)?.length, 1);
  assert.match(html, /<body>\n    <noscript><main><h1>/);
});

test("a hidden page is marked noindex without canonical or body copy", () => {
  const html = renderSeoHtml(INDEX_HTML, resolveStaticPageSeo("/login")!, ORIGIN);
  assert.match(html, /<title>登录 · 药大拾间<\/title>/);
  assert.match(html, /<meta name="robots" content="noindex" \/>/);
  assert.doesNotMatch(html, /rel="canonical"/);
  assert.doesNotMatch(html, /<noscript>/);
  assert.doesNotMatch(html, /application\/ld\+json/);
});

test("article text is escaped in markup and in structured data", () => {
  const seo: PageSeo = {
    title: documentTitle('关于 <script>alert("x")</script> 的通知'),
    description: "A & B <b>",
    path: "/forum/topic/7",
    index: true,
    type: "article",
    image: { url: `${ORIGIN}/share/topic/7/card.png`, width: 720 },
    article: {
      headline: '关于 </script><script>alert(1)</script> 的通知',
      section: "教务处通知",
      publisher: "教务处",
      publishedAt: new Date("2026-10-20T08:00:00Z"),
      modifiedAt: new Date("2026-10-21T08:00:00Z"),
    },
    heading: "<img src=x onerror=alert(1)>",
    body: "正文",
  };
  const html = renderSeoHtml(INDEX_HTML, seo, ORIGIN);
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /<title>关于 &lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; 的通知 · 药大拾间<\/title>/);
  assert.match(html, /content="A &amp; B &lt;b&gt;"/);
  assert.match(html, /"@type":"Article"/);
  assert.match(html, /"datePublished":"2026-10-20T08:00:00.000Z"/);
  assert.match(html, /"author":\{"@type":"Organization","name":"教务处"\}/);
  assert.match(html, /\\u003c\/script\\u003e/);
  assert.match(html, /twitter:card" content="summary_large_image"/);
});

test("robots.txt leaves the API crawlable and points at the sitemap", () => {
  const robots = renderRobotsTxt(ORIGIN);
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Disallow: \/admin$/m);
  assert.doesNotMatch(robots, /^Disallow: \/api/m);
  assert.match(robots, /^Sitemap: https:\/\/cputime\.cn\/sitemap\.xml$/m);
});

test("sitemap entries are absolute, escaped and dated", () => {
  const xml = renderSitemapXml(ORIGIN, [
    { path: "/" },
    { path: "/forum/topic/7", lastmod: new Date("2026-10-21T08:00:00Z") },
    { path: "/a&b" },
  ]);
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<url><loc>https:\/\/cputime\.cn\/<\/loc><\/url>/);
  assert.match(xml, /<loc>https:\/\/cputime\.cn\/forum\/topic\/7<\/loc><lastmod>2026-10-21T08:00:00.000Z<\/lastmod>/);
  assert.match(xml, /<loc>https:\/\/cputime\.cn\/a&amp;b<\/loc>/);
});

test("markdown from synced notices becomes plain text", () => {
  const content = "<p>根据《关于印发<中国药科大学国家奖学金评选办法\\>的通知》\n\n## 附件\n\nE\\-mail: a@b.cn\n\n![](https://x/icon.gif)[名单.xls](https://x/a.xls) **加粗**";
  assert.equal(plainText(content), "根据《关于印发<中国药科大学国家奖学金评选办法>的通知》 附件 E-mail: a@b.cn 名单.xls 加粗");
});
