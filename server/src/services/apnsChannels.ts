import { LIVE_ACTIVITY_WINDOWS } from "./liveActivityWindows";
import { createLiveActivityChannel, deleteLiveActivityChannel } from "./apnsClient";
import { getApnsConfig, withApnsConfigLock } from "./apnsConfig";

export function schoolDate(now = Date.now()) {
  return new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
}

export function dayChannelDates(now = Date.now()) {
  return [schoolDate(now), schoolDate(now + 86400_000)];
}

let lastDayCheck = 0;
export async function ensureDayChannels(now = Date.now()) {
  if (now - lastDayCheck < 60_000) return;
  await withApnsConfigLock(async db => {
    if (now - lastDayCheck < 60_000) return;
    const config = await getApnsConfig(db);
    if (!config.configured) return;
    const oldest = schoolDate(now - 86400_000);
    for (const [key, channel] of Object.entries(config.channels)) {
      const match = /^(production|sandbox):cpu-day:(\d{4}-\d{2}-\d{2})$/.exec(key);
      if (match && match[2] < oldest) {
        try {
          await deleteLiveActivityChannel(config, match[1] as "production" | "sandbox", channel);
          delete config.channels[key];
        } catch (error) { console.warn("[apns] day channel cleanup", error); }
      }
    }
    for (const environment of ["production", "sandbox"] as const) {
      for (const date of dayChannelDates(now)) {
        const key = `${environment}:cpu-day:${date}`;
        if (config.channels[key]) continue;
        if (Object.keys(config.channels).filter(k => k.startsWith(`${environment}:`)).length >= 9000) continue;
        try { config.channels[key] = await createLiveActivityChannel(config, environment); }
        catch (error) { console.warn("[apns] day channel provisioning", error); }
      }
    }
    const value = JSON.stringify(config.channels);
    await db.siteSetting.upsert({ where: { key: "apns.channels" }, create: { key: "apns.channels", value }, update: { value } });
    lastDayCheck = now;
  });
}

/** Keep existing IDs stable. Retry only missing environments after a partial failure. */
export async function ensureApnsChannels() {
  return withApnsConfigLock(async (db) => {
    const config = await getApnsConfig(db);
    const errors: Array<{ environment: string; message: string }> = [];
    if (!config.configured) return { ...config, channelErrors: errors };
    await Promise.all(["production", "sandbox"].flatMap(environment => LIVE_ACTIVITY_WINDOWS.map(async window => {
      const key = `${environment}:cpu-${window.id}`;
      if (config.channels[key]) return;
      try {
        config.channels[key] = await createLiveActivityChannel(config, environment as "production" | "sandbox");
      } catch (error) {
        errors.push({ environment, message: `${key}: ${error instanceof Error ? error.message : String(error)}` });
      }
    })));
    const value = JSON.stringify(config.channels);
    await db.siteSetting.upsert({ where: { key: "apns.channels" }, create: { key: "apns.channels", value }, update: { value } });
    return { ...await getApnsConfig(db), channelErrors: errors };
  });
}
