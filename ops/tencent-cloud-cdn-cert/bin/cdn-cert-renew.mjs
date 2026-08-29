#!/usr/bin/env node
import { loadConfig, loadCredentials, parseArguments, validateExecutionApproval } from "../src/config.mjs";
import { createLogger } from "../src/logging.mjs";
import { runAutomation } from "../src/runner.mjs";
import { JsonStateStore } from "../src/state.mjs";
import { createTencentCloudGateway } from "../src/tencent-cloud.mjs";
import { readLiveTlsCertificate } from "../src/tls-verify.mjs";

const HELP = `Tencent Cloud CDN managed certificate renewal

Usage:
  node bin/cdn-cert-renew.mjs --config <path> [--dry-run]
  node bin/cdn-cert-renew.mjs --config <path> --execute \\
    --state-file <path> --confirm-domains <comma-separated-exact-domain-set>

The default mode is dry-run. --execute is rejected unless the durable state file
and the exact enabled domain set are explicitly supplied.
`;

let crashSecrets = [];

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }

  const config = await loadConfig(options.config);
  validateExecutionApproval(options, config.domains);
  const credentials = await loadCredentials();
  crashSecrets = [credentials.secretId, credentials.secretKey, credentials.token].filter(Boolean);
  const logger = createLogger({
    knownSecrets: crashSecrets,
  });
  logger.info("run_started", {
    dryRun: !options.execute,
    configPath: config.configPath,
    credentialSource: credentials.source,
    domains: config.domains.filter((domain) => domain.enabled).map((domain) => domain.domain),
  });

  const gateway = await createTencentCloudGateway(credentials);
  const stateStore = options.stateFile ? new JsonStateStore(options.stateFile) : undefined;
  let releaseLock;
  try {
    if (options.execute) releaseLock = await stateStore.acquireLock();
    const results = await runAutomation({
      config,
      gateway,
      tlsReader: readLiveTlsCertificate,
      logger,
      execute: options.execute,
      stateStore,
    });
    const failed = results.filter((result) => !result.ok);
    logger.info("run_finished", {
      dryRun: !options.execute,
      succeeded: results.length - failed.length,
      failed: failed.length,
      results,
    });
    if (failed.length > 0) process.exitCode = 1;
  } finally {
    await releaseLock?.();
  }
}

main().catch((error) => {
  const logger = createLogger({ knownSecrets: crashSecrets });
  logger.error("run_crashed", { error: error.message, code: error.code });
  process.exitCode = 1;
});
