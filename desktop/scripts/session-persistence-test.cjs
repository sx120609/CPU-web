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
  assert.ok(
    quitHandler.indexOf("flushBrowserSession()") < quitHandler.indexOf("runPendingUpdate()"),
    "退出自动更新也必须先保存网站会话",
  );

  console.log("桌面会话持久化检查通过：退出前会主动落盘站点存储与 Cookie。");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
