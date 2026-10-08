import assert from "node:assert/strict";
import test from "node:test";
import {
  announcementOverridesFor,
  isDefaultAnnouncementDepartment,
  parsePortalNoticeResponse,
  portalNoticeExternalId,
  resolveAnnouncementSelection,
} from "../src/services/portalNotices";

const article = (overrides: Record<string, unknown> = {}) => ({
  id: 244709,
  title: " 关于开放实验工作的通知 ",
  publishTimestamp: "1791449949000",
  articleUrl: "http://jwc.cpu.edu.cn/bb/e5/c986a244709/page.htm",
  linkUrl: "http://jwc.cpu.edu.cn/bb/e5/c986a244709/page.htm",
  from: "教务处",
  phColName: "通知公告",
  summary: "根据有关通知，\n现将名单予以公示",
  ...overrides,
});

const body = (articles: unknown[], count = articles.length) =>
  JSON.stringify({ result: "1", reason: "", data: { count, articles } });

test("门户资讯列表解析出部门、栏目、原文地址和发布时间", () => {
  const page = parsePortalNoticeResponse(body([article()], 2923));
  assert.equal(page.total, 2923);
  assert.deepEqual(page.notices, [{
    id: 244709,
    title: "关于开放实验工作的通知",
    department: "教务处",
    column: "通知公告",
    url: "http://jwc.cpu.edu.cn/bb/e5/c986a244709/page.htm",
    publishedAt: new Date(1791449949000).toISOString(),
    summary: "根据有关通知， 现将名单予以公示",
  }]);
});

test("门户资讯列表接受 JSONP 包装和 BOM", () => {
  const page = parsePortalNoticeResponse(`﻿jQuery123_456(${body([article()])});`);
  assert.equal(page.notices.length, 1);
});

test("门户资讯列表丢弃缺部门、缺地址或地址不是网页的条目", () => {
  const page = parsePortalNoticeResponse(body([
    article({ id: 1, from: "" }),
    article({ id: 2, articleUrl: "javascript:alert(1)", linkUrl: "" }),
    article({ id: 3, publishTimestamp: "" }),
    article({ id: 4, articleUrl: "", linkUrl: "https://ist.cpu.edu.cn/info/1075/26351.htm" }),
  ]));
  assert.deepEqual(page.notices.map((notice) => notice.id), [4]);
});

test("登录态失效时门户返回登录页，解析报错而不是当成空列表", () => {
  assert.throws(() => parsePortalNoticeResponse("<!DOCTYPE html><html><body>统一身份认证</body></html>"), /登录态/);
  assert.throws(() => parsePortalNoticeResponse(JSON.stringify({ result: "0", reason: "未登录" })), /未登录/);
});

test("站群文章沿用部门网站抓取时的外部 ID，其他站点用门户文章号", () => {
  assert.equal(portalNoticeExternalId({ id: 244709, url: "http://jwc.cpu.edu.cn/bb/e5/c986a244709/page.htm" }), "c986a244709");
  assert.equal(portalNoticeExternalId({ id: 26351, url: "https://ist.cpu.edu.cn/info/1075/26351.htm" }), "portal-26351");
});

test("面向教职工的部门默认不进“全部”", () => {
  assert.equal(isDefaultAnnouncementDepartment("教务处"), true);
  assert.equal(isDefaultAnnouncementDepartment("中国药科大学"), true);
  assert.equal(isDefaultAnnouncementDepartment("科学技术研究院"), false);
  assert.equal(isDefaultAnnouncementDepartment("人事处"), false);
});

const sources = [
  { slug: "jwc-notice", announceDefault: true },
  { slug: "xgc-notice", announceDefault: true },
  { slug: "dept-kyy", announceDefault: false },
];

test("没选过部门时显示默认集合", () => {
  assert.deepEqual(resolveAnnouncementSelection(sources, null), ["jwc-notice", "xgc-notice"]);
});

test("用户的选择折算成相对默认集合的增减，并能还原", () => {
  const overrides = announcementOverridesFor(sources, ["jwc-notice", "dept-kyy", "gone"]);
  assert.deepEqual(overrides, { include: ["dept-kyy"], exclude: ["xgc-notice"] });
  assert.deepEqual(resolveAnnouncementSelection(sources, overrides), ["jwc-notice", "dept-kyy"]);
});

test("新出现的部门按它自己的默认值处理，不受旧选择影响", () => {
  const overrides = { include: ["dept-kyy"], exclude: ["xgc-notice"] };
  const later = [...sources, { slug: "dept-new", announceDefault: true }, { slug: "dept-staff", announceDefault: false }];
  assert.deepEqual(resolveAnnouncementSelection(later, overrides), ["jwc-notice", "dept-kyy", "dept-new"]);
});
