import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const defaultRoot = fileURLToPath(new URL('../..', import.meta.url));
const root = process.env.CPU_REPO_ROOT || defaultRoot;
const read = path => readFile(`${root}/${path}`, 'utf8');
const source = name => read(`ios_next/CpuTime/CpuTime/${name}.swift`);

// The iPad layout: one top bar with the tabs in it, grids that fill the
// window, and a side column beside the day and month views. See
// ios_next/docs/ipad.md; the arithmetic is checked by scripts/check-pad-layout.sh.

test('the app is built for iPad, in every orientation and any window size', async () => {
  const project = await read('ios_next/CpuTime/CpuTime.xcodeproj/project.pbxproj');
  const blocks = project.split('buildSettings = {').slice(1)
    .map(block => block.slice(0, block.indexOf('\n\t\t\t};')))
    .filter(block => block.includes('INFOPLIST_FILE = AppInfo.plist;'));
  assert.equal(blocks.length, 2, 'Debug and Release of the app target');
  for (const block of blocks) {
    assert.match(block, /TARGETED_DEVICE_FAMILY = "1,2";/);
    const orientations = block.match(/INFOPLIST_KEY_UISupportedInterfaceOrientations_iPad = "([^"]*)";/)?.[1] ?? '';
    // Split View and Stage Manager need all four and no full-screen requirement.
    for (const orientation of ['Portrait', 'PortraitUpsideDown', 'LandscapeLeft', 'LandscapeRight']) {
      assert.ok(orientations.split(' ').includes(`UIInterfaceOrientation${orientation}`), `iPad ${orientation}`);
    }
    assert.doesNotMatch(block, /UIRequiresFullScreen/);
  }
});

test('on an iPad the top bar carries the tabs and the system tab bar is hidden', async () => {
  const shell = await source('ContentView');
  // iPad and regular width only: a narrow split gets the phone's shell back.
  assert.match(shell, /UIDevice\.current\.userInterfaceIdiom == \.pad && horizontal == \.regular/);
  assert.match(shell, /tabs: padChrome \? selection : nil/);
  assert.match(shell, /NativePadTabStrip\(selection: tabs\)/);
  // Every tab hides the system bar, the native timetable included.
  assert.equal(shell.match(/hidesTabBar: padChrome/g)?.length, 4, 'the four web tabs');
  assert.match(shell, /\.toolbar\(padChrome \? \.hidden : \.visible, for: \.tabBar\)/);
  // The timetable has no top bar of its own on a phone.
  assert.match(shell, /if shell\.selectedTab == \.schedule \{ return padChrome \}/);
});

test('the timetable fills a large window and gains a side column', async () => {
  const view = await source('NativeScheduleView');
  // Stretching needs a window regular both ways; the chosen row height is the floor.
  assert.match(view, /horizontalSizeClass == \.regular && verticalSizeClass == \.regular && viewport\.height > 0/);
  assert.match(view, /SchedulePadLayout\.stretchedRowHeight\(\s*base: base/);
  // A share image is drawn at the chosen height whatever the window is.
  assert.match(view, /rowHeight: isStatic \? baseWeekRowHeight : weekRowHeight/);
  assert.match(view, /compactCards: false,\s*rowHeight: baseWeekRowHeight/);
  assert.match(view, /SchedulePadLayout\.sideColumnWidth\(contentWidth:/);
  assert.match(view, /SchedulePadLayout\.monthSideColumnWidth\(contentWidth:/);
  assert.match(view, /ScheduleMiniMonth\(/);
  // The background preview is a miniature of the phone layout.
  assert.match(view, /viewport\.height > 0 && !isBackgroundPreview/);
});

test('long sheets are pages on an iPad', async () => {
  const geometry = await source('WindowGeometry');
  assert.match(geometry, /func padPageSheet\(\)[\s\S]*presentationSizing\(\.page\)/);
  const view = await source('NativeScheduleView');
  assert.ok((view.match(/\.padPageSheet\(\)/g) ?? []).length >= 10);
});
