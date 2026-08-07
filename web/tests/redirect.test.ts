import assert from "node:assert/strict";
import test from "node:test";
import { isOAuthAuthorizationRedirect, isServerHandledRedirect, resolveLoginRedirect, resolveSafeRedirect } from "../src/utils/redirect";

test("OAuth 授权回跳优先于用户角色默认页面", () => {
  const target = "/api/oauth/authorize?client_id=cpu-electron&state=test";

  assert.equal(resolveLoginRedirect(target, {
    role: "voicehub_admin",
    voiceHubRole: "super_admin",
    lostFoundRole: "super_admin",
  }), target);
  assert.equal(isOAuthAuthorizationRedirect(target), true);
});

test("普通登录继续使用角色默认页面和安全站内回跳", () => {
  assert.equal(resolveLoginRedirect(undefined, { voiceHubRole: "admin" }), "/voicehub/dashboard");
  assert.equal(resolveLoginRedirect("/courses?tab=mine", null), "/courses?tab=mine");
  assert.equal(resolveLoginRedirect("https://example.com", null), "/home");
  assert.equal(resolveSafeRedirect("//example.com"), "/home");
});

test("QQ Bot 管理员通报链接标记为服务端回跳", () => {
  assert.equal(isServerHandledRedirect("/qqbot/ad-report/abcdefghijklmnopqrstuvwxyz"), true);
  assert.equal(isServerHandledRedirect("/qqbot/ad-report"), true);
  assert.equal(isServerHandledRedirect("/qqbot/ad-reporting/example"), false);
});
