import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ACCOUNT_VERIFICATION_SUBMISSION_LIMIT,
  ACCOUNT_VERIFICATION_SOURCES,
  ACCOUNT_VERIFICATION_TYPES,
  accountVerificationSubmissionBlock,
  accountVerificationWindowStart,
  buildAccountVerification,
  normalizedVerificationExpiry,
} from "../src/services/accountVerification";

const routeSource = readFileSync(new URL("../src/routes/accountVerification.ts", import.meta.url), "utf8");

test("only organization accounts can use the verification workflow", () => {
  assert.deepEqual(ACCOUNT_VERIFICATION_TYPES, ["campus_organization"]);
  assert.deepEqual(ACCOUNT_VERIFICATION_SOURCES, ["user_application", "admin_grant"]);
});

test("direct organization grants stay admin-only and auditable", () => {
  assert.match(routeSource, /accountVerificationAdminRouter\.post\(\s*"\/grant",\s*adminOnly,/);
  assert.match(routeSource, /source:\s*"admin_grant"/);
  assert.match(routeSource, /不能为自己的账号主动添加认证/);
  assert.match(routeSource, /source:\s*"user_application",\s*createdAt/);
});

test("builds an active public organization verification", () => {
  const verification = buildAccountVerification({
    verificationType: "campus_organization",
    verificationLabel: "中国药科大学轮滑协会",
    verificationVerifiedAt: "2026-09-01T00:00:00.000Z",
  }, new Date("2026-09-04T00:00:00.000Z"));
  assert.deepEqual(verification, {
    type: "campus_organization",
    typeLabel: "组织认证",
    label: "中国药科大学轮滑协会",
    verifiedAt: "2026-09-01T00:00:00.000Z",
    expiresAt: null,
  });
});

test("hides incomplete, unsupported, or expired verification data", () => {
  const now = new Date("2026-09-04T00:00:00.000Z");
  assert.equal(buildAccountVerification({ verificationType: "campus_organization", verificationLabel: "社团" }, now), null);
  assert.equal(buildAccountVerification({
    verificationType: "faculty_staff",
    verificationLabel: "教师",
    verificationVerifiedAt: "2026-09-01T00:00:00.000Z",
  }, now), null);
  assert.equal(buildAccountVerification({
    verificationType: "campus_organization",
    verificationLabel: "已到期社团",
    verificationVerifiedAt: "2026-08-01T00:00:00.000Z",
    verificationExpiresAt: "2026-09-03T23:59:59.000Z",
  }, now), null);
});

test("blocks duplicate pending applications and limits repeated submissions", () => {
  assert.equal(accountVerificationSubmissionBlock({ hasPending: true, recentSubmissionCount: 0 }), "已有认证申请正在审核，请勿重复提交");
  assert.equal(
    accountVerificationSubmissionBlock({ hasPending: false, recentSubmissionCount: ACCOUNT_VERIFICATION_SUBMISSION_LIMIT }),
    "30 天内最多提交 3 次认证申请",
  );
  assert.equal(accountVerificationSubmissionBlock({ hasPending: false, recentSubmissionCount: 2 }), "");
});

test("uses a rolling 30 day submission window", () => {
  const now = new Date("2026-09-04T12:30:00.000Z");
  assert.equal(accountVerificationWindowStart(now).toISOString(), "2026-08-05T12:30:00.000Z");
});

test("requires an optional expiry to be in the future", () => {
  const now = new Date("2026-09-04T00:00:00.000Z");
  assert.equal(normalizedVerificationExpiry(null, now), null);
  assert.equal(normalizedVerificationExpiry("2027-09-04T00:00:00.000Z", now)?.toISOString(), "2027-09-04T00:00:00.000Z");
  assert.equal(normalizedVerificationExpiry("2027-09-04", now)?.toISOString(), "2027-09-04T15:59:59.999Z");
  assert.throws(() => normalizedVerificationExpiry("invalid", now), /格式不正确/);
  assert.throws(() => normalizedVerificationExpiry("2027-02-31", now), /格式不正确/);
  assert.throws(() => normalizedVerificationExpiry("2026-09-03T00:00:00.000Z", now), /晚于当前时间/);
});
