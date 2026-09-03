#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { acquireInstallLock, placeInstallFile } = require("../dist/electron/install-files.js");

const read = (file) => fs.readFile(file, "utf8");

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cpu-web-install-files-"));
  try {
    const source = path.join(root, "source.dll");
    const target = path.join(root, "app", "runtime.dll");
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(source, "new-runtime");

    await placeInstallFile({ from: source, to: target, size: 11 });
    assert.equal(await read(target), "new-runtime", "目标缺失时应直接完成安装");

    await fs.writeFile(source, "newer-runtime");
    await placeInstallFile({ from: source, to: target, size: 13 });
    assert.equal(await read(target), "newer-runtime", "覆盖安装应原子换入新文件");

    const files = await fs.readdir(path.dirname(target));
    assert.deepEqual(files, ["runtime.dll"], "成功后不应残留临时文件或可删除的旧文件");

    await assert.rejects(
      placeInstallFile({ from: path.join(root, "missing.dll"), to: target, size: 1 }),
      /准备新文件失败/,
    );
    assert.equal(await read(target), "newer-runtime", "新文件准备失败时必须保留旧版本");

    const first = await acquireInstallLock(path.dirname(target));
    assert.ok(first, "首次安装应取得目录锁");
    assert.equal(await acquireInstallLock(path.dirname(target)), null, "并发安装不得取得同一目录锁");
    await first.release();

    const afterRelease = await acquireInstallLock(path.dirname(target));
    assert.ok(afterRelease, "安装结束后应允许下次安装");
    await afterRelease.release();

    await fs.writeFile(
      path.join(path.dirname(target), ".install.lock"),
      JSON.stringify({ pid: 2_147_483_646, createdAt: Date.now() }),
    );
    const afterCrash = await acquireInstallLock(path.dirname(target));
    assert.ok(afterCrash, "持锁进程已经退出时应自动回收残留锁");
    await afterCrash.release();

    console.log("Windows 安装文件检查通过：缺失目标可自愈、失败保留旧版、并发安装被拦截。");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
