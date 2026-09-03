import assert from "node:assert/strict";
import test from "node:test";
import { anonymousTiersPatchSchema } from "../src/routes/admin/siteConfigValidation.js";
import { buildAnonymousPolicyUpgrade } from "../src/services/siteSettings.js";
import { computeAnonymousWeeklyQuota, computeUserReputationBreakdown, createAnonymousAlias, presentAnonymousAlias } from "../src/services/userTrust.js";

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

test("匿名身份使用校园趣味昵称并兼容旧昵称", () => {
  const created = createAnonymousAlias();
  assert.doesNotMatch(created, /^匿名同学\s+[A-Z0-9]{4}$/);
  assert.match(created, /\s(?:🌿|✨|🌙|☁️|🍬|🧪|📚|🐈|🫧|🌸|☕|🪐)$/u);

  const upgraded = presentAnonymousAlias("匿名同学 ABCD");
  assert.equal(upgraded, presentAnonymousAlias("匿名同学 ABCD"));
  assert.doesNotMatch(upgraded, /^匿名同学/);
  assert.equal(presentAnonymousAlias("自定义匿名名"), "自定义匿名名");
});

test("匿名策略允许新用户每周有限参与并保持严格周额度", () => {
  const upgraded = buildAnonymousPolicyUpgrade({
    anonymousMinReputation: 20,
    anonymousTiers: [
      { reputation: 20, quota: 3 },
      { reputation: 60, quota: 5 },
      { reputation: 90, quota: 7 },
      { reputation: 120, quota: 10 },
    ],
  });

  assert.equal(upgraded.anonymousMinReputation, 0);
  assert.deepEqual(upgraded.anonymousTiers, [
    { reputation: 0, quota: 1 },
    { reputation: 20, quota: 3 },
    { reputation: 60, quota: 5 },
    { reputation: 90, quota: 7 },
    { reputation: 120, quota: 10 },
  ]);
  assert.equal(computeAnonymousWeeklyQuota(0, { ...config, ...upgraded }), 1);
  assert.equal(computeAnonymousWeeklyQuota(20, { ...config, ...upgraded }), 3);
});

test("旧默认匿名策略升级到新的渐进式额度", () => {
  const upgraded = buildAnonymousPolicyUpgrade({
    anonymousMinReputation: 30,
    anonymousTiers: [
      { reputation: 30, quota: 1 },
      { reputation: 60, quota: 2 },
      { reputation: 90, quota: 3 },
      { reputation: 120, quota: 4 },
    ],
  });

  assert.deepEqual(upgraded.anonymousTiers, [
    { reputation: 0, quota: 1 },
    { reputation: 30, quota: 2 },
    { reputation: 60, quota: 3 },
    { reputation: 90, quota: 4 },
    { reputation: 120, quota: 5 },
  ]);
});

test("后台允许保存五档匿名额度规则", () => {
  const fiveTiers = [
    { reputation: 0, quota: 2 },
    { reputation: 20, quota: 5 },
    { reputation: 60, quota: 8 },
    { reputation: 90, quota: 12 },
    { reputation: 120, quota: 16 },
  ];

  assert.equal(anonymousTiersPatchSchema.safeParse(fiveTiers).success, true);
  assert.equal(anonymousTiersPatchSchema.safeParse(fiveTiers.slice(1)).success, false);
});
