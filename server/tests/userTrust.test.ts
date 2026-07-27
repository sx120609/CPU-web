import assert from "node:assert/strict";
import test from "node:test";
import { computeUserReputationBreakdown } from "../src/services/userTrust.js";

const config = {
  anonymousMinReputation: 30,
  accountAgeDaysPerStep: 14,
  accountAgePointsPerStep: 0,
  accountAgePointsCap: 0,
  postPointsPerTopic: 4,
  postPointsCap: 48,
  replyPointsPerReply: 2,
  replyPointsCap: 48,
  forumEnabledBonus: 6,
  anonymousTiers: [],
  reputationLevels: [{ level: 1, name: "默认", minReputation: 0 }]
};

test("论坛默认开放后不再产生信誉加成", () => {
  const base = {
    createdAt: new Date(),
    postCount: 2,
    replyCount: 3
  };

  const enabled = computeUserReputationBreakdown({
    ...base,
    forumEnabled: true,
    forumEnabledAt: new Date()
  }, config);
  const legacyDisabled = computeUserReputationBreakdown({
    ...base,
    forumEnabled: false,
    forumEnabledAt: null
  }, config);

  assert.equal(enabled.forumPoints, 0);
  assert.equal(enabled.total, 14);
  assert.deepEqual(enabled, legacyDisabled);
});
