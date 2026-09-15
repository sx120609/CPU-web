import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const sourceURL = new URL('../CpuTime/CpuTime/NativeScheduleView.swift', import.meta.url);

test('native schedule keeps vertical scrolling native and exposes refresh in the overflow menu', async () => {
  const source = await readFile(sourceURL, 'utf8');
  const storeSource = await readFile(new URL('../CpuTime/CpuTime/NativeScheduleStore.swift', import.meta.url), 'utf8');
  assert.match(source, /ScrollView\(\.vertical\)/);
  assert.match(source, /\.scrollBounceBehavior\(\.basedOnSize, axes: \.vertical\)/);
  assert.match(source, /Button\("刷新课表", systemImage: "arrow\.clockwise"\)/);
  assert.match(source, /TabView\(selection: \$weekPageSelection\)/);
  assert.match(source, /TabView\(selection: \$dayPageSelection\)/);
  assert.doesNotMatch(source, /NativeScheduleRefreshScrollView\(onRefresh:/);
  assert.match(storeSource, /public func refresh\(\) async \{\s*await load\(semester: selectedSemester, week: selectedWeek, force: true\)/s);
});
