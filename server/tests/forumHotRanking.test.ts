import assert from "node:assert/strict";
import test from "node:test";
import {
  computeHotScore,
  hotTopicPublicationTier,
  rankHotTopics,
} from "../src/services/forumHotRanking";

const NOW = new Date("2026-09-03T01:00:00.000Z").getTime();
const hoursAgo = (hours: number) => new Date(NOW - hours * 60 * 60 * 1000);

function topic(id: number, hours: number, views: number, replies = 0, likes = 0) {
  return {
    id,
    createdAt: hoursAgo(hours),
    lastReplyAt: hoursAgo(0.1),
    viewCount: views,
    replyCount: replies,
    likeCount: likes,
  };
}

test("a new reply cannot move an old topic back into the hot ranking", () => {
  const bumpedOldTopic = topic(1, 8 * 24, 50_000, 100, 100);
  assert.equal(hotTopicPublicationTier(bumpedOldTopic, NOW), 2);
  assert.deepEqual(rankHotTopics([bumpedOldTopic], 10, NOW), []);
});

test("topics published in the last 24 hours always precede fallback topics", () => {
  const fresh = topic(2, 2, 100);
  const fallback = topic(3, 25, 50_000, 100, 100);
  assert.deepEqual(rankHotTopics([fallback, fresh], 10, NOW).map(({ id }) => id), [2, 3]);
});

test("publication age decays otherwise equal interaction scores", () => {
  const newest = topic(4, 1, 1_000, 5, 5);
  const older = topic(5, 13, 1_000, 5, 5);
  assert.ok(computeHotScore(newest, NOW) > computeHotScore(older, NOW));
  assert.deepEqual(rankHotTopics([older, newest], 10, NOW).map(({ id }) => id), [4, 5]);
});

test("fallback topics are capped at 72 hours and only fill remaining positions", () => {
  const rows = [topic(6, 3, 100), topic(7, 30, 500), topic(8, 71, 700), topic(9, 73, 100_000)];
  assert.deepEqual(rankHotTopics(rows, 3, NOW).map(({ id }) => id), [6, 7, 8]);
  assert.deepEqual(rankHotTopics(rows, 1, NOW).map(({ id }) => id), [6]);
});
