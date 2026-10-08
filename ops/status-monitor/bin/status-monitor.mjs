#!/usr/bin/env node
import { ConfigError, loadConfig, parseArguments } from "../src/config.mjs";
import { createLogger } from "../src/logging.mjs";
import { createMonitor } from "../src/monitor.mjs";
import { createNotifier } from "../src/notify.mjs";
import { createConnectivityGuard } from "../src/probe.mjs";
import { createStatusServer } from "../src/server.mjs";
import { createStore, reconcile } from "../src/state.mjs";
import { STATUS_LABELS } from "../src/view.mjs";

const HELP = `药大拾间状态监控

用法:
  node bin/status-monitor.mjs --config <配置文件>                 常驻运行：定时探测并提供状态页
  node bin/status-monitor.mjs --config <配置文件> --once          每项探测一次并打印结果，不写数据、不发通知
  node bin/status-monitor.mjs --config <配置文件> --test-notify   向所有通知渠道发一条测试消息

--config 默认为当前目录下的 config.json。
`;

async function runOnce(monitor) {
  const results = await monitor.runOnce();
  for (const { check, sample } of results) {
    const facts = [
      sample.outcome === "slow" && sample.reason ? sample.reason : STATUS_LABELS[sample.outcome],
      sample.outcome === "down" ? sample.reason : `${sample.elapsedMs} ms`,
      sample.detail,
    ].filter(Boolean);
    process.stdout.write(`${sample.outcome === "down" ? "✗" : "✓"} ${check.name}（${check.id}）：${facts.join("，")}\n`);
  }
  return results.some(({ sample }) => sample.outcome === "down") ? 1 : 0;
}

async function testNotify(config, context, logger) {
  if (!config.notify.length) {
    process.stdout.write("配置里没有通知渠道（notify 为空）。\n");
    return 1;
  }
  // 测试消息发给每一个渠道，不管它平时订阅哪些事件。
  const channels = config.notify.map((channel) => ({ ...channel, events: ["test"] }));
  const results = await createNotifier({ channels, context, logger }).send([{ type: "test", sentAt: Date.now() }]);
  for (const result of results) {
    process.stdout.write(`${result.ok ? "✓" : "✗"} ${result.channel}${result.ok ? "" : `：${result.reason}`}\n`);
  }
  return results.every((result) => result.ok) ? 0 : 1;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const config = await loadConfig(options.config);
  // 一次性命令的结果直接打印给人看，过程日志写到标准错误，不混在一起。
  const logger = createLogger({ output: options.once || options.testNotify ? process.stderr : process.stdout });
  const context = { siteName: config.siteName, publicUrl: config.publicUrl, timezone: config.timezone };
  if (options.testNotify) return testNotify(config, context, logger);
  const notifier = createNotifier({ channels: config.notify, context, logger });

  const connectivity = createConnectivityGuard({ urls: config.connectivityUrls });
  if (options.once) return runOnce(createMonitor({ config, notifier, logger, connectivity }));

  const store = createStore({ dataDir: config.dataDir, logger });
  const state = await store.load();
  reconcile(state, config.checks, Date.now());
  const monitor = createMonitor({ config, state, store, notifier, logger, connectivity });
  const server = createStatusServer({ config, state, monitor, logger });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.listen.port, config.listen.host, resolve);
  });
  logger.info("started", {
    listen: `http://${config.listen.host}:${server.address().port}`,
    checks: config.checks.length,
    notifyChannels: config.notify.map((channel) => channel.name),
    stateFile: store.file,
  });
  monitor.start();

  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    logger.info("stopping", { signal });
    server.close();
    await monitor.stop();
    await notifier.flush();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  return null;
}

main().then((code) => {
  if (code !== null) process.exitCode = code;
}, (error) => {
  process.stderr.write(`${error instanceof ConfigError ? `配置错误：${error.message}` : (error.stack || error.message)}\n`);
  process.exitCode = 1;
});
