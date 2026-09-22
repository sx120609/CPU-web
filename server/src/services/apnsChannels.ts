import { scheduleBlocks } from "./liveActivityBlocks";
import { getSchedulePeriods } from "./scheduleTermConfig";
import { createLiveActivityChannel, deleteLiveActivityChannel } from "./apnsClient";
import { getApnsConfig, withApnsConfigLock } from "./apnsConfig";

const MAX_CHANNELS_PER_ENVIRONMENT = 9000;
/// 所有频道都按学校日期作用域，昨天之前的一律回收。
const DATED_CHANNEL = /^(production|sandbox):cpu-(?:day|block):(\d{4}-\d{2}-\d{2})(?::\d{4})?$/;
/// 时段频道时代留下的常驻键。逐个列出而不是"没有日期就算旧的"，这样以后新增
/// 键形状不会被静默删掉。回收后订阅它们的旧版本活动收不到 end，会挂到系统上限。
const LEGACY_CHANNEL = /^(production|sandbox):cpu(?:-morning|-afternoon|-evening)?$/;

export function schoolDate(now = Date.now()) {
  return new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
}

export function dayChannelDates(now = Date.now()) {
  return [schoolDate(now), schoolDate(now + 86400_000)];
}

/// iOS 26 每天一个频道（只发 tick，本机负责结束）；iOS 18–25 每个课节块一个频道
/// （tick + end，end 的范围正好是这一块）。两者都随日期轮转，跨日残留不可能发生。
export async function requiredChannelSuffixes(now = Date.now()) {
  const blocks = scheduleBlocks(await getSchedulePeriods());
  return dayChannelDates(now).flatMap(date => [
    `cpu-day:${date}`,
    ...blocks.map(block => `cpu-block:${date}:${block.id}`),
  ]);
}

type ChannelError = { environment: string; message: string };

async function provisionChannels(db: Parameters<Parameters<typeof withApnsConfigLock>[0]>[0], now: number, prune: boolean) {
  const config = await getApnsConfig(db);
  const errors: ChannelError[] = [];
  if (!config.configured) return { errors, configured: false };
  if (prune) {
    const oldest = schoolDate(now - 86400_000);
    for (const [key, channel] of Object.entries(config.channels)) {
      const dated = DATED_CHANNEL.exec(key);
      const legacy = LEGACY_CHANNEL.exec(key);
      const match = legacy ?? (dated && dated[2] < oldest ? dated : null);
      if (!match) continue;
      try {
        await deleteLiveActivityChannel(config, match[1] as "production" | "sandbox", channel);
        delete config.channels[key];
        if (legacy) console.warn(`[apns] reclaimed legacy window channel ${key}`);
      } catch (error) { console.warn("[apns] channel cleanup", error); }
    }
  }
  const suffixes = await requiredChannelSuffixes(now);
  for (const environment of ["production", "sandbox"] as const) {
    for (const suffix of suffixes) {
      const key = `${environment}:${suffix}`;
      if (config.channels[key]) continue;
      if (Object.keys(config.channels).filter(k => k.startsWith(`${environment}:`)).length >= MAX_CHANNELS_PER_ENVIRONMENT) continue;
      try {
        config.channels[key] = await createLiveActivityChannel(config, environment);
      } catch (error) {
        errors.push({ environment, message: `${key}: ${error instanceof Error ? error.message : String(error)}` });
      }
    }
  }
  const value = JSON.stringify(config.channels);
  await db.siteSetting.upsert({ where: { key: "apns.channels" }, create: { key: "apns.channels", value }, update: { value } });
  return { errors, configured: true };
}

let lastDayCheck = 0;
export async function ensureDayChannels(now = Date.now()) {
  if (now - lastDayCheck < 60_000) return;
  await withApnsConfigLock(async db => {
    if (now - lastDayCheck < 60_000) return;
    const { errors, configured } = await provisionChannels(db, now, true);
    if (!configured) return;
    for (const error of errors) console.warn("[apns] channel provisioning", error.message);
    lastDayCheck = now;
  });
}

/** Keep existing IDs stable. Retry only missing channels after a partial failure. */
export async function ensureApnsChannels(now = Date.now()) {
  return withApnsConfigLock(async db => {
    const { errors } = await provisionChannels(db, now, false);
    return { ...await getApnsConfig(db), channelErrors: errors };
  });
}
