import {
  DAY_MS,
  certificateCoversDomain,
  classifyCertificateStatus,
  classifyDeploymentStatus,
  findReusableCertificate,
  parseCloudTime,
  pollState,
  remainingDays,
  shouldRenew,
  validateCandidateCertificate,
  validateCurrentCdnDomain,
  validateLiveCertificate,
  withRetry,
} from "./core.mjs";

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function validateCurrentLive(live, current, domain) {
  if (!live?.authorized) throw new Error(`Current live TLS certificate is not trusted for ${domain}`);
  if (!certificateCoversDomain({ Domain: live.subject?.CN, SubjectAltName: parseSubjectAltName(live.subjectAltName) }, domain)) {
    throw new Error(`Current live TLS certificate does not cover ${domain}`);
  }
  const liveEnd = parseCloudTime(live.validTo).getTime();
  const apiEnd = parseCloudTime(current.certificateExpireTime).getTime();
  if (Math.abs(liveEnd - apiEnd) > DAY_MS) {
    throw new Error(`Current live TLS expiry disagrees with CDN configuration for ${domain}`);
  }
}

function parseSubjectAltName(value) {
  if (!value) return [];
  return String(value).split(/,\s*/).map((entry) => entry.replace(/^DNS:/i, "").trim()).filter(Boolean);
}

function publicCurrent(current) {
  return {
    resourceId: current.resourceId,
    status: current.status,
    httpsSwitch: current.httpsSwitch,
    httpsBillingSwitch: current.httpsBillingSwitch,
    certificateId: current.certificateId,
    certificateExpireTime: current.certificateExpireTime,
  };
}

export async function runAutomation({
  config,
  gateway,
  tlsReader,
  logger,
  execute = false,
  stateStore,
  sleep = wait,
  now = () => new Date(),
}) {
  let state = stateStore ? await stateStore.load() : { version: 1, domains: {} };
  const results = [];
  const saveDomainState = async (domain, patch) => {
    state.domains[domain] = {
      ...(state.domains[domain] ?? {}),
      ...patch,
      updatedAt: now().toISOString(),
    };
    if (execute) await stateStore.save(state);
    return state.domains[domain];
  };

  for (const domainConfig of config.domains.filter((entry) => entry.enabled)) {
    try {
      const result = await runDomain({
        domainConfig,
        gateway,
        tlsReader,
        logger,
        execute,
        state: state.domains[domainConfig.domain],
        saveState: (patch) => saveDomainState(domainConfig.domain, patch),
        sleep,
        now,
      });
      results.push({ domain: domainConfig.domain, ok: true, ...result });
    } catch (error) {
      logger.error("domain_failed", {
        domain: domainConfig.domain,
        error: error.message,
        code: error.code,
      });
      results.push({ domain: domainConfig.domain, ok: false, error: error.message });
    }
  }
  return results;
}

async function runDomain({ domainConfig, gateway, tlsReader, logger, execute, state, saveState, sleep, now }) {
  const domain = domainConfig.domain;
  const activeState = ["waiting_certificate", "certificate_issued", "deploy_requested", "deploying", "verifying"].includes(state?.phase)
    ? state
    : undefined;
  const retry = (name, operation) => withRetry(operation, {
    attempts: domainConfig.apiMaxAttempts,
    baseDelayMs: domainConfig.apiRetryBaseMs,
    sleep,
    onRetry: ({ attempt, delayMs, code }) => logger.warn("api_retry", { domain, api: name, attempt, delayMs, code }),
  });
  const describeCurrent = async () => validateCurrentCdnDomain(
    await retry("DescribeDomainsConfig", () => gateway.describeCdnDomain(domain)),
    domainConfig,
  );

  const current = await describeCurrent();
  let currentLive;
  try {
    currentLive = await tlsReader(domain);
    validateCurrentLive(currentLive, current, domain);
  } catch (error) {
    const cloudMayHaveSwitched = state?.phase === "rollback"
      || (["deploy_requested", "deploying", "verifying"].includes(state?.phase)
        && current.certificateId !== state?.oldCertificateId);
    if (!cloudMayHaveSwitched) throw error;
    logger.warn("recovery_preflight_tls_mismatch", { domain, phase: state.phase, error: error.message });
  }
  const daysLeft = remainingDays(current.certificateExpireTime, now());
  logger.info("cdn_certificate_checked", {
    domain,
    dryRun: !execute,
    remainingDays: Number(daysLeft.toFixed(3)),
    renewBeforeDays: domainConfig.renewBeforeDays,
    current: publicCurrent(current),
    live: currentLive ? {
      validTo: currentLive.validTo,
      fingerprint256: currentLive.fingerprint256,
    } : undefined,
  });

  if (state?.phase === "rollback") {
    await finishRollback({ state, domainConfig, gateway, tlsReader, retry, logger, saveState, sleep, now });
    throw new Error(`A previous deployment for ${domain} was rolled back; manual review is required`);
  }
  if (["rolled_back", "certificate_failed", "deployment_failed", "rollback_failed"].includes(state?.phase)) {
    throw new Error(`State for ${domain} is ${state.phase}; manual review is required before another certificate attempt`);
  }

  if (!activeState && !shouldRenew(current.certificateExpireTime, domainConfig.renewBeforeDays, now())) {
    await saveState({
      phase: "healthy",
      currentCertificateId: current.certificateId,
      currentExpireTime: current.certificateExpireTime,
      lastCheckedAt: now().toISOString(),
    });
    logger.info("renewal_not_due", { domain, dryRun: !execute, remainingDays: Number(daysLeft.toFixed(3)) });
    return { action: "skipped", remainingDays: daysLeft };
  }

  const oldCertificateId = activeState?.oldCertificateId ?? current.certificateId;
  const oldExpireTime = activeState?.oldExpireTime ?? current.certificateExpireTime;
  let candidateId = activeState?.candidateCertificateId;
  let candidate;

  if (candidateId) {
    candidate = await waitForCertificate({ candidateId, domainConfig, gateway, retry, logger, sleep, now, saveState });
  } else {
    const existing = findReusableCertificate(
      await retry("DescribeCertificates", () => gateway.listCertificates(domain)),
      {
        domain,
        currentCertificateId: current.certificateId,
        oldExpireTime,
        minimumValidityGainDays: domainConfig.minimumValidityGainDays,
        now: now(),
      },
    );

    if (existing) {
      candidateId = existing.CertificateId;
      logger.info("reusable_certificate_found", { domain, certificateId: candidateId, status: existing.Status });
      if (!execute) {
        return { action: "dry-run", plan: "resume-or-deploy-existing-certificate", candidateCertificateId: candidateId };
      }
      await saveState({
        phase: "waiting_certificate",
        oldCertificateId,
        oldExpireTime,
        candidateCertificateId: candidateId,
      });
      candidate = await waitForCertificate({ candidateId, domainConfig, gateway, retry, logger, sleep, now, saveState });
    } else {
      logger.info("renewal_planned", {
        domain,
        dryRun: !execute,
        method: "ApplyCertificate/DNS_AUTO",
        deployTarget: `${domain}|${current.httpsBillingSwitch}`,
      });
      if (!execute) return { action: "dry-run", plan: "apply-free-dns-auto-and-deploy" };

      const applied = await retry("ApplyCertificate", () => gateway.applyFreeCertificate(domain));
      candidateId = applied?.CertificateId;
      if (!candidateId) throw new Error(`ApplyCertificate did not return CertificateId for ${domain}`);
      await saveState({
        phase: "waiting_certificate",
        oldCertificateId,
        oldExpireTime,
        candidateCertificateId: candidateId,
        applyRequestId: applied.RequestId,
      });
      logger.info("certificate_requested", { domain, certificateId: candidateId, requestId: applied.RequestId });
      candidate = await waitForCertificate({ candidateId, domainConfig, gateway, retry, logger, sleep, now, saveState });
    }
  }

  validateCandidateCertificate(candidate, {
    domain,
    oldExpireTime,
    minimumValidityGainDays: domainConfig.minimumValidityGainDays,
  });
  await saveState({ phase: activeState?.deployRecordId ? activeState.phase : "certificate_issued", candidateExpireTime: candidate.CertEndTime });

  let deployRecordId = activeState?.deployRecordId;
  if (!deployRecordId && activeState?.phase !== "verifying") {
    const beforeDeploy = await describeCurrent();
    if (beforeDeploy.certificateId === candidateId) {
      logger.warn("candidate_already_deployed", { domain, certificateId: candidateId });
    } else {
      if (beforeDeploy.certificateId !== oldCertificateId) {
        throw new Error(`CDN certificate changed concurrently for ${domain}; refusing to overwrite it`);
      }
      if (beforeDeploy.httpsBillingSwitch !== domainConfig.expectedHttpsBillingSwitch) {
        throw new Error(`HTTPS billing switch changed concurrently for ${domain}`);
      }
      await saveState({ phase: "deploy_requested" });
      const deployed = await retry("DeployCertificateInstance", () => gateway.deployCertificate({
        certificateId: candidateId,
        domain,
        httpsBillingSwitch: beforeDeploy.httpsBillingSwitch,
      }));
      deployRecordId = deployed?.DeployRecordId;
      if (deployRecordId === undefined || deployRecordId === null) {
        throw new Error(`DeployCertificateInstance did not return DeployRecordId for ${domain}`);
      }
      await saveState({
        phase: "deploying",
        deployRecordId,
        deployRequestId: deployed.RequestId,
      });
      logger.info("deployment_started", { domain, certificateId: candidateId, deployRecordId, requestId: deployed.RequestId });
    }
  }

  if (deployRecordId && activeState?.phase !== "verifying") {
    let lastRecord;
    try {
      await pollState(
        async () => {
          lastRecord = await retry("DescribeHostDeployRecordDetail", () => gateway.describeDeployRecord(deployRecordId));
          return lastRecord;
        },
        classifyDeploymentStatus,
        {
          timeoutMs: domainConfig.deploymentTimeoutMinutes * 60_000,
          intervalMs: domainConfig.pollIntervalSeconds * 1000,
          sleep,
          now: () => now().getTime(),
          onPoll: ({ state: deployState }) => logger.info("deployment_polled", { domain, deployRecordId, state: deployState }),
        },
      );
    } catch (error) {
      let bindingAfterFailure;
      try {
        bindingAfterFailure = await describeCurrent();
      } catch (readError) {
        logger.error("deployment_failure_binding_unknown", { domain, error: readError.message });
      }
      if (Number(lastRecord?.SuccessTotalCount ?? 0) > 0 || bindingAfterFailure?.certificateId === candidateId) {
        await rollback({ deployRecordId, oldCertificateId, oldExpireTime, candidateId, domainConfig, gateway, tlsReader, retry, logger, saveState, sleep, now });
      } else if (bindingAfterFailure?.certificateId === oldCertificateId) {
        await saveState({ phase: "deployment_failed", failure: error.message });
      } else {
        await rollback({ deployRecordId, oldCertificateId, oldExpireTime, candidateId, domainConfig, gateway, tlsReader, retry, logger, saveState, sleep, now });
      }
      throw error;
    }
    await saveState({ phase: "verifying" });
  }

  try {
    await waitForCdnCertificate({ expectedCertificateId: candidateId, domainConfig, describeCurrent, logger, sleep, now });
    await waitForLiveCertificate({ domainConfig, tlsReader, logger, sleep, oldExpireTime, candidateExpireTime: candidate.CertEndTime });
  } catch (error) {
    if (deployRecordId) {
      await rollback({ deployRecordId, oldCertificateId, oldExpireTime, candidateId, domainConfig, gateway, tlsReader, retry, logger, saveState, sleep, now });
    } else {
      await rollbackByRedeployingOld({ oldCertificateId, oldExpireTime, candidateId, domainConfig, gateway, tlsReader, retry, logger, saveState, sleep, now });
    }
    throw error;
  }

  await saveState({
    phase: "completed",
    completedAt: now().toISOString(),
    currentCertificateId: candidateId,
    currentExpireTime: candidate.CertEndTime,
  });
  logger.info("renewal_completed", { domain, certificateId: candidateId, certificateExpireTime: candidate.CertEndTime });
  return { action: "renewed", certificateId: candidateId, certificateExpireTime: candidate.CertEndTime };
}

async function waitForCertificate({ candidateId, domainConfig, gateway, retry, logger, sleep, now, saveState }) {
  try {
    return await pollState(
      () => retry("DescribeCertificate", () => gateway.describeCertificate(candidateId)),
      classifyCertificateStatus,
      {
        timeoutMs: domainConfig.issuanceTimeoutMinutes * 60_000,
        intervalMs: domainConfig.pollIntervalSeconds * 1000,
        sleep,
        now: () => now().getTime(),
        onPoll: ({ state }) => logger.info("certificate_polled", { domain: domainConfig.domain, certificateId: candidateId, state }),
      },
    );
  } catch (error) {
    await saveState({ phase: "certificate_failed", failure: error.message });
    throw error;
  }
}

async function waitForCdnCertificate({ expectedCertificateId, domainConfig, describeCurrent, logger, sleep, now }) {
  return pollState(
    describeCurrent,
    (current) => current.certificateId === expectedCertificateId ? "issued" : "pending",
    {
      timeoutMs: domainConfig.deploymentTimeoutMinutes * 60_000,
      intervalMs: domainConfig.pollIntervalSeconds * 1000,
      sleep,
      now: () => now().getTime(),
      onPoll: ({ value }) => logger.info("cdn_binding_polled", {
        domain: domainConfig.domain,
        expectedCertificateId,
        actualCertificateId: value.certificateId,
      }),
    },
  );
}

async function waitForLiveCertificate({ domainConfig, tlsReader, logger, sleep, oldExpireTime, candidateExpireTime }) {
  let lastError;
  for (let attempt = 1; attempt <= domainConfig.tlsVerifyAttempts; attempt += 1) {
    try {
      const live = await tlsReader(domainConfig.domain);
      validateLiveCertificate(live, {
        domain: domainConfig.domain,
        oldExpireTime,
        candidateExpireTime,
        minimumValidityGainDays: domainConfig.minimumValidityGainDays,
      });
      logger.info("tls_verification_succeeded", {
        domain: domainConfig.domain,
        attempt,
        validTo: live.validTo,
        fingerprint256: live.fingerprint256,
      });
      return live;
    } catch (error) {
      lastError = error;
      logger.warn("tls_verification_retry", { domain: domainConfig.domain, attempt, error: error.message });
      if (attempt < domainConfig.tlsVerifyAttempts) await sleep(domainConfig.tlsVerifyIntervalSeconds * 1000);
    }
  }
  throw lastError;
}

async function rollback({ deployRecordId, oldCertificateId, oldExpireTime, candidateId, domainConfig, gateway, tlsReader, retry, logger, saveState, sleep, now }) {
  logger.warn("rollback_starting", { domain: domainConfig.domain, deployRecordId, oldCertificateId, candidateId });
  try {
    const response = await retry("DeployCertificateRecordRollback", () => gateway.rollbackDeploy(deployRecordId));
    const rollbackRecordId = response?.DeployRecordId;
    if (rollbackRecordId === undefined || rollbackRecordId === null) throw new Error("Rollback API did not return DeployRecordId");
    const rollbackState = await saveState({ phase: "rollback", rollbackRecordId, rollbackRequestId: response.RequestId });
    await finishRollback({ state: rollbackState, domainConfig, gateway, tlsReader, retry, logger, saveState, sleep, now });
  } catch (error) {
    await saveState({ phase: "rollback_failed", rollbackFailure: error.message });
    throw new Error(`Deployment verification failed and rollback failed for ${domainConfig.domain}: ${error.message}`);
  }
}

async function rollbackByRedeployingOld({ oldCertificateId, oldExpireTime, candidateId, domainConfig, gateway, tlsReader, retry, logger, saveState, sleep, now }) {
  logger.warn("rollback_redeploy_old_starting", { domain: domainConfig.domain, oldCertificateId, candidateId });
  try {
    const response = await retry("DeployCertificateInstance", () => gateway.deployCertificate({
      certificateId: oldCertificateId,
      domain: domainConfig.domain,
      httpsBillingSwitch: domainConfig.expectedHttpsBillingSwitch,
    }));
    const rollbackRecordId = response?.DeployRecordId;
    if (rollbackRecordId === undefined || rollbackRecordId === null) {
      throw new Error("Old-certificate redeploy did not return DeployRecordId");
    }
    const rollbackState = await saveState({
      phase: "rollback",
      rollbackRecordId,
      rollbackRequestId: response.RequestId,
      rollbackMethod: "redeploy-old-certificate",
      oldCertificateId,
      oldExpireTime,
    });
    await finishRollback({ state: rollbackState, domainConfig, gateway, tlsReader, retry, logger, saveState, sleep, now });
  } catch (error) {
    await saveState({ phase: "rollback_failed", rollbackFailure: error.message });
    throw new Error(`Deployment verification failed and old-certificate redeploy failed for ${domainConfig.domain}: ${error.message}`);
  }
}

async function finishRollback({ state, domainConfig, gateway, tlsReader, retry, logger, saveState, sleep, now }) {
  await pollState(
    () => retry("DescribeHostDeployRecordDetail", () => gateway.describeDeployRecord(state.rollbackRecordId)),
    classifyDeploymentStatus,
    {
      timeoutMs: domainConfig.deploymentTimeoutMinutes * 60_000,
      intervalMs: domainConfig.pollIntervalSeconds * 1000,
      sleep,
      now: () => now().getTime(),
    },
  );
  await pollState(
    () => retry("DescribeDomainsConfig", () => gateway.describeCdnDomain(domainConfig.domain)),
    (current) => current?.certificateId === state.oldCertificateId ? "issued" : "pending",
    {
      timeoutMs: domainConfig.deploymentTimeoutMinutes * 60_000,
      intervalMs: domainConfig.pollIntervalSeconds * 1000,
      sleep,
      now: () => now().getTime(),
    },
  );
  const live = await tlsReader(domainConfig.domain);
  validateCurrentLive(live, { certificateExpireTime: state.oldExpireTime }, domainConfig.domain);
  await saveState({ phase: "rolled_back", rolledBackAt: now().toISOString() });
  logger.warn("rollback_completed", { domain: domainConfig.domain, certificateId: state.oldCertificateId });
}
