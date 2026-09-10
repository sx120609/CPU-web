import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../CPUWatch/WatchCalendarView.swift", import.meta.url), "utf8");

test("Watch calendar renders one day at a time and changes dates with a horizontal swipe", () => {
  assert.doesNotMatch(source, /TabView\(selection:/);
  assert.doesNotMatch(source, /ForEach\(days\)/);
  assert.match(source, /DragGesture\(minimumDistance:/);
  assert.match(source, /moveDay\(by:/);
  assert.match(source, /WatchDaySchedulePage\(/);
  assert.match(source, /day: selectedDay\.date/);
});

test("Watch calendar keeps a vertically scrolling fixed-period timeline", () => {
  assert.match(source, /ScrollView\(\.vertical\)/);
  assert.match(source, /snapshot\.displayPeriods/);
  assert.doesNotMatch(source, /start: "08:00"/);
  assert.doesNotMatch(source, /WatchPeriod\.schoolDay/);
  assert.match(source, /course\.endPeriod - start \+ 1|let span = end - start \+ 1/);
});

test("Watch period gutter renders each complete start and end time", () => {
  assert.match(source, /Text\(period\.startTime\)/);
  assert.match(source, /Text\(period\.endTime\)/);
  assert.match(source, /monospacedDigit\(\)/);
  assert.match(source, /lineLimit\(1\)/);
  assert.match(source, /minimumScaleFactor\(/);
});

test("horizontal day swipes suppress course detail navigation without replacing vertical scrolling", () => {
  assert.match(source, /@State private var suppressCourseSelection = false/);
  assert.match(source, /DragGesture\(minimumDistance:[\s\S]*?\.onChanged/);
  assert.match(source, /guard !suppressCourseSelection else \{ return \}/);
  assert.match(source, /Button \{ openCourse\(course\) \}/);
  assert.match(source, /navigationDestination\(isPresented: courseDetailPresented\)/);
  assert.doesNotMatch(source, /NavigationLink \{\s*WatchCourseDetailView/);
});
