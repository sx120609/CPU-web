#!/usr/bin/env node
// OAuth token 可以长期保存，但 userinfo 必须能用新接口覆盖旧客户端留下的快照。

const assert = require("node:assert/strict");
const path = require("node:path");

const {
  normalizeOAuthUser,
  refreshOAuthUser
} = require(path.join(__dirname, "..", "dist", "electron", "oauth-user.js"));

const payload = {
  code: 0,
  data: {
    sub: "42",
    user: {
      id: 42,
      nickname: "Carbene",
      reputation: 278,
      reputationBreakdown: {
        agePoints: 60,
        postPoints: 80,
        replyPoints: 90,
        forumPoints: 48
      },
      reputationLevel: {
        level: 5,
        name: "校园传说",
        nextLevel: null
      }
    },
    level: 5,
    levelName: "校园传说",
    aiBalance: 6300,
    dailyQuota: 200,
    usedToday: 0,
    dailyRemaining: 200,
    assistantPoints: 6100
  }
};

const user = normalizeOAuthUser(payload);
assert.equal(user.reputation, 278);
assert.equal(user.assistantPoints, 6100);
assert.equal(user.dailyRemaining, 200);
assert.equal(user.usedToday, 0, "数值 0 不能被当作缺失字段");

const session = {
  accessToken: "test",
  tokenType: "Bearer",
  expiresAt: Date.now() + 60_000,
  scope: "openid profile ai",
  user: { user: "Carbene", aiBalance: 6300 }
};
let persisted;

refreshOAuthUser(
  session,
  async () => user,
  async (next) => { persisted = structuredClone(next); }
).then((refreshed) => {
  assert.equal(refreshed.assistantPoints, 6100);
  assert.equal(session.user.reputation, 278, "新 userinfo 应覆盖旧快照");
  assert.equal(persisted.user.assistantPoints, 6100, "补全后的快照应写回安全存储");
  console.log("OAuth 用户资料检查通过：旧快照会被最新信誉值与 AI 点数覆盖。");
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
