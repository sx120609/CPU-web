#!/usr/bin/env node

const path = require("node:path");
const { spawnSync } = require("node:child_process");

/**
 * 没有 Apple Developer ID 时，至少给 Apple Silicon 应用做 ad-hoc 签名。
 * 这不能消除 Gatekeeper 的“身份不明开发者”提示，也不能替代 Apple 公证；
 * 但能让系统校验包内可执行文件没有在打包后被改动。
 */
module.exports = async (context) => {
  if (context.electronPlatformName !== "darwin") return;

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  const result = spawnSync("codesign", ["--force", "--deep", "--sign", "-", appPath], {
    encoding: "utf8",
    stdio: "inherit"
  });
  if (result.status !== 0) {
    throw new Error(`macOS ad-hoc 签名失败：${appPath}`);
  }
};
