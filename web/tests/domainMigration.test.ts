import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildPrimarySiteUrl,
  isLegacySiteHostname,
  resolveMigrationAudience,
  shouldAutoPromptAndroidUpdate,
  shouldShowLegacyDomainNotice,
} from "../src/utils/domainMigration";

test("迁移提醒只针对旧域名", () => {
  assert.equal(isLegacySiteHostname("cpu.lizmt.cn"), true);
  assert.equal(isLegacySiteHostname("CPU.LIZMT.CN."), true);
  assert.equal(isLegacySiteHostname("cputime.cn"), false);
  assert.equal(isLegacySiteHostname("www.cpu.lizmt.cn"), false);
  assert.equal(isLegacySiteHostname("cpu.lizmt.cn.example.com"), false);
  assert.equal(shouldShowLegacyDomainNotice("cputime.cn", null), false);
});

test("旧域名提醒可以暂缓一天并在到期后重新出现", () => {
  const now = Date.UTC(2026, 7, 29);

  assert.equal(shouldShowLegacyDomainNotice("cpu.lizmt.cn", null, now), true);
  assert.equal(shouldShowLegacyDomainNotice("cpu.lizmt.cn", String(now + 1), now), false);
  assert.equal(shouldShowLegacyDomainNotice("cpu.lizmt.cn", String(now), now), true);
  assert.equal(shouldShowLegacyDomainNotice("cpu.lizmt.cn", "invalid", now), true);
  assert.equal(shouldShowLegacyDomainNotice("cpu.lizmt.cn", null, now, true), false);
});

test("旧版安卓客户端继续使用兼容域名时不强制弹出升级", () => {
  assert.equal(shouldAutoPromptAndroidUpdate("cpu.lizmt.cn", true, true), false);
  assert.equal(shouldAutoPromptAndroidUpdate("cpu.lizmt.cn", true, false), true);
  assert.equal(shouldAutoPromptAndroidUpdate("cputime.cn", true, true), true);
  assert.equal(shouldAutoPromptAndroidUpdate("cputime.cn", false, true), false);
});

test("迁移提醒只选择一套与当前客户端匹配的说明", () => {
  assert.equal(resolveMigrationAudience({
    androidNative: true,
    desktopNative: false,
    iosDevice: false,
    androidDevice: true,
  }), "android-app");
  assert.equal(resolveMigrationAudience({
    androidNative: false,
    desktopNative: true,
    iosDevice: false,
    androidDevice: false,
  }), "desktop-app");
  assert.equal(resolveMigrationAudience({
    androidNative: false,
    desktopNative: false,
    iosDevice: true,
    androidDevice: false,
  }), "ios");
  assert.equal(resolveMigrationAudience({
    androidNative: false,
    desktopNative: false,
    iosDevice: false,
    androidDevice: false,
  }), "other");
});

test("安卓浏览器与安卓客户端使用不同的获取和更新说明", () => {
  assert.equal(resolveMigrationAudience({
    androidNative: false,
    desktopNative: false,
    iosDevice: false,
    androidDevice: true,
  }), "android-web");
  assert.equal(resolveMigrationAudience({
    androidNative: false,
    desktopNative: true,
    iosDevice: false,
    androidDevice: true,
  }), "desktop-app");
});

test("迁移文案与站点现有客户端入口名称保持一致", () => {
  const notice = readFileSync(new URL("../src/components/common/LegacyDomainMigrationDialog.vue", import.meta.url), "utf8");
  const schedule = readFileSync(new URL("../src/views/Schedule.vue", import.meta.url), "utf8");
  const downloads = readFileSync(new URL("../src/views/Download.vue", import.meta.url), "utf8");
  const desktopShell = readFileSync(new URL("../../desktop/src/shell/index.html", import.meta.url), "utf8");

  assert.match(notice, /“下载 Android 客户端”/);
  assert.match(notice, /“更新安卓客户端”或“检查客户端更新”/);
  assert.match(notice, /页面底部“关于”/);
  assert.match(notice, /“查看更多”→“添加到主屏幕”/);
  assert.match(schedule, />下载 Android 客户端</);
  assert.match(schedule, /"更新安卓客户端" : "检查客户端更新"/);
  assert.match(downloads, /actionLabel: "打开课表并安装"/);
  assert.match(downloads, /“查看更多”→“添加到主屏幕”/);
  assert.match(desktopShell, /id="about-check-update"[^>]*>检查客户端更新</);
  assert.doesNotMatch(notice, /选择“客户端更新”/);
  assert.doesNotMatch(notice, /“检查客户端更新”或“更新”/);
});

test("前往新域名时保留当前页面、参数和锚点", () => {
  assert.equal(
    buildPrimarySiteUrl({ pathname: "/schedule", search: "?week=2", hash: "#today" }),
    "https://cputime.cn/schedule?week=2#today",
  );
});
