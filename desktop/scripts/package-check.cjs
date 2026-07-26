#!/usr/bin/env node
// 检查打包产物的 asar 里，运行时真正会去读的那些资源都在。
//
//   node scripts/package-check.cjs [asar 路径]
//
// 主进程用 app.getAppPath() 解析首页、用户脚本和 vendor 依赖。打包后这些路径
// 一旦对不上，应用照样能启动，只是首页空白或者脚本静默不生效 —— 手工点是看不出来的。

const path = require("node:path");
const fs = require("node:fs");

const asarPath = process.argv[2] || path.join(__dirname, "..", "release", "win-unpacked", "resources", "app.asar");

if (!fs.existsSync(asarPath)) {
  console.error(`找不到打包产物：${asarPath}`);
  console.error("先执行 npm run dist:win（或把 asar 路径作为参数传入）。");
  process.exit(1);
}

const asar = require("@electron/asar");
const entries = asar.listPackage(asarPath).map((entry) => entry.replace(/\\/g, "/"));
const has = (target) => entries.includes(target);

const required = [
  "/package.json",
  "/dist/electron/main.js",
  "/dist/electron/policy.js",
  "/dist/electron/config.js",
  "/dist/electron/shared.js",
  "/dist/electron/oauth.js",
  "/dist/electron/oauth-store.js",
  "/dist/electron/site-preload.js",
  "/dist/electron/learning-preload.js",
  "/src/launcher/index.html",
  "/src/launcher/renderer.js",
  "/src/launcher/style.css",
  "/src/launcher/logo.png",
  "/assets/userscripts/monkey.js",
  "/assets/tray-icon.png",
  "/assets/vendor/manifest.json"
];

let missing = 0;
for (const entry of required) {
  const ok = has(entry);
  if (!ok) missing += 1;
  console.log(`${ok ? "  ok  " : "  缺失"}  ${entry}`);
}

// vendor 副本数量要和清单对得上，少一个就意味着运行时会回落到 CDN
const manifestPath = path.join(__dirname, "..", "assets", "vendor", "manifest.json");
const expected = Object.keys(JSON.parse(fs.readFileSync(manifestPath, "utf8")).dependencies).length;
const packed = entries.filter((entry) => entry.startsWith("/assets/vendor/") && entry.endsWith(".txt")).length;
const vendorOk = packed === expected;
if (!vendorOk) missing += 1;
console.log(`${vendorOk ? "  ok  " : "  缺失"}  vendor 依赖副本 ${packed}/${expected}`);

console.log(`\nasar 共 ${entries.length} 条目，${missing === 0 ? "全部必需资源就位。" : `${missing} 项缺失。`}`);
process.exit(missing === 0 ? 0 : 1);
