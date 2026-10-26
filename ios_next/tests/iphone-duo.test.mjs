import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const defaultRoot = fileURLToPath(new URL('../..', import.meta.url));
const root = process.env.CPU_REPO_ROOT || defaultRoot;
const read = path => readFile(`${root}/${path}`, 'utf8');

// The iPhone Duo resizes the app's window when it is folded or unfolded, from
// 466×678 points closed to 951×669 open. See ios_next/docs/iphone-duo.md.

const appBuildSettings = async () => {
  const project = await read('ios_next/CpuTime/CpuTime.xcodeproj/project.pbxproj');
  const blocks = project.split('buildSettings = {').slice(1)
    .map(block => block.slice(0, block.indexOf('\n\t\t\t};')))
    .filter(block => block.includes('INFOPLIST_FILE = AppInfo.plist;'));
  assert.equal(blocks.length, 2, 'Debug and Release of the app target');
  return blocks;
};

test('the app keeps what the iOS 27 SDK and the iPhone Duo require of it', async () => {
  const plist = await read('ios_next/CpuTime/AppInfo.plist');
  for (const block of await appBuildSettings()) {
    // An app built with the iOS 27 SDK without a launch screen is refused on
    // upload (ITMS-90870).
    assert.match(block, /INFOPLIST_KEY_UILaunchScreen_Generation = YES;/);
    // The open display turned upright is a landscape orientation of the device.
    const orientations = block.match(/INFOPLIST_KEY_UISupportedInterfaceOrientations_iPhone = "([^"]*)";/)?.[1] ?? '';
    for (const orientation of ['Portrait', 'LandscapeLeft', 'LandscapeRight']) {
      assert.ok(orientations.includes(`UIInterfaceOrientation${orientation}`), `iPhone ${orientation}`);
    }
    assert.doesNotMatch(block, /UIRequiresFullScreen/);
  }
  assert.doesNotMatch(plist, /UIRequiresFullScreen/);
});

test('no app code sizes itself by UIScreen.main', async () => {
  // UIScreen.main is one fixed screen. WindowGeometry follows the window.
  const folders = ['CpuTime', 'CPUWebWidgets', 'WatchShared', 'WatchSync'];
  for (const folder of folders) {
    const files = (await readdir(`${root}/ios_next/CpuTime/${folder}`)).filter(name => name.endsWith('.swift'));
    for (const file of files) {
      const code = (await read(`ios_next/CpuTime/${folder}/${file}`))
        .split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
      assert.doesNotMatch(code, /UIScreen\.main/, `${folder}/${file}`);
    }
  }
});

test('the page leaves room for the tab bar only where the tab bar is', async () => {
  const source = await read('ios_next/CpuTime/CpuTime/HybridWebView.swift');
  const base = source.indexOf('html[data-cpu-ios-next] { --cpu-ios-bottom-clearance: 96px; }');
  const clear = source.indexOf('html[data-cpu-ios-next][data-cpu-foot-clear] { --cpu-ios-bottom-clearance: var(--cpu-ios-home-indicator, 0px); }');
  const pushed = source.indexOf('html[data-cpu-ios-next][data-cpu-page-navigation] { --cpu-ios-bottom-clearance: 0px; }');
  assert.ok(base >= 0 && clear > base && pushed > clear, 'a pushed page still wins over a clear foot');
  // The attribute is set again after every load, since a new document starts without it.
  assert.match(source, /fileprivate func didFinish\(url: URL\?\) \{[^}]*applyPageFoot\(\)/);
  assert.match(source, /toggleAttribute\('data-cpu-foot-clear'/);
});

test('a partly folded Duo leaves the fold out of the week and month grids', async () => {
  // The fold is a 40-point division reported only by the iOS 27.1 SDK; the
  // split itself is checked by ios_next/scripts/check-fold-layout.sh.
  const reader = await read('ios_next/CpuTime/CpuTime/ScheduleFoldReader.swift');
  assert.match(reader, /guard #available\(iOS 27\.1, \*\) else \{ return nil \}/);
  assert.match(reader, /reservedRegions\(kind: \.division\)\s*\.filter\(\\\.isActive\)/);
  // Only a fold running down the view; the open display turned upright folds across it.
  assert.match(reader, /\$0\.height > \$0\.width/);

  const schedule = await read('ios_next/CpuTime/CpuTime/NativeScheduleView.swift');
  const weekGrid = schedule.slice(schedule.indexOf('private func weekGrid('), schedule.indexOf('private func foldPages<'));
  assert.equal(weekGrid.match(/foldPages\(dayCount: days\.count/g)?.length, 2, 'classic and styled week grids');
  assert.match(weekGrid, /scheduleRows\([^)]*columns: columns/s);
  assert.match(weekGrid, /styledWeekRows\(result: result, week: week, days: days, columns: columns/);
  // A column's teaching week is worked out from the whole week, so a Sunday
  // shown first still belongs to the week before on either half.
  assert.match(schedule, /shownDays\.firstIndex \{ dayIsToday\(\$0, week: columnWeek\(\$0, week: week, days: days\)/);

  for (const file of ['NativeScheduleMonthView.swift', 'ScheduleStyledMonthView.swift']) {
    const month = await read(`ios_next/CpuTime/CpuTime/${file}`);
    assert.equal(month.match(/ScheduleFoldRow\(count:/g)?.length, 2, `${file}: weekday labels and day rows`);
  }
});

test('the Duo’s upright Dynamic Island gets a countdown that fits it', async () => {
  // Closed or open, the Duo stands the island upright in the status column,
  // about 24 points across: "214:37" on one line was cut to "14:3".
  const widgets = await read('ios_next/CpuTime/CPUWebWidgets/ScheduleWidgets.swift');
  assert.match(widgets, /compactTrailing: \{\s*ScheduleLiveActivityCompactTimer\(state: state\)/);
  assert.match(widgets, /@Environment\(\\\.isDynamicIslandLimitedInWidth\) private var limited/);
  // No fixed width is left on a countdown; each is laid over its longest value.
  assert.doesNotMatch(widgets, /Text\(timerInterval:[^\n]*\n[^\n]*\n?[^\n]*\.frame\(width: \d+/);
  assert.match(widgets, /countdownTemplate\(interval\)\)\s*\.hidden\(\)/);
});
