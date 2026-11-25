import assert from "node:assert/strict";
import test from "node:test";
import { parseHomeFeedStream, selectHomeFeedBoardSlugWhere, selectHomeFeedBoardTypes } from "../src/services/homeFeed";

const boardTypes = ["normal", "question", "market", "announce", "coursereview"];

test("首页论坛流排除二手、公告与失物招领板块", () => {
  assert.deepEqual(selectHomeFeedBoardTypes(boardTypes, "forum"), ["normal", "question", "coursereview"]);
  assert.deepEqual(selectHomeFeedBoardSlugWhere("forum", true), { slug: { notIn: ["campus-wall", "lost-found"] } });
});

test("首页二手流只保留二手板块", () => {
  assert.deepEqual(selectHomeFeedBoardTypes(boardTypes, "market"), ["market"]);
  assert.deepEqual(selectHomeFeedBoardSlugWhere("market", true), { slug: { notIn: ["campus-wall"] } });
});

test("首页失物招领流只保留失物招领板块，关闭时返回空集合", () => {
  assert.deepEqual(selectHomeFeedBoardTypes(boardTypes, "lost-found"), ["normal"]);
  assert.deepEqual(selectHomeFeedBoardSlugWhere("lost-found", true), { slug: "lost-found" });
  assert.deepEqual(selectHomeFeedBoardSlugWhere("lost-found", false), { slug: { in: [] } });
});

test("首页全量流仍排除公告并在失物关闭时排除失物板块", () => {
  assert.deepEqual(selectHomeFeedBoardTypes(boardTypes, "all"), ["normal", "question", "market", "coursereview"]);
  assert.deepEqual(selectHomeFeedBoardSlugWhere("all", true), { slug: { notIn: ["campus-wall"] } });
  assert.deepEqual(selectHomeFeedBoardSlugWhere("all", false), { slug: { notIn: ["campus-wall", "lost-found"] } });
});

test("首页动态分流参数支持 lost-found 并拒绝未知值", () => {
  assert.equal(parseHomeFeedStream(" MARKET "), "market");
  assert.equal(parseHomeFeedStream(" lost-found "), "lost-found");
  assert.throws(() => parseHomeFeedStream("second-hand"), /首页动态分流参数无效/);
});
