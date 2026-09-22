import { currentTiming, endChannelKey } from "./liveActivitySchedule";
import { prisma } from "../prisma";
import { createLiveActivityChannel, deleteLiveActivityChannel } from "./apnsClient";
import { getApnsConfig, withApnsConfigLock } from "./apnsConfig";

const MAX_CHANNELS_PER_ENVIRONMENT = 9000;
// Only retired date-scoped channels rotate out; permanent channels are reused.
const DATED_CHANNEL = /^(production|sandbox):cpu-(?:day|block):(\d{4}-\d{2}-\d{2})(?::\d{4})?$/;
/// 时段频道时代留下的常驻键。逐个列出而不是"没有日期就算旧的"，这样以后新增
/// 键形状不会被静默删掉。回收后订阅它们的旧版本活动收不到 end，会挂到系统上限。
const LEGACY_CHANNEL = /^(production|sandbox):cpu(?:-morning|-afternoon|-evening)?$/;

export function schoolDate(now = Date.now()) {
  return new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
}

export async function requiredChannelSuffixes(_now = Date.now()) {
  const timing = await currentTiming();
  return timing.periods.map(p => endChannelKey("production", timing.id, p.id).slice("production:".length));
}

type ChannelError = { environment: string; message: string };

async function provisionChannels(db: Parameters<Parameters<typeof withApnsConfigLock>[0]>[0], now: number, prune: boolean) {
  const config = await getApnsConfig(db);
  const errors: ChannelError[] = [];
  if (!config.configured) return { errors, configured: false };
  const previousChannels = JSON.stringify(config.channels);
  if (prune) {
    const oldest = schoolDate(now - 86400_000);
    const current = await currentTiming();
    const expired = await prisma.liveActivityScheduleVersion.findMany({ where: { id: { not: current.id }, broadcastUntil: { lt: new Date(now - 60000) } } });
    const expiredIds = new Set(expired.map(v => v.id));
    for (const [key, channel] of Object.entries(config.channels)) {
      const dated = DATED_CHANNEL.exec(key);
      const legacy = LEGACY_CHANNEL.exec(key);
      const versioned = /^(production|sandbox):main-campus:([a-f0-9]+):end-period-\d+$/.exec(key);
      const retired = /^(production|sandbox):cpu-(?:day|block(?::\d+)?)$/.exec(key);
      const match = legacy ?? retired ?? (dated && dated[2] < oldest ? dated : null) ?? (versioned && expiredIds.has(versioned[2]) ? versioned : null);
      if (!match) continue;
      try {
        await deleteLiveActivityChannel(config, match[1] as "production" | "sandbox", channel);
        delete config.channels[key];
        if (legacy) console.warn(`[apns] reclaimed legacy window channel ${key}`);
      } catch (error) { errors.push({ environment: match[1], message: `${key}: 回收失败: ${error instanceof Error ? error.message : String(error)}` }); }
    }
  }
  const suffixes = await requiredChannelSuffixes(now);
  for (const environment of ["production", "sandbox"] as const) {
    for (const suffix of suffixes) {
      const key = `${environment}:${suffix}`;
      if (config.channels[key]) continue;
      if (Object.keys(config.channels).filter(k => k.startsWith(`${environment}:`)).length >= MAX_CHANNELS_PER_ENVIRONMENT) {
        errors.push({ environment, message: `${key}: 频道数量已达到上限` });
        continue;
      }
      try {
        config.channels[key] = await createLiveActivityChannel(config, environment);
      } catch (error) {
        errors.push({ environment, message: `${key}: ${error instanceof Error ? error.message : String(error)}` });
      }
    }
  }
  const value = JSON.stringify(config.channels);
  if (value !== previousChannels) {
    await db.siteSetting.upsert({ where: { key: "apns.channels" }, create: { key: "apns.channels", value }, update: { value } });
  }
  return { errors, configured: true };
}

let lastChannelCheck = 0;
export async function maintainApnsChannels(now = Date.now()) {
  if (now - lastChannelCheck < 60_000) return;
  await withApnsConfigLock(async db => {
    if (now - lastChannelCheck < 60_000) return;
    const { errors, configured } = await provisionChannels(db, now, true);
    if (!configured) return;
    for (const error of errors) console.warn("[apns] channel provisioning", error.message);
    lastChannelCheck = now;
  });
}

/** Keep existing IDs stable. Retry only missing channels after a partial failure. */
export async function ensureApnsChannels(now = Date.now()) {
  return withApnsConfigLock(async db => {
    const { errors } = await provisionChannels(db, now, false);
    return { ...await getApnsConfig(db), channelErrors: errors };
  });
}
