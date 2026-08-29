import assert from "node:assert/strict";
import test from "node:test";
import {
  certificateCoversDomain,
  classifyCertificateStatus,
  classifyDeploymentStatus,
  findReusableCertificate,
  pollState,
  sanitizeLogValue,
  shouldRenew,
  validateCandidateCertificate,
  validateLiveCertificate,
  withRetry,
} from "../src/core.mjs";

test("renewal threshold is inclusive and configurable", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  assert.equal(shouldRenew("2026-01-31T00:00:00Z", 30, now), true);
  assert.equal(shouldRenew("2026-01-31T00:00:01Z", 30, now), false);
  assert.equal(shouldRenew("2026-01-10T00:00:00Z", 15, now), true);
});

test("certificate domain checks use exact or one-label wildcard coverage", () => {
  assert.equal(certificateCoversDomain({ SubjectAltName: ["img.cputime.cn"] }, "img.cputime.cn"), true);
  assert.equal(certificateCoversDomain({ SubjectAltName: ["*.cputime.cn"] }, "img.cputime.cn"), true);
  assert.equal(certificateCoversDomain({ SubjectAltName: ["*.cputime.cn"] }, "a.img.cputime.cn"), false);
  assert.equal(certificateCoversDomain({ SubjectAltName: ["cputime.cn"] }, "img.cputime.cn"), false);
});

test("certificate and deployment polling states fail closed", () => {
  assert.equal(classifyCertificateStatus({ Status: 1 }), "issued");
  assert.equal(classifyCertificateStatus({ Status: 4 }), "pending");
  assert.equal(classifyCertificateStatus({ Status: 2 }), "failed");
  assert.equal(classifyCertificateStatus({ Status: 99 }), "unknown");
  assert.equal(classifyDeploymentStatus({ TotalCount: 1, SuccessTotalCount: 1, FailedTotalCount: 0, RunningTotalCount: 0, PendingTotalCount: 0 }), "succeeded");
  assert.equal(classifyDeploymentStatus({ TotalCount: 1, SuccessTotalCount: 0, FailedTotalCount: 0, RunningTotalCount: 1, PendingTotalCount: 0 }), "pending");
  assert.equal(classifyDeploymentStatus({ TotalCount: 1, SuccessTotalCount: 0, FailedTotalCount: 1, RunningTotalCount: 0, PendingTotalCount: 0 }), "failed");
});

test("candidate validation requires domain coverage and a meaningful validity gain", () => {
  const certificate = {
    CertificateId: "new-cert",
    Status: 1,
    Domain: "img.cputime.cn",
    SubjectAltName: ["img.cputime.cn"],
    CertEndTime: "2026-05-01 08:00:00",
  };
  assert.equal(validateCandidateCertificate(certificate, {
    domain: "img.cputime.cn",
    oldExpireTime: "2026-02-01 08:00:00",
    minimumValidityGainDays: 30,
  }), certificate);
  assert.throws(() => validateCandidateCertificate({ ...certificate, Domain: "other.example", SubjectAltName: [] }, {
    domain: "img.cputime.cn",
    oldExpireTime: "2026-02-01 08:00:00",
    minimumValidityGainDays: 30,
  }), /does not cover/);
  assert.throws(() => validateCandidateCertificate({ ...certificate, CertEndTime: "2026-02-15 08:00:00" }, {
    domain: "img.cputime.cn",
    oldExpireTime: "2026-02-01 08:00:00",
    minimumValidityGainDays: 30,
  }), /does not extend/);
});

test("post-deployment TLS validation checks trust, hostname, and expiry", () => {
  const live = {
    authorized: true,
    subject: { CN: "img.cputime.cn" },
    subjectAltName: "DNS:img.cputime.cn",
    validTo: "May  1 00:00:00 2026 GMT",
  };
  assert.equal(validateLiveCertificate(live, {
    domain: "img.cputime.cn",
    oldExpireTime: "2026-02-01T00:00:00Z",
    candidateExpireTime: "2026-05-01T00:00:00Z",
    minimumValidityGainDays: 30,
  }), live);
  assert.throws(() => validateLiveCertificate({ ...live, subjectAltName: "DNS:other.example", subject: { CN: "other.example" } }, {
    domain: "img.cputime.cn",
    oldExpireTime: "2026-02-01T00:00:00Z",
    candidateExpireTime: "2026-05-01T00:00:00Z",
    minimumValidityGainDays: 30,
  }), /not cert's CN|not in the cert's altnames/);
});

test("idempotency reuses only recent pending or better issued exact-domain certificates", () => {
  const reusable = findReusableCertificate([
    { CertificateId: "current", Status: 1, Domain: "img.cputime.cn", CertEndTime: "2026-02-01 08:00:00", InsertTime: "2025-12-01 08:00:00" },
    { CertificateId: "stale", Status: 0, Domain: "img.cputime.cn", InsertTime: "2025-12-01 08:00:00" },
    { CertificateId: "pending", Status: 4, Domain: "img.cputime.cn", InsertTime: "2026-01-01 08:00:00" },
  ], {
    domain: "img.cputime.cn",
    currentCertificateId: "current",
    oldExpireTime: "2026-02-01 08:00:00",
    minimumValidityGainDays: 30,
    now: new Date("2026-01-02T00:00:00Z"),
  });
  assert.equal(reusable.CertificateId, "pending");
});

test("API retries only transient failures with exponential backoff", async () => {
  let calls = 0;
  const delays = [];
  const result = await withRetry(async () => {
    calls += 1;
    if (calls < 3) throw Object.assign(new Error("busy"), { code: "InternalError" });
    return "ok";
  }, {
    attempts: 4,
    baseDelayMs: 10,
    sleep: async (delay) => delays.push(delay),
  });
  assert.equal(result, "ok");
  assert.deepEqual(delays, [10, 20]);
});

test("polling state machine stops on success and timeout", async () => {
  const values = [{ Status: 0 }, { Status: 4 }, { Status: 1 }];
  const result = await pollState(async () => values.shift(), classifyCertificateStatus, {
    timeoutMs: 10,
    intervalMs: 1,
    sleep: async () => {},
    now: (() => { let tick = 0; return () => tick++; })(),
  });
  assert.equal(result.Status, 1);
});

test("structured logs redact credential-like keys and known values", () => {
  const result = sanitizeLogValue({
    SecretId: "dummy-secret-id",
    nested: { message: "key=super-secret" },
  }, ["super-secret"]);
  assert.equal(result.SecretId, "***");
  assert.equal(result.nested.message.includes("super-secret"), false);
});
