import assert from 'node:assert/strict';
import test from 'node:test';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';

const defaultRoot = fileURLToPath(new URL('../..', import.meta.url));
const root = process.env.CPU_REPO_ROOT || defaultRoot;
const read = path => readFile(`${root}/${path}`, 'utf8');

function configuration(project, label) {
  const start = project.indexOf(`/* ${label} */ = {`);
  assert.notEqual(start, -1, `missing ${label}`);
  const open = project.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < project.length; index++) {
    if (project[index] === '{') depth++;
    if (project[index] === '}' && --depth === 0) return project.slice(open, index + 1);
  }
  assert.fail(`unterminated ${label}`);
}

test('watch app and complication belong to the active ios_next project', async () => {
  await Promise.all([
    access(`${root}/ios_next/CpuTime/CPUWatch/CPUWatchApp.swift`, constants.R_OK),
    access(`${root}/ios_next/CpuTime/CPUWatchWidgets/NextCourseWidget.swift`, constants.R_OK),
    access(`${root}/ios_next/CpuTime/WatchShared/ScheduleEnvelope.swift`, constants.R_OK),
    access(`${root}/ios_next/CpuTime/WatchSync/WatchSessionTransport.swift`, constants.R_OK),
  ]);

  const project = await read('ios_next/CpuTime/CpuTime.xcodeproj/project.pbxproj');
  assert.match(project, /PBXNativeTarget "CPUWatch"/);
  assert.match(project, /PBXNativeTarget "CPUWatchWidgets"/);
  assert.match(project, /CPUWatch\.app in Embed Watch Content/);
  assert.match(project, /CPUWatchWidgets\.appex in Embed Watch Extensions/);
});

test('phone hides watch-only controls unless the companion app is installed', async () => {
  const phone = await read('ios_next/CpuTime/CpuTime/PhoneWatchSchedule.swift');
  const content = await read('ios_next/CpuTime/CpuTime/ContentView.swift');
  assert.match(phone, /return connection\.paired && connection\.installed/);
  assert.match(content, /showsWatch: watchSchedule\.showsStatusEntry/);
});

test('watch sync is event driven and bounds background execution', async () => {
  const phone = await read('ios_next/CpuTime/CpuTime/PhoneWatchSchedule.swift');
  const background = await read('ios_next/CpuTime/CPUWatch/WatchBackgroundTaskFinisher.swift');
  assert.doesNotMatch(phone, /scheduledTimer|Timer\.publish|\.periodic\(/);
  assert.match(background, /init\(timeout: Duration = \.seconds\(8\)\)/);
  assert.match(background, /task\.expirationHandler/);
  assert.match(background, /Task\.sleep\(for: timeout\)/);
});

test('sign out clears account-scoped watch data without sending the old snapshot', async () => {
  const store = await read('ios_next/CpuTime/CpuTime/NativeScheduleStore.swift');
  const phone = await read('ios_next/CpuTime/CpuTime/PhoneWatchSchedule.swift');
  const transport = await read('ios_next/CpuTime/WatchSync/WatchSessionTransport.swift');
  assert.match(store, /onWatchReset\?\(\)/);
  assert.match(phone, /coordinator\.clearForAccountChange\(\)/);
  assert.match(transport, /status == \.loginRequired \{ onClear\?\(\) \}/);
});

test('self signing values are configurable and local overrides stay ignored', async () => {
  const config = await read('ios_next/CpuTime/Configurations/SharedSigning.xcconfig');
  const debugConfig = await read('ios_next/CpuTime/Configurations/DebugSigning.xcconfig');
  const project = await read('ios_next/CpuTime/CpuTime.xcodeproj/project.pbxproj');
  const ignore = await read('.gitignore');
  const entitlement = await read('ios_next/CpuTime/CPUWatch/CPUWatch.entitlements');
  assert.match(config, /CPU_APP_BUNDLE_IDENTIFIER/);
  assert.match(config, /CPU_APP_GROUP_IDENTIFIER/);
  assert.doesNotMatch(config, /Signing\.local/);
  assert.match(debugConfig, /#include "SharedSigning\.xcconfig"/);
  assert.match(debugConfig, /#include\? "Signing\.local\.xcconfig"/);
  assert.match(configuration(project, 'Debug configuration for PBXProject "CpuTime"'), /DebugSigning\.xcconfig/);
  assert.match(configuration(project, 'Release configuration for PBXProject "CpuTime"'), /SharedSigning\.xcconfig/);
  assert.match(ignore, /ios_next\/CpuTime\/Configurations\/Signing\.local\.xcconfig/);
  assert.match(entitlement, /\$\(CPU_APP_GROUP_IDENTIFIER\)/);

  for (const target of ['CpuTime', 'CPUWebWidgets', 'CPUWatch', 'CPUWatchWidgets']) {
    const block = configuration(project, `Debug configuration for PBXNativeTarget "${target}"`);
    assert.match(
      block,
      /DEVELOPMENT_TEAM = "\$\(CPU_DEVELOPMENT_TEAM\)";/,
      `${target} Debug must use the shared, locally overridable Team ID`,
    );
  }
});
