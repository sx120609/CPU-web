import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  nicknameReviewRetryDelayMs,
  nicknameReviewRetryDue,
  nicknameSetupRequired,
  normalizeNicknameSubmission,
} from "../src/services/nicknameReview";
import { resolveNicknameReviewPolicy } from "../src/services/topicAiReview";

const workerSource = readFileSync(new URL("../src/services/nicknameReview.ts", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("../src/routes/user.ts", import.meta.url), "utf8");
const adminRouteSource = readFileSync(new URL("../src/routes/admin/index.ts", import.meta.url), "utf8");

test("昵称提交会规范化长度并拒绝不可见控制字符", () => {
  assert.equal(normalizeNicknameSubmission("  药大同学  "), "药大同学");
  assert.equal(normalizeNicknameSubmission("飞行员🪽"), "飞行员🪽");
  assert.throws(() => normalizeNicknameSubmission("药"), /至少 2 个字符/);
  assert.throws(() => normalizeNicknameSubmission(`药大\n同学`), /不可见控制字符/);
  assert.throws(() => normalizeNicknameSubmission("药大\u202E同学"), /不可见控制字符/);
});

test("首次昵称审核中时不重复强制弹窗", () => {
  assert.equal(nicknameSetupRequired({ nickname: "", pendingNickname: "药大同学", nicknameReviewStatus: "checking" }), false);
  assert.equal(nicknameSetupRequired({ nickname: "", pendingNickname: "药大同学", nicknameReviewStatus: "rejected" }), true);
  assert.equal(nicknameSetupRequired({ nickname: "现有昵称", pendingNickname: null, nicknameReviewStatus: "none" }), false);
});

test("昵称高风险分类不能被偏低总分掩盖，缺失判定会失败关闭", () => {
  const result = resolveNicknameReviewPolicy({
    risk_score: 8,
    risk_level: "low",
    decision: "auto_pass",
    categories: { official_impersonation: 94 },
  }, 70);
  assert.equal(result.decision, "block");
  assert.equal(result.riskScore, 94);
  assert.throws(() => resolveNicknameReviewPolicy({ reason: "missing" }, 70), /缺少有效判定/);
});

test("昵称审核故障使用有界退避并保持异步", () => {
  const reviewedAt = new Date("2026-09-04T00:00:00.000Z");
  assert.equal(nicknameReviewRetryDelayMs(1), 30_000);
  assert.equal(nicknameReviewRetryDelayMs(99), 15 * 60_000);
  assert.equal(nicknameReviewRetryDue("[attempt:2] timeout", reviewedAt, reviewedAt.getTime() + 59_000), false);
  assert.equal(nicknameReviewRetryDue("[attempt:2] timeout", reviewedAt, reviewedAt.getTime() + 60_000), true);
  assert.match(routeSource, /scheduleNicknameReview\(u\.id\)/);
});

test("审核结果按昵称和提交时间快照提交，旧结果不能覆盖新昵称", () => {
  assert.match(workerSource, /pendingNickname: snapshot\.pendingNickname,[\s\S]*nicknameReviewRequestedAt: snapshot\.requestedAt/);
  assert.match(workerSource, /approved \? \{ nickname: snapshot\.pendingNickname, pendingNickname: null \} : \{\}/);
  assert.match(workerSource, /nicknameReviewStatus: approved \? "approved" : "rejected"/);
  assert.match(adminRouteSource, /nickname: req\.body\.nickname,[\s\S]*pendingNickname: null,[\s\S]*nicknameReviewStatus: "none"/);
});
