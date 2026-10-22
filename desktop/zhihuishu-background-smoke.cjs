// Real Electron window + real child process; no platform account/network needed.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow, ipcMain } = require('electron');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cpu-zhs-background-'));
app.setPath('userData', profile);
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const { TabManager } = require('./dist/electron/tabs.js');
const { ZhihuishuBackgroundPower } = require('./dist/electron/zhihuishu-background.js');
const { ZhihuishuRunner } = require('./dist/zhihuishu-runner.cjs');
const { zhihuishuPage, isAuthorizedZhihuishuRequest } = require('./dist/electron/zhihuishu.js');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  const deadline = Date.now() + 8000;
  while (!check()) { assert.ok(Date.now() < deadline, 'Background check timed out'); await pause(25); }
}
let runner, guard, tabs, window;
const deadline = setTimeout(() => { console.error('Background smoke timeout'); app.exit(1); }, 45000);
app.whenReady().then(async () => {
  guard = new ZhihuishuBackgroundPower();
  runner = new ZhihuishuRunner({ enabled: true, python: process.env.ZHS_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), worker: path.resolve(__dirname, '../server/tests/fixtures/zhihuishu-worker.py'), onRunningChange: guard.setRunning });
  const kinds = new Map();
  ipcMain.handle('zhihuishu:request', (event, action) => {
    if (!isAuthorizedZhihuishuRequest(event, kinds.get(event.sender.id))) return { ok: false };
    if (action === 'settings') return { ok: true, value: { ...runner.getAnswerPolicy(), canAdmin: true, historyScope: 'background-test' } };
    if (action === 'session') return { ok: true, value: runner.snapshot(1) };
    return { ok: false };
  });
  window = new BrowserWindow({ show: true, width: 900, height: 700 });
  await window.loadURL('about:blank');
  tabs = new TabManager(window, { appVersion: 'test', isNavigable: () => false, registerKind: (id, kind) => kinds.set(id, kind), openExternally() {}, onDidFinishLoad() {}, onNavigation() {}, onChange() {} });
  await tabs.openZhihuishuTab(zhihuishuPage());
  const contents = tabs.activeContents();
  assert.equal(contents.getBackgroundThrottling(), false);
  await contents.executeJavaScript('window.backgroundTicks=0;setInterval(()=>window.backgroundTicks++,200)');
  runner.login(1);
  await until(() => runner.snapshot(1).loggedIn);
  assert.equal(guard.active, false, 'Idle login must not hold power protection');
  runner.start(1, ['hike:two']);
  await until(() => runner.snapshot(1).current?.percent === 25);
  assert.equal(guard.active, true);
  // No page action is needed to advance the worker. Read only before and after.
  async function advances(label) {
    const before = runner.snapshot(1).current.percent;
    const ticks = await contents.executeJavaScript('window.backgroundTicks');
    await pause(2300);
    assert.ok(runner.snapshot(1).current.percent > before, label + ': worker stopped');
    assert.ok(await contents.executeJavaScript('window.backgroundTicks') > ticks, label + ': renderer stopped');
    assert.equal(guard.active, true, label + ': lost power protection');
    console.log(label + ': worker progress and renderer ticks advanced');
  }
  app.focus({ steal: true }); window.show(); window.focus();
  await pause(500);
  window.minimize();
  if (process.platform === 'win32') {
    await until(() => window.isMinimized());
    await advances('Minimized to Windows taskbar');
  } else {
    // macOS automation sessions may refuse native minimization. Hidden-window
    // and inactive-tab execution are still tested below on every platform.
    await pause(500);
    if (window.isMinimized()) await advances('Minimized native window');
    else console.log('Native minimization unavailable on this macOS session; Windows requires it');
  }
  window.restore(); window.hide();
  await advances('Hidden to tray');
  window.show(); tabs.openToolsTab();
  await advances('Switched away from workbench tab');
  const active = tabs.getState().tabs.find(tab => tab.kind === 'workbench');
  tabs.close(active.id);
  const beforeClosed = runner.snapshot(1).current.percent;
  await pause(1200);
  assert.ok(runner.snapshot(1).current.percent > beforeClosed, 'Closing workbench must not own worker lifetime');
  runner.stop(1);
  assert.equal(guard.active, false, 'Stopping must release power protection');
  // Separate login/user avoids the reconnect cooldown and checks natural completion.
  await pause(150);
  runner.login(2); await until(() => runner.snapshot(2).loggedIn);
  runner.start(2, ['shared:one']);
  await until(() => runner.snapshot(2).state === 'completed');
  assert.equal(guard.active, false, 'Completion must release power protection');
  runner.start(2, ['hike:two']); assert.equal(guard.active, true);
  runner.shutdown(); assert.equal(guard.active, false, 'Exit must release power protection');
  tabs.destroy(); window.destroy(); clearTimeout(deadline);
  console.log('Background execution, default-on policy and task-scoped power cleanup passed');
  app.exit(0);
}).catch(error => { console.error(error); runner?.shutdown(); guard?.setRunning(false); app.exit(1); });
app.on('quit', () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} });
