import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { normalizeDomain } from "./core.mjs";

const DEFAULTS = Object.freeze({
  renewBeforeDays: 30,
  minimumValidityGainDays: 30,
  pollIntervalSeconds: 30,
  issuanceTimeoutMinutes: 60,
  deploymentTimeoutMinutes: 15,
  tlsVerifyAttempts: 8,
  tlsVerifyIntervalSeconds: 15,
  apiMaxAttempts: 4,
  apiRetryBaseMs: 1000,
});

function positiveNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${name} must be a positive number`);
  return number;
}

export async function loadConfig(configPath) {
  const absolutePath = path.resolve(configPath);
  const parsed = JSON.parse(await readFile(absolutePath, "utf8"));
  if (!Array.isArray(parsed.domains) || parsed.domains.length === 0) {
    throw new Error("Config must include at least one CDN custom domain");
  }
  const defaults = { ...DEFAULTS, ...(parsed.defaults ?? {}) };
  for (const name of Object.keys(DEFAULTS)) defaults[name] = positiveNumber(defaults[name], `defaults.${name}`);

  const seen = new Set();
  const domains = parsed.domains.map((entry) => {
    const domain = normalizeDomain(entry.domain);
    if (seen.has(domain)) throw new Error(`Duplicate domain in config: ${domain}`);
    seen.add(domain);
    if (!entry.expectedCdnResourceId) throw new Error(`expectedCdnResourceId is required for ${domain}`);
    const expectedHttpsBillingSwitch = entry.expectedHttpsBillingSwitch ?? "on";
    if (!["on", "off"].includes(expectedHttpsBillingSwitch)) {
      throw new Error(`expectedHttpsBillingSwitch must be on/off for ${domain}`);
    }
    const merged = { ...defaults, ...entry, domain, expectedHttpsBillingSwitch, enabled: entry.enabled !== false };
    for (const name of Object.keys(DEFAULTS)) merged[name] = positiveNumber(merged[name], `${domain}.${name}`);
    return merged;
  });
  return { configPath: absolutePath, defaults, domains };
}

export async function loadCredentials(env = process.env) {
  let secretId = env.TENCENTCLOUD_SECRET_ID ?? env.TENCENT_CLOUD_SECRET_ID;
  let secretKey = env.TENCENTCLOUD_SECRET_KEY ?? env.TENCENT_CLOUD_SECRET_KEY;
  let token = env.TENCENTCLOUD_SESSION_TOKEN ?? env.TENCENT_CLOUD_SESSION_TOKEN;
  const credentialFile = env.TENCENT_CLOUD_CREDENTIALS_FILE;
  let source = secretId || secretKey ? "environment" : undefined;

  if (Boolean(secretId) !== Boolean(secretKey)) {
    throw new Error("Tencent Cloud environment credentials are incomplete; SecretId and SecretKey must be set together");
  }
  if (!secretId && credentialFile) {
    const absoluteCredentialFile = path.resolve(credentialFile);
    const metadata = await stat(absoluteCredentialFile);
    if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
      throw new Error("Tencent Cloud credentials file must not be readable or writable by group/other users");
    }
    const parsed = JSON.parse(await readFile(absoluteCredentialFile, "utf8"));
    secretId = parsed.secretId ?? parsed.SecretId;
    secretKey = parsed.secretKey ?? parsed.SecretKey;
    token = parsed.token ?? parsed.Token;
    source = "credential-file";
  }
  if (!secretId || !secretKey) {
    throw new Error("Tencent Cloud credentials must come from environment variables or TENCENT_CLOUD_CREDENTIALS_FILE");
  }
  return { secretId, secretKey, token, source };
}

export function parseArguments(argv) {
  const options = { execute: false, config: "config.json", stateFile: undefined, confirmDomains: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const take = (name) => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
      index += 1;
      return value;
    };
    if (arg === "--execute") options.execute = true;
    else if (arg === "--dry-run") options.execute = false;
    else if (arg === "--config") options.config = take("--config");
    else if (arg === "--state-file") options.stateFile = take("--state-file");
    else if (arg === "--confirm-domains") options.confirmDomains = take("--confirm-domains").split(",").map(normalizeDomain);
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export function validateExecutionApproval(options, domains) {
  if (!options.execute) return;
  if (!options.stateFile) throw new Error("--execute requires --state-file for durable recovery");
  const enabled = domains.filter((domain) => domain.enabled).map((domain) => domain.domain).sort();
  const confirmed = [...new Set(options.confirmDomains)].sort();
  if (enabled.length !== confirmed.length || enabled.some((domain, index) => domain !== confirmed[index])) {
    throw new Error(`--execute requires --confirm-domains with the exact enabled set: ${enabled.join(",")}`);
  }
}

export { DEFAULTS };
