// Verify worker -> runner -> isolated preload -> rendered verification dialog.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow, ipcMain } = require('electron');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cpu-zhs-verification-'));
app.setPath('userData', profile);
const { TabManager } = require('./dist/electron/tabs.js');
const { ZhihuishuRunner } = require('./dist/zhihuishu-runner.cjs');
const { zhihuishuPage, isAuthorizedZhihuishuRequest } = require('./dist/electron/zhihuishu.js');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  const deadline = Date.now() + 10000;
  while (!await check()) { assert.ok(Date.now() < deadline, 'Verification check timed out'); await pause(50); }
}
let runner, tabs, window;
const deadline = setTimeout(() => { console.error('Verification smoke timeout'); app.exit(1); }, 45000);
app.whenReady().then(async () => {
  runner = new ZhihuishuRunner({ enabled: true, python: process.env.ZHS_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), worker: path.resolve(__dirname, '../server/tests/fixtures/zhihuishu-worker.py') });
  const kinds = new Map();
  ipcMain.handle('zhihuishu:request', (event, action) => {
    if (!isAuthorizedZhihuishuRequest(event, kinds.get(event.sender.id))) return { ok: false };
    if (action === 'settings') return { ok: true, value: { ...runner.getAnswerPolicy(), canAdmin: true, historyScope: 'verification-test' } };
    if (action === 'session') return { ok: true, value: runner.snapshot(1) };
    return { ok: false };
  });
  window = new BrowserWindow({ show: Boolean(process.env.ZHS_SCREENSHOT_DIR), width: 980, height: 820 });
  await window.loadURL('about:blank');
  const externalUrls = [];
  tabs = new TabManager(window, { appVersion: 'test', isNavigable: () => false, registerKind: (id, kind) => kinds.set(id, kind), openExternally(url) { externalUrls.push(url); }, onDidFinishLoad() {}, onNavigation() {}, onChange() {} });
  await tabs.openZhihuishuTab(zhihuishuPage());
  const contents = tabs.activeContents();
  const js = source => contents.executeJavaScript(source);
  await js("document.head.insertAdjacentHTML('beforeend','<style>html{overflow-y:scroll}::-webkit-scrollbar{width:16px}</style>')");
  runner.login(1); await until(() => runner.snapshot(1).loggedIn);
  runner.start(1, ['shared:one'], 1.25);
  await until(() => js("Boolean(document.querySelector('dialog[open]'))"));
  const info = await js(`(() => {
    const d=document.querySelector('dialog');const b=d.getBoundingClientRect();
    return {text:d.textContent,modal:d.matches(':modal'),centerX:b.x+b.width/2,centerY:b.y+b.height/2,width:document.documentElement.clientWidth,height:document.documentElement.clientHeight,injected:!!d.querySelector('视频'),focused:d.contains(document.activeElement)};
  })()`);
  assert.match(info.text, /测试课程/); assert.match(info.text, /第一章 <视频>/);
  assert.match(info.text, /视频观看界面/); assert.match(info.text, /重新扫码/);
  assert.match(info.text, /不会自动恢复/); assert.equal(info.modal, true);
  assert.equal(info.focused, true); assert.equal(info.injected, false);
  assert.ok(Math.abs(info.centerX-info.width/2)<2 && Math.abs(info.centerY-info.height/2)<2, 'Dialog must be centered in the viewport excluding its scrollbar: '+JSON.stringify(info));
  // Keep the production window-open handler: replacing it hid the 0.3.28 regression.
  const workbenchUrl = contents.getURL();
  const windowCount = BrowserWindow.getAllWindows().length;
  await js("document.querySelector('dialog a').click()");
  await until(() => externalUrls.length > 0);
  assert.deepEqual(externalUrls, ['https://www.zhihuishu.com/']);
  await js(`(() => {
    for (const href of ['https://example.com/', 'https://www.zhihuishu.com.evil.example/', 'https://www.zhihuishu.com/?redirect=https://example.com', 'http://www.zhihuishu.com/', 'file:///tmp/untrusted', 'cpu-test:blocked']) {
      const link = document.createElement('a'); link.href = href; link.target = '_blank';
      document.querySelector('dialog').append(link); link.click(); link.remove();
    }
  })()`);
  await pause(150);
  assert.deepEqual(externalUrls, ['https://www.zhihuishu.com/'], 'Only the fixed official verification link may open externally');
  assert.equal(contents.getURL(), workbenchUrl, 'The isolated assistant must stay on its bundled page');
  assert.equal(BrowserWindow.getAllWindows().length, windowCount, 'No privileged popup window may be created');
  assert.equal(tabs.getState().tabs.length, 1, 'Verification opens in the system browser, preserving the assistant');
  const screenshotDir = process.env.ZHS_SCREENSHOT_DIR;
  async function capture(name) {
    if (screenshotDir) { fs.mkdirSync(screenshotDir, {recursive:true}); fs.writeFileSync(path.join(screenshotDir,name+'.png'), (await contents.capturePage()).toPNG()); }
  }
  await js("[...document.querySelectorAll('.theme-switch button')].find(b=>b.textContent.includes('浅色')).click()");
  await pause(350); await capture('verification-light');
  await js("[...document.querySelectorAll('.theme-switch button')].find(b=>b.textContent.includes('深色')).click()");
  await pause(350); await capture('verification-dark');
  window.setSize(430, 760); await pause(200);
  const small = await js("(()=>{const d=document.querySelector('dialog'),b=d.getBoundingClientRect();return {x:b.x,y:b.y,right:b.right,bottom:b.bottom,w:innerWidth,h:innerHeight,overflow:d.scrollWidth>d.clientWidth}})()");
  assert.ok(small.x>=0 && small.y>=0 && small.right<=small.w && small.bottom<=small.h);
  assert.equal(small.overflow, false); await capture('verification-small');
  await js("document.querySelector('dialog button').click()");
  await pause(3100);
  assert.equal(await js("document.querySelector('dialog').open"), false, 'Polling must not reopen a dismissed event');
  await js("document.querySelector('.verification-reminder button').click()");
  assert.equal(await js("document.querySelector('dialog').open"), true);
  await js("document.querySelector('dialog').dispatchEvent(new Event('cancel',{cancelable:true}));document.querySelector('dialog').close()");
  await pause(100);
  // Unmount/reopen the workbench: an unresolved verification must remain discoverable.
  tabs.close(tabs.getState().tabs.find(t=>t.kind==='workbench').id);
  await tabs.openZhihuishuTab(zhihuishuPage());
  await until(() => tabs.activeContents().executeJavaScript("Boolean(document.querySelector('dialog[open]'))"));
  console.log('Verification dialog: typed event, course/video context, centered modal, safe text, official link, themes, narrow window, dismissal and reopening passed');
  runner.shutdown();tabs.destroy();window.destroy();clearTimeout(deadline);app.exit(0);
}).catch(error => { console.error(error);runner?.shutdown();app.exit(1); });
app.on('quit', () => { try { fs.rmSync(profile,{recursive:true,force:true}); } catch {} });
