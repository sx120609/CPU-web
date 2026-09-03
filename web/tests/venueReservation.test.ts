import assert from "node:assert/strict";
import test from "node:test";
import {
  configureVenueReservationLink,
  detectVenueLaunchMode,
  isVenueIosDevice,
  VENUE_RESERVATION_URL,
  WECHAT_LAUNCH_URL,
} from "../src/utils/venueReservation";

test("微信内直接进入场馆预约", () => {
  assert.equal(detectVenueLaunchMode({
    userAgent: "Mozilla/5.0 (iPhone) MicroMessenger/8.0.56 Mobile",
    maxTouchPoints: 5,
    viewportWidth: 390,
  }), "wechat");
});

test("普通手机显示唤起微信与扫码兜底", () => {
  assert.equal(detectVenueLaunchMode({
    userAgent: "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36",
    maxTouchPoints: 5,
    viewportWidth: 412,
  }), "mobile");
  assert.equal(detectVenueLaunchMode({
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 Safari/604.1",
    maxTouchPoints: 5,
    viewportWidth: 390,
  }), "mobile");
});

test("触屏平板与鸿蒙客户端不会误判为电脑", () => {
  assert.equal(detectVenueLaunchMode({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
    maxTouchPoints: 5,
    viewportWidth: 1024,
  }), "mobile");
  assert.equal(detectVenueLaunchMode({
    userAgent: "CPUWebHarmonyApp/2.0.8",
    maxTouchPoints: 1,
    viewportWidth: 720,
  }), "mobile");
});

test("iPhone 和触屏 iPad 使用 iOS 系统分享路径", () => {
  assert.equal(isVenueIosDevice({
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 Safari/604.1",
    maxTouchPoints: 5,
  }), true);
  assert.equal(isVenueIosDevice({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
    maxTouchPoints: 5,
  }), true);
  assert.equal(isVenueIosDevice({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36",
    maxTouchPoints: 0,
  }), false);
});

test("桌面浏览器显示微信扫码入口", () => {
  assert.equal(detectVenueLaunchMode({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36",
    maxTouchPoints: 0,
    viewportWidth: 1440,
  }), "desktop");
});

test("预约地址和微信唤起协议保持固定", () => {
  assert.equal(VENUE_RESERVATION_URL, "https://cgtst.cpu.edu.cn/wap");
  assert.equal(WECHAT_LAUNCH_URL, "weixin://");
});

test("微信直达链接不发送来源页", () => {
  const link = { href: "", target: "", rel: "", referrerPolicy: "" };
  configureVenueReservationLink(link);
  assert.deepEqual(link, {
    href: VENUE_RESERVATION_URL,
    target: "_self",
    rel: "noreferrer",
    referrerPolicy: "no-referrer",
  });
});
