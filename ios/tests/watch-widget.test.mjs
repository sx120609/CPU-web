import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const [project, widget, support, repository, watchApp, appGroup] = await Promise.all([
  readFile(new URL("ios.xcodeproj/project.pbxproj", root), "utf8"),
  readFile(new URL("CPUWatchWidgets/NextCourseWidget.swift", root), "utf8"),
  readFile(new URL("SharedSchedule/WatchWidgetSupport.swift", root), "utf8"),
  readFile(new URL("SharedSchedule/CourseRepository.swift", root), "utf8"),
  readFile(new URL("CPUWatch/CPUWatchApp.swift", root), "utf8"),
  readFile(new URL("SharedConfiguration/AppGroupIdentifier.swift", root), "utf8"),
]);

test("watch widget target is embedded in the Watch app and uses the shared app group", () => {
  assert.match(project, /PBXNativeTarget "CPUWatchWidgets"/);
  assert.match(project, /CPUWatchWidgets\.appex in Embed Watch Extensions/);
  assert.match(project, /PRODUCT_BUNDLE_IDENTIFIER = "\$\(CPU_APP_BUNDLE_IDENTIFIER\)\.watchkitapp\.widgets"/);
  assert.match(project, /CODE_SIGN_ENTITLEMENTS = CPUWatch\/CPUWatch\.entitlements/);
  assert.match(project, /CODE_SIGN_ENTITLEMENTS = CPUWatchWidgets\/CPUWatchWidgets\.entitlements/);
  assert.match(support, /AppGroupIdentifier\.resolved/);
  assert.match(appGroup, /group\.cn\.lizmt\.cpuweb/);
  assert.match(appGroup, /CPUAppGroupIdentifier/);
  assert.match(repository, /sharedCacheURL/);
});

test("watch widget shows the next course in Smart Stack and complication families", () => {
  assert.match(widget, /\.accessoryRectangular/);
  assert.match(widget, /\.accessoryCircular/);
  assert.match(widget, /\.accessoryInline/);
  assert.match(widget, /nextCourseOccurrence\(at:/);
  assert.match(widget, /timelineDates/);
  assert.match(widget, /entry\.timezone/);
  assert.match(widget, /dayOffset\(from:/);
  assert.match(widget, /课程名称|course\.name/);
});

test("Watch app reloads widget timelines after shared schedule state changes", () => {
  assert.match(watchApp, /WidgetCenter\.shared\.reloadTimelines/);
  assert.match(watchApp, /WatchScheduleWidgetConfiguration\.kind/);
});
