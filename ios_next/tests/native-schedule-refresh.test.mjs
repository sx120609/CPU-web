import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const sourceURL = new URL('../CpuTime/CpuTime/NativeScheduleView.swift', import.meta.url);

test('native schedule owns a UIKit pull-to-refresh scroll view', async () => {
  const source = await readFile(sourceURL, 'utf8');
  const storeSource = await readFile(new URL('../CpuTime/CpuTime/NativeScheduleStore.swift', import.meta.url), 'utf8');
  assert.match(source, /private struct NativeScheduleRefreshScrollView<Content: View>: UIViewControllerRepresentable/);
  assert.match(source, /private let scrollView = UIScrollView\(\)/);
  assert.match(source, /private let refreshControl = UIRefreshControl\(\)/);
  assert.match(source, /scrollView\.alwaysBounceVertical = true/);
  assert.match(source, /scrollView\.delegate = self/);
  assert.match(source, /scrollViewDidEndDragging\(_ scrollView: UIScrollView/);
  assert.match(source, /refreshControl\.beginRefreshing\(\)/);
  assert.match(source, /scrollView\.refreshControl = refreshControl/);
  assert.match(source, /refreshControl\.addTarget\(self, action: #selector\(didPull\(_:\)\), for: \.valueChanged\)/);
  assert.match(source, /refreshControl\.endRefreshing\(\)/);
  assert.match(source, /NativeScheduleRefreshScrollView\(onRefresh:\s*\{\s*await store\.refresh\(\)/s);
  assert.match(storeSource, /public func refresh\(\) async \{\s*await load\(semester: selectedSemester, week: selectedWeek, force: true\)/s);
});
