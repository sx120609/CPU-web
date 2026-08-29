import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPrimarySiteUrl,
  isLegacySiteHostname,
  resolveMigrationAudience,
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
});

test("迁移提醒只选择一套与当前客户端匹配的说明", () => {
  assert.equal(resolveMigrationAudience({
    androidNative: true,
    desktopNative: false,
    iosDevice: false,
    androidDevice: true,
  }), "android");
  assert.equal(resolveMigrationAudience({
    androidNative: false,
    desktopNative: true,
    iosDevice: false,
    androidDevice: false,
  }), "desktop");
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

test("原生客户端标记优先于容易混淆的设备 UA", () => {
  assert.equal(resolveMigrationAudience({
    androidNative: false,
    desktopNative: true,
    iosDevice: false,
    androidDevice: true,
  }), "desktop");
});

test("前往新域名时保留当前页面、参数和锚点", () => {
  assert.equal(
    buildPrimarySiteUrl({ pathname: "/schedule", search: "?week=2", hash: "#today" }),
    "https://cputime.cn/schedule?week=2#today",
  );
});
