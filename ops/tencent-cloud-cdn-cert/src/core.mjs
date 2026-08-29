import { checkServerIdentity } from "node:tls";

export const DAY_MS = 24 * 60 * 60 * 1000;

export function parseCloudTime(value) {
  if (value instanceof Date) return value;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid cloud time: ${String(value)}`);
  }

  const trimmed = value.trim();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)
    ? `${trimmed.replace(" ", "T")}+08:00`
    : trimmed;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid cloud time: ${value}`);
  }
  return parsed;
}

export function remainingDays(expiresAt, now = new Date()) {
  return (parseCloudTime(expiresAt).getTime() - now.getTime()) / DAY_MS;
}

export function shouldRenew(expiresAt, thresholdDays, now = new Date()) {
  if (!Number.isFinite(thresholdDays) || thresholdDays <= 0) {
    throw new Error("renewBeforeDays must be a positive number");
  }
  return remainingDays(expiresAt, now) <= thresholdDays;
}

export function normalizeDomain(domain) {
  if (typeof domain !== "string") throw new Error("Domain must be a string");
  const normalized = domain.trim().toLowerCase().replace(/\.$/, "");
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(normalized)) {
    throw new Error(`Invalid domain: ${domain}`);
  }
  return normalized;
}

export function domainPatternCovers(pattern, domain) {
  const expected = normalizeDomain(domain);
  const candidate = String(pattern ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (candidate === expected) return true;
  if (!candidate.startsWith("*.")) return false;
  const suffix = candidate.slice(2);
  return expected.endsWith(`.${suffix}`) && expected.split(".").length === suffix.split(".").length + 1;
}

export function certificateDomains(certificate) {
  const names = [
    certificate?.Domain,
    ...(Array.isArray(certificate?.SubjectAltName) ? certificate.SubjectAltName : []),
    ...(Array.isArray(certificate?.SubmittedData?.DomainList) ? certificate.SubmittedData.DomainList : []),
  ];
  return [...new Set(names.filter(Boolean).map((name) => String(name).toLowerCase()))];
}

export function certificateCoversDomain(certificate, domain) {
  return certificateDomains(certificate).some((name) => domainPatternCovers(name, domain));
}

export function classifyCertificateStatus(certificate) {
  const status = Number(certificate?.Status);
  if (status === 1) return "issued";
  if ([2, 3, 6, 7, 9, 10, 14].includes(status)) return "failed";
  if ([0, 4, 5, 8, 11, 12, 13, 15].includes(status)) return "pending";
  return "unknown";
}

export function classifyDeploymentStatus(record) {
  const total = Number(record?.TotalCount ?? 0);
  const success = Number(record?.SuccessTotalCount ?? 0);
  const failed = Number(record?.FailedTotalCount ?? 0);
  const running = Number(record?.RunningTotalCount ?? 0);
  const pending = Number(record?.PendingTotalCount ?? 0);

  if (failed > 0) return "failed";
  if (total > 0 && success === total && running === 0 && pending === 0) return "succeeded";
  if (running > 0 || pending > 0 || total === 0) return "pending";
  return "unknown";
}

export function validateCurrentCdnDomain(current, expected) {
  if (!current) throw new Error(`CDN domain not found: ${expected.domain}`);
  if (normalizeDomain(current.domain) !== normalizeDomain(expected.domain)) {
    throw new Error(`CDN API returned a different domain for ${expected.domain}`);
  }
  if (expected.expectedCdnResourceId && current.resourceId !== expected.expectedCdnResourceId) {
    throw new Error(`CDN resource ID mismatch for ${expected.domain}`);
  }
  if (current.status !== "online") {
    throw new Error(`CDN domain ${expected.domain} is not online (status=${current.status})`);
  }
  if (current.httpsSwitch !== "on" || !current.certificateId || !current.certificateExpireTime) {
    throw new Error(`CDN domain ${expected.domain} does not have an active managed HTTPS certificate`);
  }
  if (expected.expectedHttpsBillingSwitch && current.httpsBillingSwitch !== expected.expectedHttpsBillingSwitch) {
    throw new Error(`HTTPS billing switch mismatch for ${expected.domain}`);
  }
  return current;
}

export function validateCandidateCertificate(candidate, { domain, oldExpireTime, minimumValidityGainDays }) {
  if (classifyCertificateStatus(candidate) !== "issued") {
    throw new Error(`Certificate ${candidate?.CertificateId ?? "unknown"} is not issued`);
  }
  if (!certificateCoversDomain(candidate, domain)) {
    throw new Error(`Certificate ${candidate.CertificateId} does not cover ${domain}`);
  }
  const oldEnd = parseCloudTime(oldExpireTime).getTime();
  const newEnd = parseCloudTime(candidate.CertEndTime).getTime();
  if (newEnd < oldEnd + minimumValidityGainDays * DAY_MS) {
    throw new Error(`Certificate ${candidate.CertificateId} does not extend validity enough for ${domain}`);
  }
  return candidate;
}

export function validateLiveCertificate(live, { domain, oldExpireTime, candidateExpireTime, minimumValidityGainDays }) {
  if (!live?.authorized) throw new Error(`TLS verification failed for ${domain}`);
  const identityError = checkServerIdentity(domain, {
    subject: live.subject ?? {},
    subjectaltname: live.subjectAltName,
  });
  if (identityError) throw identityError;

  const oldEnd = parseCloudTime(oldExpireTime).getTime();
  const liveEnd = parseCloudTime(live.validTo).getTime();
  const candidateEnd = parseCloudTime(candidateExpireTime).getTime();
  if (liveEnd < oldEnd + minimumValidityGainDays * DAY_MS) {
    throw new Error(`Live certificate validity did not advance enough for ${domain}`);
  }
  if (Math.abs(liveEnd - candidateEnd) > DAY_MS) {
    throw new Error(`Live certificate expiry does not match the issued certificate for ${domain}`);
  }
  return live;
}

export function findReusableCertificate(certificates, { domain, currentCertificateId, oldExpireTime, minimumValidityGainDays, now = new Date() }) {
  const recentCutoff = now.getTime() - 7 * DAY_MS;
  return [...certificates]
    .filter((cert) => cert?.CertificateId && cert.CertificateId !== currentCertificateId)
    .filter((cert) => certificateCoversDomain(cert, domain))
    .filter((cert) => {
      const state = classifyCertificateStatus(cert);
      if (state === "issued") {
        try {
          validateCandidateCertificate(cert, { domain, oldExpireTime, minimumValidityGainDays });
          return true;
        } catch {
          return false;
        }
      }
      if (state !== "pending") return false;
      try {
        return parseCloudTime(cert.InsertTime).getTime() >= recentCutoff;
      } catch {
        return false;
      }
    })
    .sort((a, b) => parseCloudTime(b.InsertTime).getTime() - parseCloudTime(a.InsertTime).getTime())[0] ?? null;
}

export function mask(value) {
  const text = String(value ?? "");
  if (text.length <= 8) return "***";
  return `${text.slice(0, 4)}***${text.slice(-4)}`;
}

export function sanitizeLogValue(value, knownSecrets = []) {
  const secrets = knownSecrets.filter(Boolean).map(String);
  const walk = (item, key = "") => {
    if (/secret|token|password|private.?key|authorization/i.test(key)) return "***";
    if (typeof item === "string") {
      let safe = item.replace(/AKID[A-Za-z0-9]{8,}/g, (match) => mask(match));
      for (const secret of secrets) safe = safe.split(secret).join("***");
      return safe;
    }
    if (Array.isArray(item)) return item.map((entry) => walk(entry));
    if (item && typeof item === "object") {
      return Object.fromEntries(Object.entries(item).map(([childKey, child]) => [childKey, walk(child, childKey)]));
    }
    return item;
  };
  return walk(value);
}

export function isTransientCloudError(error) {
  const code = String(error?.code ?? error?.Code ?? "");
  return /^(InternalError|RequestLimitExceeded|LimitExceeded|ResourceUnavailable)/.test(code)
    || ["ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "ENETUNREACH"].includes(code);
}

export async function withRetry(operation, { attempts, baseDelayMs, sleep, onRetry = () => {} }) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isTransientCloudError(error)) throw error;
      const delayMs = baseDelayMs * (2 ** (attempt - 1));
      onRetry({ attempt, delayMs, code: error?.code ?? "unknown" });
      await sleep(delayMs);
    }
  }
  throw lastError;
}

export async function pollState(read, classify, { timeoutMs, intervalMs, sleep, now = () => Date.now(), onPoll = () => {} }) {
  const deadline = now() + timeoutMs;
  while (true) {
    const value = await read();
    const state = classify(value);
    onPoll({ state, value });
    if (state === "succeeded" || state === "issued") return value;
    if (state === "failed" || state === "unknown") {
      throw new Error(`Polling reached terminal state: ${state}`);
    }
    if (now() >= deadline) throw new Error("Polling timed out");
    await sleep(intervalMs);
  }
}
