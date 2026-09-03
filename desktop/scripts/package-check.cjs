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
  "/dist/electron/oauth-user.js",
  "/dist/electron/oauth-store.js",
  "/dist/electron/site-preload.js",
  "/dist/electron/shell-preload.js",
  "/dist/electron/tabs.js",
  "/dist/electron/learning-preload.js",
  "/src/shell/index.html",
  "/src/shell/renderer.js",
  "/src/shell/style.css",
  "/src/shell/logo.png",
  // 自装界面。漏了不会报错，只会让安装器开出一个空白窗口 —— 正是这个脚本要防的那种失败
  "/dist/electron/self-install.js",
  "/dist/electron/install-files.js",
  "/dist/electron/installer-preload.js",
  "/dist/electron/auto-update.js",
  "/dist/electron/userscript-update.js",
  "/dist/electron/session-persistence.js",
  "/src/installer/index.html",
  "/src/installer/renderer.js",
  "/src/installer/style.css",
  "/src/installer/logo.png",
  "/assets/userscripts/monkey.js",
  "/assets/userscripts/multiplatform.js",
  "/assets/userscripts/weban.js",
  "/assets/vendor/ocsjs-LICENSE.txt",
  "/assets/vendor/ocsjs-PROVENANCE.md",
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
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const expectedFiles = Object.values(manifest.dependencies).map((dependency) => `/assets/vendor/${dependency.file}`);
const missingVendorFiles = expectedFiles.filter((entry) => !has(entry));
const expected = expectedFiles.length;
const packed = expected - missingVendorFiles.length;
const vendorOk = missingVendorFiles.length === 0;
if (!vendorOk) missing += 1;
console.log(`${vendorOk ? "  ok  " : "  缺失"}  vendor 依赖副本 ${packed}/${expected}`);

console.log(`\nasar 共 ${entries.length} 条目，${missing === 0 ? "全部必需资源就位。" : `${missing} 项缺失。`}`);
process.exit(missing === 0 ? 0 : 1);
