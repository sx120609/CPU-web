import policy from "../releases/android-update-policy.json";
import { prisma } from "../prisma";
import { publishedAndroidRelease } from "./androidRelease";

export type AndroidUpdateRequirement = {
  minimumVersionCode: number;
  startsAt: string;
  deadlineAt: string;
  message: string;
};

export const ANDROID_UPDATE_START_KEY = `android-update.${policy.campaign}.starts-at`;

if (!/^[a-z0-9-]+$/.test(policy.campaign)
  || !Number.isSafeInteger(policy.minimumVersionCode) || policy.minimumVersionCode < 1
  || policy.minimumVersionCode > publishedAndroidRelease.versionCode
  || !Number.isSafeInteger(policy.gracePeriodHours) || policy.gracePeriodHours < 1
  || !policy.message.trim()) {
  throw new Error("安卓强制更新规则无效");
}

async function ensureStart(key: string, proposedStart: string): Promise<string> {
  // INSERT ON CONFLICT DO NOTHING gives concurrent instances the same start
  // without overwriting the persisted timestamp on restarts/deployments.
  await prisma.siteSetting.createMany({ data: [{ key, value: proposedStart }], skipDuplicates: true });
  const row = await prisma.siteSetting.findUniqueOrThrow({ where: { key } });
  return row.value;
}

export function createAndroidUpdateRequirementLoader(dependencies = { ensureStart, now: Date.now }) {
  let pending: Promise<AndroidUpdateRequirement> | null = null;
  return () => {
    if (!pending) {
      pending = dependencies.ensureStart(ANDROID_UPDATE_START_KEY, new Date(dependencies.now()).toISOString())
        .then(startsAt => {
          const start = Date.parse(startsAt);
          if (!Number.isFinite(start)) throw new Error("安卓更新起始时间无效");
          return {
            minimumVersionCode: policy.minimumVersionCode,
            startsAt: new Date(start).toISOString(),
            deadlineAt: new Date(start + policy.gracePeriodHours * 3_600_000).toISOString(),
            message: policy.message,
          };
        }).catch(error => { pending = null; throw error; });
    }
    return pending;
  };
}

export const getAndroidUpdateRequirement = createAndroidUpdateRequirementLoader();
