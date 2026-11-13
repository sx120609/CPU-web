import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const defaultRoot = fileURLToPath(new URL('../..', import.meta.url));
const root = process.env.CPU_REPO_ROOT || defaultRoot;
const read = path => readFile(`${root}/ios_next/CpuTime/CpuTime/${path}`, 'utf8');

// 一起看的周视图 (并排／合并), the one-time hint over the strip and the 课表怎么用
// sheet. Android and HarmonyOS carry the same three, in the same words.

test('the week view of two timetables is 并排 by default and 合并 on request', async () => {
  const preferences = await read('NativeSchedulePreferences.swift');
  assert.match(preferences, /static let coupleWeekLayout = "nativeSchedule\.coupleWeekLayout"/);
  // Missing or unknown values are 并排.
  assert.match(preferences, /normalizedCoupleWeekLayout\(_ value: String\?\) -> String \{ value == "merged" \? "merged" : "split" \}/);
  assert.match(preferences, /coupleWeekLayout = Self\.normalizedCoupleWeekLayout\(defaults\.string\(forKey: Key\.coupleWeekLayout\)\)/);
  const view = await read('NativeScheduleView.swift');
  // The strip only without 合并; otherwise the week grid, told to draw both people.
  assert.match(view, /if viewMode == \.week, !mergesOverlay, let layer = coupleLayer \{/);
  assert.match(view, /\.environment\(\\\.scheduleCoupleMerged, mergesOverlay && coupleLayer != nil\)/);
  assert.match(view, /guard mergesOverlay, let layer = coupleLayer else \{ return \(mine, \[\]\) \}/);
  assert.match(view, /CoupleRules\.merge\(mine: mine\.map\(piece\), theirs: theirs\.map\(piece\)\)/);
  // The week grid pages by itself again when merged; the strip scrolls itself.
  assert.match(view, /guard viewMode == \.week, coupleLayer == nil \|\| mergesOverlay else \{/);
  assert.match(view, /overlayIsOn && !mergesOverlay \? overlayStripMetrics/);
  for (const file of ['NativeScheduleView.swift', 'ScheduleStyledWeekViews.swift']) {
    const source = await read(file);
    assert.match(source, /if coupleMerged, let owner = block\.owner, let couple \{/, file);
    assert.match(source, /ScheduleCouplePersonTile\(/, file);
  }
  const tile = await read('NativeCoupleTile.swift');
  for (const type of ['ScheduleCouplePersonTile', 'ScheduleCoupleTag', 'ScheduleCoupleNote']) {
    assert.match(tile, new RegExp(`struct ${type}: View`), type);
  }
});

test('the choice is offered in the timetable settings and on the 情侣课表 page, in the agreed words', async () => {
  const guide = await read('ScheduleGuide.swift');
  assert.match(guide, /Picker\("一起看的周视图", selection: \$preferences\.coupleWeekLayout\) \{\s+Text\("并排"\)\.tag\("split"\)\s+Text\("合并"\)\.tag\("merged"\)/);
  assert.ok(guide.includes('并排：每天两栏，左边是你，右边是 TA。合并：两人的课排在同一张周课表里。'));
  // In the settings only while two timetables are shown together.
  assert.match(guide, /if couple\.isActive \|\| !overlayCode\.isEmpty \{\s+ScheduleCoupleWeekLayoutSection\(\)/);
  const settings = await read('NativeWidgetSetupView.swift');
  assert.equal((settings.match(/ScheduleCoupleWeekLayoutSetting\(\)/g) ?? []).length, 2);
  assert.match(await read('NativeCoupleSheet.swift'), /ScheduleCoupleWeekLayoutSection\(\)/);
});

test('the strip explains itself once, with the way back', async () => {
  const guide = await read('ScheduleGuide.swift');
  assert.ok(guide.includes('两人的课并排显示，左右滑动换天。'));
  assert.match(guide, /Button\("改回合并", action: onMerge\)/);
  const view = await read('NativeScheduleView.swift');
  assert.match(view, /@AppStorage\("nativeSchedule\.coupleSplitHintSeen"\) private var coupleSplitHintSeen = false/);
  const hint = view.slice(view.indexOf('if !coupleSplitHintSeen, !isBackgroundPreview {'), view.indexOf('overlayStrip(result, layer: layer)'));
  assert.match(hint, /onMerge: \{\s+coupleSplitHintSeen = true\s+preferences\.coupleWeekLayout = "merged"/);
  assert.match(hint, /onClose: \{[^}]*coupleSplitHintSeen = true/);
});

test('课表怎么用 comes up once per device and again from 更多', async () => {
  const guide = await read('ScheduleGuide.swift');
  assert.match(guide, /static let version = 1/);
  assert.match(guide, /static let seenKey = "nativeSchedule\.guideSeen"/);
  for (const text of ['课表怎么用', '点一下课程', '课表风格', '和 TA 一起看', '换回经典', '已换回', '改回合并', '知道了',
    '课表设置、小组件、日程和共享课表都在“更多”里。']) {
    assert.ok(guide.includes(text), text);
  }
  // 换回经典 only from the minimal style; 和 TA 一起看 only with two timetables.
  assert.match(guide, /if styleSettings\.style == \.minimal \|\| wentClassic \{/);
  assert.match(guide, /if overlayIsOn \{\s+row\("heart\.fill", \.pink, "和 TA 一起看"/);
  const view = await read('NativeScheduleView.swift');
  const present = view.slice(view.indexOf('private func presentGuideIfNeeded()'), view.indexOf('private func checkOverlapNotice()'));
  assert.match(present, /guard guideSeen < ScheduleGuideSheet\.version, !isBackgroundPreview, !isReadOnly, store\.result != nil,/);
  assert.match(present, /guideSeen = ScheduleGuideSheet\.version\s+guidePresented = true/);
  // Never over another sheet.
  for (const state of ['scheduleToolsPresented', 'stylePickerPresented', 'sharingPresented', 'couplePresented', 'courseEditorPresentation == nil']) {
    assert.ok(present.includes(state), state);
  }
  assert.match(view, /scheduleToolRow\("使用指引", detail: "课表怎么用"/);
});
