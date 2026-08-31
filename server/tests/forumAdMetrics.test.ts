import assert from "node:assert/strict";
import test from "node:test";
import {
  FORUM_AD_PLACEMENTS,
  forumAdMetricDay,
  isForumAdPlacement,
  normalizeForumAdPlacements,
  normalizeForumAdVipExempt,
  summarizeForumAdMetrics,
} from "../src/services/forumAds";

test("supports a dedicated mobile home placement and normalizes multiple placements", () => {
  assert.equal(isForumAdPlacement("home-mobile-top"), true);
  assert.ok(FORUM_AD_PLACEMENTS.includes("home-mobile-top"));
  assert.deepEqual(
    normalizeForumAdPlacements(["home-mobile-top", "forum-index-top", "home-mobile-top"]),
    ["home-mobile-top", "forum-index-top"],
  );
  assert.deepEqual(normalizeForumAdPlacements([], "forum-board-top"), ["forum-board-top"]);
  assert.deepEqual(normalizeForumAdPlacements(["unknown"]), []);
});

test("campaign compose placement always reaches every user", () => {
  assert.equal(isForumAdPlacement("compose-mobile-campaign"), true);
  assert.equal(normalizeForumAdVipExempt(["home-mobile-top", "compose-mobile-campaign"], true), false);
  assert.equal(normalizeForumAdVipExempt(["home-mobile-top"], true), true);
});

test("uses the China calendar day for forum ad metrics", () => {
  assert.equal(forumAdMetricDay(new Date("2026-08-29T15:59:59.000Z")), "2026-08-29");
  assert.equal(forumAdMetricDay(new Date("2026-08-29T16:00:00.000Z")), "2026-08-30");
});

test("summarizes forum ad performance by period and device", () => {
  const summary = summarizeForumAdMetrics([
    { day: "2026-08-30", device: "mobile", impressions: 100, clicks: 8 },
    { day: "2026-08-24", device: "desktop", impressions: 50, clicks: 2 },
    { day: "2026-08-01", device: "mobile", impressions: 20, clicks: 1 },
    { day: "2026-07-31", device: "desktop", impressions: 30, clicks: 3 },
  ], new Date("2026-08-30T04:00:00.000Z"));

  assert.deepEqual(summary.all, { impressions: 200, clicks: 14, ctr: 7 });
  assert.deepEqual(summary.last7Days, { impressions: 150, clicks: 10, ctr: 6.67 });
  assert.deepEqual(summary.last30Days, { impressions: 170, clicks: 11, ctr: 6.47 });
  assert.deepEqual(summary.mobile, { impressions: 120, clicks: 9, ctr: 7.5 });
  assert.deepEqual(summary.desktop, { impressions: 80, clicks: 5, ctr: 6.25 });
  assert.deepEqual(summary.daily.map((item) => item.day), ["2026-08-01", "2026-08-24", "2026-08-30"]);
});
