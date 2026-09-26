import { setTimeout as delay } from 'node:timers/promises';
import { getMediaStorageRuntimeConfig } from './storageConfig';
import { resolveTencentCosPublicUrl } from './tencentCos';

export async function purgeAccountMediaCaches(paths: string[]) {
  if (!paths.length) return;
  const runtime = await getMediaStorageRuntimeConfig();
  const base = runtime.tencentCosPublicBaseUrl || runtime.legacyTencentCosPublicBaseUrl;
  if (!base || /\.myqcloud\.com$/i.test(new URL(base).hostname)) return;
  const secretId = runtime.tencentCosSecretId.trim() || runtime.legacyTencentCosSecretId.trim();
  const secretKey = runtime.tencentCosSecretKey.trim() || runtime.legacyTencentCosSecretKey.trim();
  if (!secretId || !secretKey) throw new Error('CDN purge credentials unavailable');
  // 仅在注销账号需要刷新 CDN 时才加载腾讯云 SDK，避免拖慢每个进程的启动。
  const { cdn } = await import('tencentcloud-sdk-nodejs-cdn');
  const client = new cdn.v20180606.Client({
    credential: { secretId, secretKey }, region: '',
    profile: { signMethod: 'TC3-HMAC-SHA256', httpProfile: { endpoint: 'cdn.tencentcloudapi.com', reqMethod: 'POST', reqTimeout: 20 } },
  });
  for (let offset = 0; offset < paths.length; offset += 20) {
    const urls = await Promise.all(paths.slice(offset, offset + 20).map(resolveTencentCosPublicUrl));
    const submitted = await client.PurgeUrlsCache({ Urls: urls, UrlEncode: true });
    if (!submitted.TaskId) throw new Error('CDN purge receipt missing');
    let complete = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      const result = await client.DescribePurgeTasks({ TaskId: submitted.TaskId, Limit: 20 });
      if (result.PurgeLogs?.some((row) => row.Status === 'fail')) throw new Error('CDN purge failed');
      if (result.PurgeLogs?.length === urls.length && result.PurgeLogs.every((row) => row.Status === 'done')) { complete = true; break; }
      await delay(10_000);
    }
    if (!complete) throw new Error('CDN purge not yet confirmed');
  }
}
