export type AndroidReleaseInfo = { versionCode: number; versionName: string; fileName: string; minSupportedVersionCode: number };

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
    // A missing or inconsistent floor never blocks anyone; it only turns the prompt back into a reminder.
    const floor = value.minSupportedVersionCode;
    const minSupportedVersionCode = Number.isSafeInteger(floor) && floor >= 1 && floor <= value.versionCode ? floor : 0;
    return { versionCode: value.versionCode, versionName: value.versionName, fileName: value.fileName, minSupportedVersionCode };
  } finally {
    clearTimeout(timer);
  }
}
