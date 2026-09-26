#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { acquireInstallLock, installTree, InstallTreeError } = require("../dist/electron/install-files.js");
const {
  adviseFailure,
  classifyFailure,
  parseAntivirus,
  scrubUserPaths
} = require("../dist/electron/install-diagnostics.js");

const read = (file) => fs.readFile(file, "utf8");

const errno = (code) => Object.assign(new Error(`${code}: simulated`), { code });

/** 真实文件系统，外加按规则注入的失败：模拟杀软扫描时短暂锁住文件 */
const flakyFs = (rules) => ({
  copyFile: async (from, to) => {
    const rule = rules.copyFile?.(from, to);
    if (rule) throw errno(rule);
    await fs.copyFile(from, to);
  },
  rename: async (from, to) => {
    const rule = rules.rename?.(from, to);
    if (rule) throw errno(rule);
    await fs.rename(from, to);
  },
  rm: (target, options) => fs.rm(target, options),
  lstat: (target) => fs.lstat(target)
});

const noSleep = () => Promise.resolve();

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cpu-web-install-files-"));
  try {
    const src = path.join(root, "src");
    const app = path.join(root, "app");
    await fs.mkdir(src, { recursive: true });
    await fs.mkdir(app, { recursive: true });
    const entry = async (name, content) => {
      await fs.writeFile(path.join(src, name), content);
      return { from: path.join(src, name), to: path.join(app, name), size: Buffer.byteLength(content) };
    };

    // 全新安装
    let entries = [await entry("runtime.dll", "v1-runtime"), await entry("app.exe", "v1-exe")];
    let result = await installTree(entries);
    assert.equal(await read(path.join(app, "runtime.dll")), "v1-runtime", "目标缺失时应直接完成安装");
    assert.equal(result.retries, 0);

    // 覆盖安装：换入新文件时前三次被“杀软”锁住，应等一等再换进去
    entries = [await entry("runtime.dll", "v2-runtime"), await entry("app.exe", "v2-exe")];
    let locks = 3;
    const retried = [];
    result = await installTree(entries, {
      sleep: noSleep,
      onRetry: (event) => retried.push(event.code),
      fs: flakyFs({
        rename: (from, to) => (from.includes(".installing-") && to.endsWith("runtime.dll") && locks-- > 0 ? "EPERM" : null)
      })
    });
    assert.equal(await read(path.join(app, "runtime.dll")), "v2-runtime", "短暂被锁的文件应在重试后换入");
    assert.equal(result.retries, 3, "应如实记录重试次数");
    assert.deepEqual(retried, ["EPERM", "EPERM", "EPERM"]);
    assert.deepEqual((await fs.readdir(app)).sort(), ["app.exe", "runtime.dll"], "成功后不应残留临时文件或旧文件");

    // 暂存文件一直被攥着：改为直接从安装包复制到正式位置
    entries = [await entry("runtime.dll", "v3-runtime")];
    await installTree(entries, {
      sleep: noSleep,
      retryBudgetMs: 0,
      fs: flakyFs({ rename: (from) => (from.includes(".installing-") ? "EBUSY" : null) })
    });
    assert.equal(await read(path.join(app, "runtime.dll")), "v3-runtime", "改名换入走不通时应退回直接复制");

    // 第二个文件怎么都写不进去：第一个已换入的文件必须换回旧版，不能留下半新半旧的目录
    entries = [await entry("runtime.dll", "v4-runtime"), await entry("app.exe", "v4-exe"), await entry("new.pak", "v4-pak")];
    const blockExe = (_from, to) => (to.endsWith("app.exe") && !to.includes(".installing-") ? "EPERM" : null);
    await assert.rejects(
      installTree(entries, {
        sleep: noSleep,
        retryBudgetMs: 0,
        fs: flakyFs({
          rename: (from, to) => (from.includes(".installing-") ? blockExe(from, to) : null),
          copyFile: blockExe
        })
      }),
      (error) => error instanceof InstallTreeError && error.stage === "swap" && error.code === "EPERM"
        && error.file.endsWith("app.exe") && /写入新文件失败/.test(error.message)
    );
    assert.equal(await read(path.join(app, "runtime.dll")), "v3-runtime", "失败后已换入的文件必须回滚到旧版");
    assert.equal(await read(path.join(app, "app.exe")), "v2-exe", "失败的文件必须保持旧版");
    assert.deepEqual((await fs.readdir(app)).sort(), ["app.exe", "runtime.dll"], "回滚后不应残留新文件或临时文件");

    // 暂存阶段失败：旧版一个字节都不该动
    await assert.rejects(
      installTree([{ from: path.join(root, "missing.dll"), to: path.join(app, "runtime.dll"), size: 1 }]),
      (error) => error instanceof InstallTreeError && error.stage === "stage" && /准备新文件失败/.test(error.message)
    );
    assert.equal(await read(path.join(app, "runtime.dll")), "v3-runtime", "新文件准备失败时必须保留旧版本");

    // 非暂时性错误不应空等
    let calls = 0;
    await assert.rejects(installTree([await entry("x.dll", "x")], {
      fs: flakyFs({ copyFile: () => { calls += 1; return "ENOSPC"; } })
    }));
    assert.equal(calls, 1, "ENOSPC 之类的错误不该重试");

    // 目录锁
    const first = await acquireInstallLock(app);
    assert.ok(first, "首次安装应取得目录锁");
    assert.equal(await acquireInstallLock(app), null, "并发安装不得取得同一目录锁");
    await first.release();

    const afterRelease = await acquireInstallLock(app);
    assert.ok(afterRelease, "安装结束后应允许下次安装");
    await afterRelease.release();

    await fs.writeFile(path.join(app, ".install.lock"), JSON.stringify({ pid: 2_147_483_646, createdAt: Date.now() }));
    const afterCrash = await acquireInstallLock(app);
    assert.ok(afterCrash, "持锁进程已经退出时应自动回收残留锁");
    await afterCrash.release();

    // 诊断：认出安全软件、翻译成人话、上报前去掉用户名
    const tasklist = [
      "\"System Idle Process\",\"0\",\"Services\",\"0\",\"8 K\"",
      "\"MsMpEng.exe\",\"4120\",\"Services\",\"0\",\"210,000 K\"",
      "\"360Tray.exe\",\"8812\",\"Console\",\"1\",\"40,000 K\"",
      "\"ZhuDongFangYu.exe\",\"2204\",\"Services\",\"0\",\"30,000 K\"",
      "\"HipsTray.exe\",\"9120\",\"Console\",\"1\",\"12,000 K\""
    ].join("\r\n");
    assert.deepEqual(parseAntivirus(tasklist), ["360安全卫士", "火绒安全", "Windows 安全中心"], "第三方在前、去重，Defender 垫底");

    const blocked = adviseFailure(classifyFailure("EPERM", "swap"), ["360安全卫士", "Windows 安全中心"], { elevated: false });
    assert.match(blocked.message, /360安全卫士/, "被拦时应点名第三方安全软件");
    assert.equal(blocked.canElevate, true);
    assert.equal(adviseFailure("blocked", [], { elevated: true }).canElevate, false, "已经提权过就不再给管理员按钮");
    assert.equal(classifyFailure("ENOSPC", "stage"), "no-space");
    assert.equal(classifyFailure("EPERM", "rollback"), "rollback");
    assert.match(adviseFailure("no-space", [], { elevated: false, neededMb: 420 }).hint, /420 MB/);

    const scrubbed = scrubUserPaths("rename 'C:\\Users\\86139\\AppData\\Local\\Programs\\cpu-web-desktop\\d3dcompiler_47.dll'");
    assert.ok(!scrubbed.includes("86139"), "上报内容不应包含用户名");
    assert.match(scrubbed, /d3dcompiler_47\.dll/);

    console.log("Windows 安装文件检查通过：杀软短暂锁定可重试、失败整体回滚、并发安装被拦截、诊断文案与脱敏正确。");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
