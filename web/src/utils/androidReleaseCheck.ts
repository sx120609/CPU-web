import type { AndroidUpdateRequirement } from './androidUpdatePolicy';

export type AndroidReleaseInfo = {
  versionCode: number; versionName: string; fileName: string;
  updateRequirement?: AndroidUpdateRequirement;
  serverTime?: string;
};

/** Read the live release; a long-lived WebView must not rely on its bundled version. */
export async function fetchAndroidRelease(fetcher: typeof fetch = fetch): Promise<AndroidReleaseInfo> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetcher('/api/site/downloads/android', { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error('更新信息暂时不可用');
    const payload = await response.json();
    const value = payload?.data;
    if (payload?.code !== 0 || value?.packageName !== 'cn.lizmt.cpuweb'
      || !Number.isSafeInteger(value.versionCode) || value.versionCode < 1
      || typeof value.versionName !== 'string' || !/^\d+\.\d+\.\d+$/.test(value.versionName)
      || value.fileName !== `CPU-Web-Android-V${value.versionCode}.apk`) {
      throw new Error('更新信息无效');
    }
    const requirement = value.updateRequirement;
    if (requirement !== undefined && (
      !requirement || !Number.isSafeInteger(requirement.minimumVersionCode)
      || requirement.minimumVersionCode < 1 || requirement.minimumVersionCode > value.versionCode
      || typeof requirement.startsAt !== 'string' || !Number.isFinite(Date.parse(requirement.startsAt))
      || typeof requirement.deadlineAt !== 'string' || !Number.isFinite(Date.parse(requirement.deadlineAt))
      || Date.parse(requirement.deadlineAt) <= Date.parse(requirement.startsAt)
      || typeof requirement.message !== 'string' || !requirement.message.trim()
      || typeof value.serverTime !== 'string' || !Number.isFinite(Date.parse(value.serverTime))
    )) throw new Error('更新期限信息无效');
    return {
      versionCode: value.versionCode, versionName: value.versionName, fileName: value.fileName,
      ...(requirement !== undefined ? { updateRequirement: requirement, serverTime: value.serverTime } : {}),
    };
  } finally {
    clearTimeout(timer);
  }
}
