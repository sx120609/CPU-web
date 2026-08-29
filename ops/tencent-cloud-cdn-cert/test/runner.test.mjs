import assert from "node:assert/strict";
import test from "node:test";
import { runAutomation } from "../src/runner.mjs";

const NOW = new Date("2026-01-10T00:00:00Z");
const OLD_END = "2026-01-20 08:00:00";
const NEW_END = "2026-04-20 08:00:00";

function domainConfig(overrides = {}) {
  return {
    domain: "img.cputime.cn",
    enabled: true,
    expectedCdnResourceId: "cdn-2o4qgm9j",
    expectedHttpsBillingSwitch: "on",
    renewBeforeDays: 30,
    minimumValidityGainDays: 30,
    pollIntervalSeconds: 0.001,
    issuanceTimeoutMinutes: 1,
    deploymentTimeoutMinutes: 1,
    tlsVerifyAttempts: 1,
    tlsVerifyIntervalSeconds: 0.001,
    apiMaxAttempts: 1,
    apiRetryBaseMs: 1,
    ...overrides,
  };
}

function current(certificateId = "old-cert", expireTime = OLD_END) {
  return {
    domain: "img.cputime.cn",
    resourceId: "cdn-2o4qgm9j",
    status: "online",
    httpsSwitch: "on",
    httpsBillingSwitch: "on",
    certificateId,
    certificateExpireTime: expireTime,
  };
}

function live(validTo = "Jan 20 00:00:00 2026 GMT") {
  return {
    authorized: true,
    subject: { CN: "img.cputime.cn" },
    subjectAltName: "DNS:img.cputime.cn",
    validTo,
    fingerprint256: "AA:BB",
  };
}

function logger() {
  const records = [];
  return {
    records,
    info: (event, fields) => records.push({ level: "info", event, ...fields }),
    warn: (event, fields) => records.push({ level: "warn", event, ...fields }),
    error: (event, fields) => records.push({ level: "error", event, ...fields }),
  };
}

function memoryStateStore(initial = { version: 1, domains: {} }) {
  let value = structuredClone(initial);
  return {
    load: async () => structuredClone(value),
    save: async (next) => { value = structuredClone(next); },
    value: () => structuredClone(value),
  };
}

test("default dry-run performs read-only checks and never applies or deploys", async () => {
  const calls = [];
  const gateway = {
    describeCdnDomain: async () => { calls.push("describeCdnDomain"); return current(); },
    listCertificates: async () => { calls.push("listCertificates"); return []; },
    applyFreeCertificate: async () => { calls.push("applyFreeCertificate"); throw new Error("must not run"); },
    deployCertificate: async () => { calls.push("deployCertificate"); throw new Error("must not run"); },
  };
  const result = await runAutomation({
    config: { domains: [domainConfig()] },
    gateway,
    tlsReader: async () => live(),
    logger: logger(),
    execute: false,
    now: () => NOW,
  });
  assert.equal(result[0].ok, true);
  assert.equal(result[0].action, "dry-run");
  assert.equal(calls.includes("applyFreeCertificate"), false);
  assert.equal(calls.includes("deployCertificate"), false);
});

test("a completed prior cycle is not mistaken for the next renewal candidate", async () => {
  let applied = 0;
  const gateway = {
    describeCdnDomain: async () => current("previous-cert", OLD_END),
    listCertificates: async () => [],
    applyFreeCertificate: async () => { applied += 1; return { CertificateId: "next-cert" }; },
    describeCertificate: async () => ({ CertificateId: "next-cert", Status: 2, Domain: "img.cputime.cn" }),
  };
  const store = memoryStateStore({
    version: 1,
    domains: {
      "img.cputime.cn": {
        phase: "completed",
        oldCertificateId: "ancient-cert",
        oldExpireTime: "2025-10-01 08:00:00",
        candidateCertificateId: "previous-cert",
        currentCertificateId: "previous-cert",
        currentExpireTime: OLD_END,
      },
    },
  });
  const result = await runAutomation({
    config: { domains: [domainConfig()] },
    gateway,
    tlsReader: async () => live(),
    logger: logger(),
    execute: true,
    stateStore: store,
    sleep: async () => {},
    now: () => NOW,
  });
  assert.equal(applied, 1);
  assert.equal(result[0].ok, false);
  assert.equal(store.value().domains["img.cputime.cn"].candidateCertificateId, "next-cert");
});

test("execute requests, polls, deploys, and independently verifies a new certificate", async () => {
  const calls = [];
  let deployed = false;
  const gateway = {
    describeCdnDomain: async () => current(deployed ? "new-cert" : "old-cert", deployed ? NEW_END : OLD_END),
    listCertificates: async () => [],
    applyFreeCertificate: async () => { calls.push("apply"); return { CertificateId: "new-cert", RequestId: "apply-request" }; },
    describeCertificate: async () => ({
      CertificateId: "new-cert",
      Status: 1,
      Domain: "img.cputime.cn",
      SubjectAltName: ["img.cputime.cn"],
      CertEndTime: NEW_END,
    }),
    deployCertificate: async (params) => { calls.push(["deploy", params]); deployed = true; return { DeployRecordId: 99, RequestId: "deploy-request" }; },
    describeDeployRecord: async () => ({ TotalCount: 1, SuccessTotalCount: 1, FailedTotalCount: 0, RunningTotalCount: 0, PendingTotalCount: 0 }),
    rollbackDeploy: async () => { throw new Error("rollback should not run"); },
  };
  let tlsCalls = 0;
  const store = memoryStateStore();
  const result = await runAutomation({
    config: { domains: [domainConfig()] },
    gateway,
    tlsReader: async () => (++tlsCalls === 1 ? live() : live("Apr 20 00:00:00 2026 GMT")),
    logger: logger(),
    execute: true,
    stateStore: store,
    sleep: async () => {},
    now: () => NOW,
  });
  assert.equal(result[0].ok, true);
  assert.equal(result[0].action, "renewed");
  assert.equal(calls[0], "apply");
  assert.deepEqual(calls[1], ["deploy", { certificateId: "new-cert", domain: "img.cputime.cn", httpsBillingSwitch: "on" }]);
  assert.equal(store.value().domains["img.cputime.cn"].phase, "completed");
});

test("failed post-deploy verification rolls the successful deployment back", async () => {
  let deployed = false;
  let rolledBack = false;
  const gateway = {
    describeCdnDomain: async () => current(deployed && !rolledBack ? "new-cert" : "old-cert", deployed && !rolledBack ? NEW_END : OLD_END),
    listCertificates: async () => [],
    applyFreeCertificate: async () => ({ CertificateId: "new-cert" }),
    describeCertificate: async () => ({ CertificateId: "new-cert", Status: 1, Domain: "img.cputime.cn", SubjectAltName: ["img.cputime.cn"], CertEndTime: NEW_END }),
    deployCertificate: async () => { deployed = true; return { DeployRecordId: 99 }; },
    describeDeployRecord: async () => ({ TotalCount: 1, SuccessTotalCount: 1, FailedTotalCount: 0, RunningTotalCount: 0, PendingTotalCount: 0 }),
    rollbackDeploy: async (recordId) => { assert.equal(recordId, 99); rolledBack = true; return { DeployRecordId: 100 }; },
  };
  let tlsCalls = 0;
  const store = memoryStateStore();
  const result = await runAutomation({
    config: { domains: [domainConfig()] },
    gateway,
    tlsReader: async () => { tlsCalls += 1; return live(); },
    logger: logger(),
    execute: true,
    stateStore: store,
    sleep: async () => {},
    now: () => NOW,
  });
  assert.equal(result[0].ok, false);
  assert.equal(rolledBack, true);
  assert.equal(tlsCalls, 3);
  assert.equal(store.value().domains["img.cputime.cn"].phase, "rolled_back");
});

test("an interrupted deploy is verified even when the new certificate is no longer near expiry", async () => {
  let currentCertificate = "new-cert";
  let redeploys = 0;
  const gateway = {
    describeCdnDomain: async () => current(currentCertificate, currentCertificate === "new-cert" ? NEW_END : OLD_END),
    describeCertificate: async () => ({ CertificateId: "new-cert", Status: 1, Domain: "img.cputime.cn", SubjectAltName: ["img.cputime.cn"], CertEndTime: NEW_END }),
    deployCertificate: async ({ certificateId }) => {
      assert.equal(certificateId, "old-cert");
      redeploys += 1;
      currentCertificate = "old-cert";
      return { DeployRecordId: 100 };
    },
    describeDeployRecord: async () => ({ TotalCount: 1, SuccessTotalCount: 1, FailedTotalCount: 0, RunningTotalCount: 0, PendingTotalCount: 0 }),
  };
  let tlsCalls = 0;
  const store = memoryStateStore({
    version: 1,
    domains: {
      "img.cputime.cn": {
        phase: "deploy_requested",
        oldCertificateId: "old-cert",
        oldExpireTime: OLD_END,
        candidateCertificateId: "new-cert",
        candidateExpireTime: NEW_END,
      },
    },
  });
  const result = await runAutomation({
    config: { domains: [domainConfig()] },
    gateway,
    tlsReader: async () => { tlsCalls += 1; return live(); },
    logger: logger(),
    execute: true,
    stateStore: store,
    sleep: async () => {},
    now: () => NOW,
  });
  assert.equal(result[0].ok, false);
  assert.equal(redeploys, 1);
  assert.equal(tlsCalls, 3);
  assert.equal(store.value().domains["img.cputime.cn"].phase, "rolled_back");
});
