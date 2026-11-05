import assert from "node:assert/strict";
import test from "node:test";
import { signToken } from "../src/utils/jwt";
import {
  RECOVERY_WINDOW_MS,
  jwxtRecoveryKeyForUser,
  jwxtRecoveryPersonKey,
  jwxtRecoveryStats,
  noteJwxtAuthExpired,
  noteJwxtLoginOutcome,
  resetJwxtRecoveryStats,
  schoolLoginFailureOutcome,
} from "../src/services/jwxtRecoveryStats";

const T0 = Date.UTC(2026, 10, 5, 4);

test("an expiry followed by a school login counts as recovered, once per person", () => {
  resetJwxtRecoveryStats();
  const alice = jwxtRecoveryKeyForUser(1);
  // 课表、身份、校历同时 401，只算一次失效。
  noteJwxtAuthExpired(alice, T0);
  noteJwxtAuthExpired(alice, T0 + 100);
  noteJwxtAuthExpired(alice, T0 + 200);
  noteJwxtLoginOutcome(alice, "ok", T0 + 4_000);

  const stats = jwxtRecoveryStats(T0 + 5_000);
  assert.equal(stats.people, 1);
  assert.equal(stats.episodes, 1);
  assert.equal(stats.recovered, 1);
  assert.equal(stats.unrecovered, 0);
  assert.equal(stats.pending, 0);
  assert.equal(stats.recoveryDelays.under10s, 1);
});

test("an expiry with no successful login settles as unrecovered with the last reason", () => {
  resetJwxtRecoveryStats();
  const bob = jwxtRecoveryKeyForUser(2);
  const carol = jwxtRecoveryKeyForUser(3);
  const dave = jwxtRecoveryKeyForUser(4);
  noteJwxtAuthExpired(bob, T0);
  noteJwxtLoginOutcome(bob, "failed", T0 + 1_000);
  noteJwxtLoginOutcome(bob, "captcha", T0 + 2_000);
  noteJwxtAuthExpired(carol, T0);
  noteJwxtAuthExpired(dave, T0);

  const during = jwxtRecoveryStats(T0 + 60_000);
  assert.equal(during.pending, 3);
  assert.equal(during.unrecovered, 0);

  const after = jwxtRecoveryStats(T0 + RECOVERY_WINDOW_MS + 1);
  assert.equal(after.pending, 0);
  assert.equal(after.unrecovered, 3);
  assert.equal(after.unrecoveredReasons.captcha, 1);
  assert.equal(after.unrecoveredReasons.noAttempt, 2);
  assert.equal(after.loginAttempts, 2);
});

test("a login after the window does not turn an old expiry into a recovery", () => {
  resetJwxtRecoveryStats();
  const erin = jwxtRecoveryKeyForUser(5);
  noteJwxtAuthExpired(erin, T0);
  noteJwxtLoginOutcome(erin, "ok", T0 + RECOVERY_WINDOW_MS + 1);
  const stats = jwxtRecoveryStats(T0 + RECOVERY_WINDOW_MS + 2);
  assert.equal(stats.recovered, 0);
  assert.equal(stats.unrecovered, 1);
});

test("ordinary logins without an expiry are ignored, and a later expiry opens a new episode", () => {
  resetJwxtRecoveryStats();
  const frank = jwxtRecoveryKeyForUser(6);
  noteJwxtLoginOutcome(frank, "ok", T0);
  assert.equal(jwxtRecoveryStats(T0 + 1).episodes, 0);

  noteJwxtAuthExpired(frank, T0 + 1_000);
  noteJwxtLoginOutcome(frank, "ok", T0 + 2_000);
  noteJwxtAuthExpired(frank, T0 + 3_000);
  const stats = jwxtRecoveryStats(T0 + 4_000);
  assert.equal(stats.episodes, 2);
  assert.equal(stats.recovered, 1);
  assert.equal(stats.pending, 1);
  assert.equal(stats.people, 1);
});

test("stats forget everything older than a day", () => {
  resetJwxtRecoveryStats();
  noteJwxtAuthExpired(jwxtRecoveryKeyForUser(7), T0);
  const later = jwxtRecoveryStats(T0 + 25 * 60 * 60 * 1000);
  assert.equal(later.episodes, 0);
  assert.equal(later.unrecovered, 0);
  assert.equal(later.people, 0);
});

test("people are recognised by their site sign-in, not by the school session", () => {
  const token = signToken({ userId: 42, studentId: "2020000001", role: "user", campus: "" });
  assert.equal(jwxtRecoveryPersonKey({ headers: {}, browserSession: { siteToken: token } }), "u:42");
  assert.equal(jwxtRecoveryPersonKey({ headers: { authorization: `Bearer ${token}` } }), "u:42");
  assert.equal(jwxtRecoveryPersonKey({ headers: { authorization: "Bearer not-a-real-token-at-all" } }), "");
  assert.equal(jwxtRecoveryPersonKey({ headers: {} }), "");
});

test("failed school logins are labelled by what the school asked for", () => {
  assert.equal(schoolLoginFailureOutcome({ needMfa: true, needCaptcha: true }), "mfa");
  assert.equal(schoolLoginFailureOutcome({ needCaptcha: true }), "captcha");
  assert.equal(schoolLoginFailureOutcome({}), "failed");
});
