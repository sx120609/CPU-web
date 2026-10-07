import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const defaultRoot = fileURLToPath(new URL('../..', import.meta.url));
const root = process.env.CPU_REPO_ROOT || defaultRoot;
const read = path => readFile(`${root}/${path}`, 'utf8');

// iOS kills the app, with no alert, the moment it reaches one of these without
// its purpose string. None of them is asked for by Swift code here, so nothing
// fails to compile when a key goes missing:
//   - camera and microphone: a web `<input type="file">` offers 拍照或录像;
//   - adding to Photos: 存储图像 in the share sheet, for the timetable image and
//     for pictures shared from a page.
const required = [
  'NSCameraUsageDescription',
  'NSMicrophoneUsageDescription',
  'NSPhotoLibraryAddUsageDescription',
  'NSCalendarsUsageDescription',
  'NSCalendarsFullAccessUsageDescription',
];

test('the iPhone app declares a purpose string for every capability it can reach', async () => {
  const project = await read('ios_next/CpuTime/CpuTime.xcodeproj/project.pbxproj');
  // The app target's two configurations are the ones that name the app plist.
  const blocks = project.split('buildSettings = {').slice(1)
    .map(block => block.slice(0, block.indexOf('\n\t\t\t};')))
    .filter(block => block.includes('INFOPLIST_FILE = AppInfo.plist;'));
  assert.equal(blocks.length, 2, 'Debug and Release of the app target');
  for (const block of blocks) {
    for (const key of required) {
      const match = block.match(new RegExp(`INFOPLIST_KEY_${key} = "([^"]*)";`));
      assert.ok(match, `missing ${key}`);
      assert.ok(match[1].trim().length >= 8, `${key} must say what the access is for`);
    }
  }
});

test('the site still has the pickers that make the camera reachable', async () => {
  // When this stops being true the keys above can be reconsidered, not before.
  const lostFound = await read('web/src/views/lostFound/Index.vue');
  assert.match(lostFound, /<input type="file" accept="image\/\*"/);
});

test('the Live Activity refresh task is allowed to be scheduled', async () => {
  // BGTaskScheduler.submit throws for an app-refresh request when the app does
  // not declare the fetch background mode; the app catches that and the
  // fallback that ends an expired Live Activity never runs.
  const plist = await read('ios_next/CpuTime/AppInfo.plist');
  assert.match(plist, /<key>UIBackgroundModes<\/key>\s*<array>[^]*?<string>fetch<\/string>[^]*?<\/array>/);
  const identifier = (await read('ios_next/CpuTime/CpuTime/LiveActivityBackgroundRefresh.swift'))
    .match(/static let identifier = "([^"]+)"/)[1];
  assert.ok(plist.includes(`<string>${identifier}</string>`), 'the task identifier must be permitted');
});

test('both web views hand downloads to the downloader', async () => {
  for (const file of ['HybridWebView.swift', 'LegacyWebView.swift']) {
    const source = await read(`ios_next/CpuTime/CpuTime/${file}`);
    assert.match(source, /WebFileDownloader\.takes\(\w+\)[^]*?decisionHandler\(\.download\)/, `${file} action policy`);
    assert.match(source, /navigationAction: WKNavigationAction, didBecome download: WKDownload/, file);
    assert.match(source, /navigationResponse: WKNavigationResponse, didBecome download: WKDownload/, file);
  }
  const downloader = await read('ios_next/CpuTime/CpuTime/WebFileDownloader.swift');
  // An iPad raises an exception for a share sheet with no popover source.
  assert.match(downloader, /popoverPresentationController[^]*?sourceView = /);
});
