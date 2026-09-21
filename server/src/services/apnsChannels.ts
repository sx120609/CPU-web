import { createLiveActivityChannel } from "./apnsClient";
import { getApnsConfig, withApnsConfigLock } from "./apnsConfig";

/** Keep existing IDs stable. Retry only missing environments after a partial failure. */
export async function ensureApnsChannels() {
  return withApnsConfigLock(async (db) => {
    const config = await getApnsConfig(db);
    const errors: Array<{ environment: string; message: string }> = [];
    if (!config.configured) return { ...config, channelErrors: errors };
    for (const environment of ["production", "sandbox"] as const) {
      const key = `${environment}:cpu`;
      if (config.channels[key]) continue;
      try {
        config.channels[key] = await createLiveActivityChannel(config, environment);
      } catch (error) {
        errors.push({ environment, message: error instanceof Error ? error.message : String(error) });
      }
    }
    const value = JSON.stringify(config.channels);
    await db.siteSetting.upsert({ where: { key: "apns.channels" }, create: { key: "apns.channels", value }, update: { value } });
    return { ...await getApnsConfig(db), channelErrors: errors };
  });
}
