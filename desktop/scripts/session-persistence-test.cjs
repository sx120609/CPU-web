#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { flushPersistentSession } = require("../dist/electron/session-persistence.js");

async function main() {
  const calls = [];
  await flushPersistentSession({
    flushStorageData() {
      calls.push("storage");
    },
    cookies: {
      async flushStore() {
        calls.push("cookies");
      },
    },
  });
  assert.deepEqual(calls, ["storage", "cookies"]);

  let cookieFlushAttempted = false;
  await assert.rejects(
    flushPersistentSession({
      flushStorageData() {
        throw new Error("storage failed");
      },
      cookies: {
        async flushStore() {
          cookieFlushAttempted = true;
        },
      },
    }),
    /storage failed/,
  );
  assert.equal(cookieFlushAttempted, true, "DOM 存储失败时仍应尝试把 Cookie 落盘");

  const mainSource = fs.readFileSync(path.join(__dirname, "..", "electron", "main.ts"), "utf8");
  const installHandler = mainSource.slice(
    mainSource.indexOf('ipcMain.handle("update:install-now"'),
    mainSource.indexOf('ipcMain.handle("app:open-update"'),
  );
  assert.ok(
    installHandler.indexOf("await flushBrowserSession()") < installHandler.indexOf("runPendingUpdate()"),
    "立即更新必须先保存网站会话，再启动安装器",
  );
  const quitStart = mainSource.indexOf('app.on("before-quit"');
  const quitHandler = mainSource.slice(
    quitStart,
    mainSource.indexOf('app.on("window-all-closed"', quitStart),
  );
  assert.match(quitHandler, /event\.preventDefault\(\)/, "正常退出应等待网站会话落盘");
  assert.doesNotMatch(quitHandler, /runPendingUpdate\(|hasPendingUpdate\(/, "正常退出不得启动更新器并把客户端重新拉起");
  const normalStartup = mainSource.slice(
    mainSource.indexOf('app.whenReady().then(async () =>', mainSource.indexOf("requestSingleInstanceLock")),
    mainSource.indexOf('ipcMain.handle("app:info"'),
  );
  assert.match(normalStartup, /await restorePendingUpdate\(\)/, "下次正常启动时应恢复已下载的更新");
  assert.ok(
    normalStartup.indexOf("restorePendingUpdate()") < normalStartup.indexOf("buildApplicationMenu()"),
    "更新安装必须发生在创建菜单和主窗口之前",
  );

  const autoUpdateSource = fs.readFileSync(path.join(__dirname, "..", "electron", "auto-update.ts"), "utf8");
  assert.match(autoUpdateSource, /writeFile\(pendingMetadataPath\(\)/, "下载完成后应持久化待安装更新元数据");
  assert.match(autoUpdateSource, /export const restorePendingUpdate/, "更新模块应支持跨重启恢复待安装包");

  console.log("桌面退出与更新时机检查通过：退出只落盘会话，更新留到下次启动安装。");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
