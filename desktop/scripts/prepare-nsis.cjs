#!/usr/bin/env node
// 从 build/*.source 生成 NSIS 真正读取的两个文件，编码由脚本负责。
//
//   build/license.source.txt   （UTF-8）→ build/license.txt    UTF-16LE + BOM
//   build/installer.nsh.source （UTF-8）→ build/installer.nsh  UTF-8 + BOM
//
// NSIS 的 Unicode 安装器读不带 BOM 的 UTF-8 会把中文按系统代码页解读，全变乱码。
// 放进打包流程而不是手转一次 —— 手转的话，谁下次用 UTF-8 编辑一下就又坏了。

const fs = require("node:fs");
const path = require("node:path");

const dir = path.resolve(__dirname, "..", "build");

const jobs = [
  { source: "license.source.txt", target: "license.txt", encoding: "utf16le", bom: [0xff, 0xfe] },
  { source: "installer.nsh.source", target: "installer.nsh", encoding: "utf8", bom: [0xef, 0xbb, 0xbf] }
];

let failed = false;
for (const job of jobs) {
  const source = path.join(dir, job.source);
  if (!fs.existsSync(source)) {
    console.error(`找不到 ${source}`);
    failed = true;
    continue;
  }
  // NSIS 的许可框与脚本都按 CRLF 断行
  const text = fs.readFileSync(source, "utf8").replace(/\r?\n/g, "\r\n");
  fs.writeFileSync(
    path.join(dir, job.target),
    Buffer.concat([Buffer.from(job.bom), Buffer.from(text, job.encoding)])
  );
  console.log(`${job.target}  ${text.length} 字符  ${job.encoding === "utf16le" ? "UTF-16LE" : "UTF-8"} + BOM`);
}
if (failed) process.exitCode = 1;
