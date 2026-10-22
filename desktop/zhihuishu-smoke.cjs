// Run with Electron. Exercise the real isolated preload and bundled Vue page.
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { app, BrowserWindow, ipcMain } = require("electron");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "cpu-zhs-desktop-test-"));
app.setPath("userData", profile);
const { zhihuishuPage, isAuthorizedZhihuishuRequest, zhihuishuRequest, shutdownZhihuishu } = require("./dist/electron/zhihuishu.js");
const deadline = setTimeout(() => { console.error("Wisdom Tree desktop smoke timeout"); app.exit(1); }, 30000);
app.whenReady().then(async () => {
  let trusted;
  ipcMain.handle("zhihuishu:request", (event, action, input) => {
    if (!isAuthorizedZhihuishuRequest(event, event.sender.id === trusted?.webContents.id ? "workbench" : undefined)) return { ok: false, error: "Forbidden" };
    return zhihuishuRequest(action, input);
  });
  const options = { show: false, webPreferences: { preload: path.join(__dirname, "dist/electron/zhihuishu-preload.js"), sandbox: true, contextIsolation: true, nodeIntegration: false } };
  trusted = new BrowserWindow(options);
  await trusted.loadFile(zhihuishuPage());
  const result = await trusted.webContents.executeJavaScript(`(async () => {
    const initial = await window.cpuZhihuishu.request('settings');
    const invalid = await window.cpuZhihuishu.request('saveSettings', {autoAnswer:false,autoSubmit:true});
    const session = await window.cpuZhihuishu.request('session');
    const unsupported = await window.cpuZhihuishu.request('exec', {command:'noop'});
    return {initial, invalid, session, unsupported, title:document.querySelector('h1')?.textContent, bridgeIsolated:typeof require === 'undefined'};
  })()`);
  assert.equal(result.initial.value.autoAnswer, true);
  assert.equal(result.initial.value.autoSubmit, true);
  assert.equal(result.invalid.ok, false);
  assert.equal(result.session.value.enabled, true);
  assert.equal(result.unsupported.ok, false);
  assert.equal(result.bridgeIsolated, true);
  assert.match(result.title, /智慧树助手/);
  const untrusted = new BrowserWindow(options);
  await untrusted.loadURL("about:blank");
  const denied = await untrusted.webContents.executeJavaScript("window.cpuZhihuishu.request('settings')");
  assert.equal(denied.ok, false);
  console.log("Wisdom Tree desktop: bundled page, preload isolation, sender gate, default switches and validation passed");
  trusted.destroy(); untrusted.destroy(); shutdownZhihuishu(); clearTimeout(deadline);
  app.exit(0);
}).catch(error => { console.error(error); shutdownZhihuishu(); app.exit(1); });
app.on("quit", () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} });
