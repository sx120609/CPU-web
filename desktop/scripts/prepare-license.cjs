#!/usr/bin/env node
// 把 build/license.source.txt（UTF-8，可直接编辑）转成 build/license.txt（UTF-16LE + BOM）。
//
// NSIS 的 Unicode 安装器读许可文件时，UTF-8 会被按系统代码页解读，
// 中文全变乱码。UTF-16LE + BOM 才认。转换放进打包流程里，
// 免得谁下次用 UTF-8 编辑一下就又坏了。

const fs = require("node:fs");
const path = require("node:path");

const dir = path.resolve(__dirname, "..", "build");
const source = path.join(dir, "license.source.txt");
const target = path.join(dir, "license.txt");

if (!fs.existsSync(source)) {
  console.error(`找不到 ${source}`);
  process.exitCode = 1;
} else {
  // NSIS 的许可框按 CRLF 断行
  const text = fs.readFileSync(source, "utf8").replace(/\r?\n/g, "\r\n");
  fs.writeFileSync(target, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]));
  console.log(`license.txt  ${text.length} 字符  UTF-16LE + BOM`);
}
