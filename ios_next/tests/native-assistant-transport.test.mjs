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
