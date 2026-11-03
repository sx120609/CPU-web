import { onRedisBroadcast, startRedisSubscriptions } from "./redis";
import { loadFeatures } from "./siteSettings";
import { loadSchoolModuleOverrides } from "../schools/modules";
import { resetMediaStorageRuntimeCaches } from "./mediaStorage";
import { resetOneDriveChinaTransientCaches } from "./oneDriveChina";
import { loadStorageConfig } from "./storageConfig";
import { loadJwxtAgentRuntimeConfig } from "./jwxtAgentConfig";

let runtimeSyncStarted = false;

export function startRuntimeSync() {
  if (runtimeSyncStarted) return;
  runtimeSyncStarted = true;
  onRedisBroadcast("site-settings-reload", () => {
    void reloadSiteSettings();
  });
  onRedisBroadcast("storage-config-reload", () => {
    void reloadStorageConfig();
  });
  onRedisBroadcast("jwxt-agent-config-reload", () => {
    void loadJwxtAgentRuntimeConfig().catch((error) => {
      console.warn("[runtime-sync] reload jwxt agent config failed", error);
    });
  });
  void startRedisSubscriptions();
}

async function reloadSiteSettings() {
  await Promise.all([
    loadFeatures().catch((error) => {
      console.warn("[runtime-sync] reload site settings failed", error);
    }),
    loadSchoolModuleOverrides().catch((error) => {
      console.warn("[runtime-sync] reload school modules failed", error);
    }),
  ]);
}

async function reloadStorageConfig() {
  resetMediaStorageRuntimeCaches();
  resetOneDriveChinaTransientCaches();
  await loadStorageConfig().catch((error) => {
    console.warn("[runtime-sync] reload storage config failed", error);
  });
}
