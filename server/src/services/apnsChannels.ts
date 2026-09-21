import { LIVE_ACTIVITY_WINDOWS } from "./liveActivityWindows";
import { createLiveActivityChannel } from "./apnsClient";
import { getApnsConfig, withApnsConfigLock } from "./apnsConfig";

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
