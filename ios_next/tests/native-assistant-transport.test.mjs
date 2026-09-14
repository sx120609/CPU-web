import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../CpuTime/CpuTime/', import.meta.url);
const read = (name) => readFile(new URL(name, root), 'utf8');

test('native assistant stream is independent of the navigated Web route', async () => {
  const swift = await read('HybridWebView.swift');
  assert.match(swift, /httpCookieStore\.getAllCookies/);
  assert.match(swift, /URLSession\.shared\.bytes\(for: request\)/);
  assert.match(swift, /\/api\/search\/assistant\/stream/);
  assert.match(swift, /nativeAssistantStreamViaWebView/);
  assert.match(swift, /X-CSRF-Token/);
});

test('a partial native assistant answer is retained after stream failure', async () => {
  const swift = await read('NativeAssistantView.swift');
  assert.match(swift, /回答未完成，可重新提问/);
  assert.match(swift, /回答已中断，可重新提问/);
  assert.match(swift, /!self\.messages\[index\]\.content\.trimmingCharacters/);
});

test('assistant account changes are debounced and observe the complete auth state', async () => {
  const view = await read('NativeAssistantView.swift');
  assert.match(view, /private var accountChangeTask: Task<Void, Never>\?/);
  assert.match(view, /try\? await Task\.sleep\(nanoseconds: 450_000_000\)/);
  assert.match(view, /private func applyConfirmedAccountChange\(using session: HybridWebViewStore\)/);
  assert.match(view, /\.onChange\(of: session\.authState\)/);
  assert.match(view, /Task \{ @MainActor \[weak self, session\] in/);
  assert.doesNotMatch(view, /\.onDisappear\s*\{[^}]*cancelStream/s);
});

test('assistant composer remeasures after its width changes', async () => {
  const view = await read('NativeAssistantView.swift');
  assert.match(view, /private final class NativeAssistantMeasuringTextView: UITextView/);
  assert.match(view, /view\.onLayout = \{ \[weak coordinator = context\.coordinator\]/);
  assert.match(view, /view\.textContainer\.size = CGSize\(width: availableWidth/);
});
