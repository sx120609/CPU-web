/**
 * 站点功能开关
 *
 * KV 持久化 + 内存缓存。修改后立即更新缓存，公开 API 直接读缓存（高频）。
 *
 * 用途："言论敏感时一键关闭论坛 / 二手 / 课评"。
 * 默认值：全部为 on（即不破坏现有上线体验）。
 */
import { prisma } from "../prisma";

export type FeatureKey = "forum" | "market" | "coursereview" | "electric";

export const ALL_FEATURES: FeatureKey[] = ["forum", "market", "coursereview", "electric"];

const cache: Record<FeatureKey, boolean> = {
  forum: true,
  market: true,
  coursereview: true,
  electric: true,
};

function keyOf(f: FeatureKey) {
  return `feature.${f}`;
}

/** 服务启动时加载一次；之后每次写入会同步更新缓存 */
export async function loadFeatures(): Promise<void> {
  const rows = await prisma.siteSetting.findMany({
    where: { key: { in: ALL_FEATURES.map(keyOf) } },
  });
  for (const r of rows) {
    const f = r.key.replace(/^feature\./, "") as FeatureKey;
    if (ALL_FEATURES.includes(f)) cache[f] = r.value === "on";
  }
}

export function getFeatures(): Record<FeatureKey, boolean> {
  return { ...cache };
}

export function isFeatureOn(f: FeatureKey): boolean {
  return cache[f];
}

export async function setFeature(f: FeatureKey, on: boolean): Promise<void> {
  const value = on ? "on" : "off";
  await prisma.siteSetting.upsert({
    where: { key: keyOf(f) },
    update: { value },
    create: { key: keyOf(f), value },
  });
  cache[f] = on;
}
