#!/usr/bin/env node
// 启动一次真实的 Electron 进程，确认主进程能起来且没有立刻崩溃。
//
// 存在的理由：首页路径用 app.getAppPath() 解析，用户脚本和 vendor 依赖也一样。
// 这类路径错了不会报错，只会表现为"窗口打开了但什么都没发生"，跑一次才看得见。
//
//   node scripts/smoke-test.mjs

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronBinary = require(path.join(root, "node_modules", "electron"));

const WAIT_MS = 12000;
// 这些是"进程还活着但功能已经坏了"的信号，必须当作失败
const FATAL_PATTERNS = [
  /内置用户脚本加载失败/,
  /Failed to load URL/i,
  /Unable to load preload script/i,
  /ERR_FILE_NOT_FOUND/
];

const child = spawn(electronBinary, [root], {
  cwd: root,
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" }
});

let output = "";
const collect = (chunk) => { output += chunk.toString(); };
child.stdout.on("data", collect);
child.stderr.on("data", collect);

const finish = (ok, reason) => {
  if (!child.killed) child.kill();
  console.log(output.trim() || "（进程没有任何输出）");
  console.log("—".repeat(60));
  console.log(ok ? `通过：${reason}` : `失败：${reason}`);
  process.exit(ok ? 0 : 1);
};

child.on("error", (error) => finish(false, `无法启动 Electron：${error.message}`));
child.on("exit", (code, signal) => {
  if (child.killed) return;
  finish(false, `主进程在 ${WAIT_MS / 1000} 秒内就退出了（code=${code} signal=${signal}）`);
});

setTimeout(() => {
  const fatal = FATAL_PATTERNS.find((pattern) => pattern.test(output));
  if (fatal) finish(false, `进程存活但输出里有致命错误，匹配到 ${fatal}`);
  finish(true, `主进程存活超过 ${WAIT_MS / 1000} 秒，未发现致命错误`);
}, WAIT_MS);
