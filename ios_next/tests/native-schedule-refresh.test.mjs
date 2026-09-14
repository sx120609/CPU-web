import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const sourceURL = new URL('../CpuTime/CpuTime/NativeScheduleView.swift', import.meta.url);

test('native schedule owns a vertical refreshable scroll view', async () => {
  const source = await readFile(sourceURL, 'utf8');
  const storeSource = await readFile(new URL('../CpuTime/CpuTime/NativeScheduleStore.swift', import.meta.url), 'utf8');
  assert.match(source, /private struct NativeScheduleRefreshScrollView<Content: View>: View/);
  assert.match(source, /ScrollView\(\.vertical, showsIndicators: false\)/);
  assert.match(source, /\.scrollBounceBehavior\(\.always, axes: \.vertical\)/);
  assert.match(source, /\.refreshable\s*\{\s*await onRefresh\(\)/s);
  assert.match(source, /NativeScheduleRefreshScrollView\(onRefresh:\s*\{\s*await store\.refresh\(\)/s);
  assert.match(storeSource, /public func refresh\(\) async \{\s*await load\(semester: selectedSemester, week: selectedWeek, force: true\)/s);
});
