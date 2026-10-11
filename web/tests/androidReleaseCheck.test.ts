import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchAndroidRelease } from '../src/utils/androidReleaseCheck';

const release = (versionCode: number) => ({ packageName: 'cn.lizmt.cpuweb', versionCode, versionName: '4.0.7', fileName: `CPU-Web-Android-V${versionCode}.apk` });
test('checks the live manifest without HTTP cache and sees a later release', async () => {
  let code = 47;
  const fetcher = (async (url, options) => {
    assert.equal(url, '/api/site/downloads/android');
    assert.equal(options?.cache, 'no-store');
    return new Response(JSON.stringify({ code: 0, data: release(code) }));
  }) as typeof fetch;
  assert.equal((await fetchAndroidRelease(fetcher)).versionCode, 47);
  code = 48;
  assert.equal((await fetchAndroidRelease(fetcher)).versionCode, 48);
});
test('rejects failures and malformed manifests rather than claiming the installed app is latest', async () => {
  for (const value of [{...release(47),packageName:'other.app'}, {...release(47),versionCode:'47'}, {...release(47),fileName:'wrong.apk'}, {...release(47),versionName:null}]) {
    await assert.rejects(fetchAndroidRelease((async () => new Response(JSON.stringify({code:0,data:value}))) as typeof fetch));
  }
  await assert.rejects(fetchAndroidRelease((async () => new Response('', {status:503})) as typeof fetch));
});
test('reads the minimum supported version and ignores an inconsistent floor', async () => {
  const read = (value: object) => fetchAndroidRelease((async () => new Response(JSON.stringify({ code: 0, data: value }))) as typeof fetch);
  assert.equal((await read({ ...release(59), minSupportedVersionCode: 59 })).minSupportedVersionCode, 59);
  assert.equal((await read(release(59))).minSupportedVersionCode, 0);
  assert.equal((await read({ ...release(59), minSupportedVersionCode: 60 })).minSupportedVersionCode, 0);
  assert.equal((await read({ ...release(59), minSupportedVersionCode: '59' })).minSupportedVersionCode, 0);
});
