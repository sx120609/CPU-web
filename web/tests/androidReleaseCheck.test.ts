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

test('reads the shared update deadline and server clock and rejects invalid enforcement metadata', async () => {
  const updateRequirement = {
    minimumVersionCode: 47, startsAt: '2026-10-13T08:00:00Z',
    deadlineAt: '2026-10-16T08:00:00Z', message: '安全更新',
  };
  const data = { ...release(47), updateRequirement, serverTime: '2026-10-14T08:00:00Z' };
  const read = (value: unknown) => fetchAndroidRelease((async () => new Response(JSON.stringify({ code: 0, data: value }))) as typeof fetch);
  assert.deepEqual((await read(data)).updateRequirement, updateRequirement);
  assert.equal((await read(data)).serverTime, data.serverTime);
  for (const change of [
    { minimumVersionCode: 48 }, { minimumVersionCode: 0 }, { minimumVersionCode: '47' },
    { startsAt: 'invalid' }, { startsAt: 42 }, { deadlineAt: 'invalid' },
    { deadlineAt: updateRequirement.startsAt }, { message: '' },
  ]) await assert.rejects(read({ ...data, updateRequirement: { ...updateRequirement, ...change } }));
  await assert.rejects(read({ ...data, serverTime: 'invalid' }));
  await assert.rejects(read({ ...data, serverTime: undefined }));
  await assert.rejects(read({ ...data, updateRequirement: null }));
});
