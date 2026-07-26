#!/usr/bin/env node
// 把用户脚本声明的 @require / @resource 依赖抓成本地副本。
//
// 不这么做的话，每次打开学习平台都要从公共 CDN 取一批可执行代码，然后在持有
// 超星登录态的页面里 eval 掉：校园网不通就用不了，CDN 被投毒或域名被抢注就等于
// 在所有用户的会话里执行任意代码。
//
//   node scripts/vendor-deps.mjs           下载并写入 assets/vendor/
//   node scripts/vendor-deps.mjs --verify  只校验现有副本与清单是否一致
//
// 文件名规则必须与 electron/main.ts 的 vendoredDependency() 保持一致。

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const scriptFile = path.join(root, "assets", "userscripts", "monkey.js");
const vendorDir = path.join(root, "assets", "vendor");
const manifestFile = path.join(vendorDir, "manifest.json");

const verifyOnly = process.argv.includes("--verify");

const vendorName = (url) => `${createHash("sha256").update(url).digest("hex").slice(0, 40)}.txt`;
const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

const readMetadata = async () => {
  const source = await readFile(scriptFile, "utf8");
  const header = source.match(/\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/);
  if (!header) throw new Error(`未在 ${scriptFile} 中找到 UserScript 元数据头`);
  const entries = [...header[1].matchAll(/^\s*\/\/\s*@([\w-]+)\s+(.+?)\s*$/gm)];
  const values = (name) => entries.filter((entry) => entry[1] === name).map((entry) => entry[2].trim());
  const requires = values("require");
  const resources = values("resource")
    .map((value) => value.split(/\s+/, 2))
    .filter(([name, url]) => name && url)
    .map(([, url]) => url);
  // data: 依赖是内联的，不需要也不能下载
  return [...requires, ...resources].filter((url) => !url.startsWith("data:"));
};

const download = async (url) => {
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  return response.text();
};

const run = async () => {
  const urls = await readMetadata();
  if (urls.length === 0) {
    console.log("用户脚本没有声明任何远程依赖，无需处理。");
    return;
  }

  if (verifyOnly) {
    const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
    let failures = 0;
    for (const url of urls) {
      const entry = manifest.dependencies[url];
      if (!entry) {
        console.error(`缺少清单条目：${url}`);
        failures += 1;
        continue;
      }
      const content = await readFile(path.join(vendorDir, entry.file), "utf8").catch(() => undefined);
      if (content === undefined) {
        console.error(`缺少本地副本：${entry.file}（${url}）`);
        failures += 1;
        continue;
      }
      if (sha256(content) !== entry.sha256) {
        console.error(`内容与清单不符：${entry.file}（${url}）`);
        failures += 1;
        continue;
      }
      console.log(`ok  ${entry.file}  ${url}`);
    }
    if (failures > 0) {
      console.error(`\n${failures} 项校验失败，请重新执行 npm run vendor:deps。`);
      process.exitCode = 1;
      return;
    }
    console.log(`\n全部 ${urls.length} 项依赖校验通过。`);
    return;
  }

  await mkdir(vendorDir, { recursive: true });
  const dependencies = {};
  const keep = new Set(["manifest.json"]);

  for (const url of urls) {
    const file = vendorName(url);
    process.stdout.write(`下载 ${url} … `);
    const content = await download(url);
    await writeFile(path.join(vendorDir, file), content, "utf8");
    dependencies[url] = { file, sha256: sha256(content), bytes: Buffer.byteLength(content, "utf8") };
    keep.add(file);
    console.log(`${(Buffer.byteLength(content, "utf8") / 1024).toFixed(1)} KiB → ${file}`);
  }

  // 清掉已经不再被声明的旧副本，避免仓库里堆积无人引用的第三方代码
  for (const existing of await readdir(vendorDir)) {
    if (!keep.has(existing)) {
      await rm(path.join(vendorDir, existing));
      console.log(`删除失效副本 ${existing}`);
    }
  }

  const manifest = {
    note: "由 npm run vendor:deps 生成。sha256 是文件内容的哈希，文件名是依赖 URL 的哈希前 40 位。",
    generatedFrom: path.relative(root, scriptFile).replace(/\\/g, "/"),
    dependencies
  };
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`\n完成：${urls.length} 项依赖已写入 assets/vendor/，清单见 manifest.json。`);
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
