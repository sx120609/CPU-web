import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const defaultRoot = fileURLToPath(new URL('../..', import.meta.url));
const root = process.env.CPU_REPO_ROOT || defaultRoot;
const read = path => readFile(`${root}/${path}`, 'utf8');
const app = 'ios_next/CpuTime/CpuTime';

// Several schools share the site (docs/school-onboarding.md). The native login
// page picks the school and handles a school's scan verification itself; the
// grids take the number of periods from the timetable (NJMU has 15).

test('native login asks for the school list, switches schools and opts into native scan verification', async () => {
  const web = await read(`${app}/HybridWebView.swift`);
  for (const method of ['nativeLoginSchools', 'nativeChooseSchool', 'nativeMfaPoll', 'nativeMfaRefresh', 'nativeMfaCancel']) {
    assert.match(web, new RegExp(`func ${method}\\(`), method);
  }
  // Without the option the Web keeps its own scan dialog, hidden behind the gate.
  assert.match(web, /nativeSsoLogin\(username, password, captcha, remember, \{nativeMfa: true\}\)/);

  const gate = await read(`${app}/ContentView.swift`);
  assert.match(gate, /startMfa\(response\)/);
  assert.match(gate, /PHPhotoLibrary\.requestAuthorization\(for: \.addOnly\)/);
  assert.match(gate, /"登录\\\(brandName\)，继续查看你的校园信息"/);
  assert.doesNotMatch(gate, /登录药大拾间，继续/);
  assert.doesNotMatch(gate, /正在进入药大拾间/);
});

test('grids, editors and agenda rows follow the timetable periods instead of a fixed twelve', async () => {
  const view = await read(`${app}/NativeScheduleView.swift`);
  assert.match(view, /static var all: \[ScheduleSlot\] \{\n\s+let periods = timetable\?\.latestSnapshot\?\.periods/);
  assert.match(view, /if !store\.isReadOnly \{ ScheduleSlot\.timetable = store \}/);
  assert.doesNotMatch(view, /static let all = NativeSchedulePeriod\.bundledTimetable/);
  assert.doesNotMatch(view, /static let periodClocks/);
  assert.doesNotMatch(view, /min\(12,/);

  const agenda = await read(`${app}/ScheduleAgendaViews.swift`);
  assert.doesNotMatch(agenda, /bundledTimetable/);

  const store = await read(`${app}/NativeScheduleStore.swift`);
  const changes = store.slice(store.indexOf('private func scheduleChangeEntries'));
  assert.match(changes.slice(0, 800), /latestSnapshot\.map\(\\\.periods\)/);
});

test('widget fallback title names no school', async () => {
  const models = await read('ios_next/CpuTime/CPUWebWidgets/WidgetModels.swift');
  assert.doesNotMatch(models, /药大课表/);
});
