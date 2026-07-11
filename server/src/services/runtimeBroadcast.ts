import { publishRedisBroadcast, type RedisBroadcastMessage } from "./redis";

export async function broadcastSiteSettingsReload() {
  await publishRuntimeMessage({ type: "site-settings-reload", issuedAt: Date.now() });
}

export async function broadcastStorageConfigReload() {
  await publishRuntimeMessage({ type: "storage-config-reload", issuedAt: Date.now() });
}

export async function broadcastJwxtAgentConfigReload() {
  await publishRuntimeMessage({ type: "jwxt-agent-config-reload", issuedAt: Date.now() });
}

async function publishRuntimeMessage(message: RedisBroadcastMessage) {
  await publishRedisBroadcast(message).catch(() => false);
}
