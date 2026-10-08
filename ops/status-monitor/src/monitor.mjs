import { runCheck } from "./probe.mjs";
import { applySample, recordCertificates } from "./state.mjs";

const START_STAGGER_MS = 1500;
const SAVE_DELAY_MS = 2000;

export function createMonitor({
  config,
  state,
  store,
  notifier,
  logger,
  connectivity,
  run = runCheck,
  now = Date.now,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  const timers = new Map();
  let saveTimer = null;
  let saving = Promise.resolve();
  let stopped = false;
  let revision = 0;

  // 失败后隔几秒再试一次，两次都失败才算一次失败的探测，滤掉单个丢包或连接抖动。
  async function probe(check) {
    const first = await run(check);
    if (first.outcome !== "down" || stopped) return first;
    await sleep(check.retryDelayMs);
    return stopped ? first : run(check);
  }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = null;
    saving = saving.then(() => store.save(state)).catch((error) => logger.error("state_save_failed", { message: error.message }));
    return saving;
  }

  async function record(check, sample) {
    let outcome = sample.outcome;
    if (outcome === "down" && !(await connectivity.isOnline())) {
      outcome = "unknown";
      logger.warn("monitor_offline", { check: check.id, reason: sample.reason });
    } else if (outcome === "down") {
      logger.warn("check_failed", { check: check.id, reason: sample.reason, httpStatus: sample.httpStatus, elapsedMs: sample.elapsedMs });
    }

    const at = now();
    const events = [
      ...applySample(state, check, { ...sample, outcome }, { now: at, timezone: config.timezone }),
      ...recordCertificates(state, sample.certificates, { now: at, warnDays: config.certificateWarnDays }),
    ];
    if (sample.version && state.release?.value !== sample.version) state.release = { value: sample.version, seenAt: at };
    for (const event of events) logger.info(`status_${event.type}`, event);
    notifier.push(events);
    revision += 1;
    saveTimer ??= setTimeout(save, SAVE_DELAY_MS);
  }

  async function cycle(check) {
    const startedAt = now();
    try {
      const sample = await probe(check);
      if (!stopped) await record(check, sample);
    } catch (error) {
      logger.error("check_crashed", { check: check.id, message: error.message });
    }
    if (stopped) return;
    const waitMs = Math.max(1000, check.intervalSeconds * 1000 - (now() - startedAt));
    timers.set(check.id, setTimeout(() => cycle(check), waitMs));
  }

  return {
    revision: () => revision,
    // 各检查项错开启动，避免每分钟同一秒对主站集中发请求。
    start() {
      config.checks.forEach((check, index) => {
        timers.set(check.id, setTimeout(() => cycle(check), index * START_STAGGER_MS));
      });
    },
    async stop() {
      stopped = true;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      await save();
    },
    // 每项探测一次并返回结果，不写状态、不发通知；用于部署后核对配置。
    runOnce() {
      return Promise.all(config.checks.map(async (check) => ({ check, sample: await probe(check) })));
    },
  };
}
