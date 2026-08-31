import assert from "node:assert/strict";
import test from "node:test";
import {
  CAMPUS_LIFE_ACTIVITY,
  CAMPUS_LIFE_ACTIVITY_ID,
  CAMPUS_LIFE_ACTIVITY_THEMES,
  campusLifeActivityPostUrl,
  resolveCampusLifeActivityTheme,
} from "../src/utils/forumActivity";

test("builds four scoped campaign compose actions", () => {
  assert.deepEqual(CAMPUS_LIFE_ACTIVITY_THEMES.map((item) => item.label), [
    "食堂测评",
    "周边店铺",
    "今日校园",
    "日常趣事",
  ]);
  const url = new URL(campusLifeActivityPostUrl(CAMPUS_LIFE_ACTIVITY_THEMES[0]), "https://cputime.cn");
  assert.equal(url.pathname, "/post");
  assert.equal(url.searchParams.get("board"), "life");
  assert.equal(url.searchParams.get("activity"), CAMPUS_LIFE_ACTIVITY_ID);
  assert.equal(url.searchParams.get("theme"), "canteen");
});

test("accepts only known campaign themes and keeps the promised judging rules", () => {
  assert.equal(resolveCampusLifeActivityTheme(CAMPUS_LIFE_ACTIVITY_ID, "today")?.label, "今日校园");
  assert.equal(resolveCampusLifeActivityTheme("other", "today"), null);
  assert.equal(resolveCampusLifeActivityTheme(CAMPUS_LIFE_ACTIVITY_ID, "unknown"), null);
  assert.match(CAMPUS_LIFE_ACTIVITY.judging, /点赞数、回复数与内容质量/);
  assert.match(CAMPUS_LIFE_ACTIVITY.judging, /拾间大模型和论坛管理员/);
  assert.match(CAMPUS_LIFE_ACTIVITY.judging, /回复奖与投稿奖不可兼得/);
  assert.match(CAMPUS_LIFE_ACTIVITY.funding, /用户的暖心赞助/);
  assert.match(CAMPUS_LIFE_ACTIVITY.funding, /10份以上 VIP 权限/);
  assert.match(CAMPUS_LIFE_ACTIVITY.funding, /只多不少/);
});
