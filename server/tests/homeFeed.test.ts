import assert from "node:assert/strict";
import test from "node:test";
import { parseHomeFeedStream, selectHomeFeedBoardTypes } from "../src/services/homeFeed";

const boardTypes = ["normal", "question", "market", "announce", "coursereview"];

test("首页论坛流排除二手和公告", () => {
  assert.deepEqual(selectHomeFeedBoardTypes(boardTypes, "forum"), ["normal", "question", "coursereview"]);
});

test("首页二手流只保留二手板块", () => {
  assert.deepEqual(selectHomeFeedBoardTypes(boardTypes, "market"), ["market"]);
});

test("首页全量流仍排除公告", () => {
  assert.deepEqual(selectHomeFeedBoardTypes(boardTypes, "all"), ["normal", "question", "market", "coursereview"]);
});

test("首页动态分流参数拒绝未知值", () => {
  assert.equal(parseHomeFeedStream(" MARKET "), "market");
  assert.throws(() => parseHomeFeedStream("second-hand"), /首页动态分流参数无效/);
});
