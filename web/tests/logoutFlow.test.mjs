import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const source = readFileSync(`${repoRoot}web/src/stores/auth.ts`, "utf8");
const serverAuth = readFileSync(`${repoRoot}server/src/routes/auth.ts`, "utf8");

test("explicit logout cannot trigger saved-credential recovery", () => {
  const autoLogin = source.slice(source.indexOf("async tryAutoSsoLogin"), source.indexOf("async fetchMe"));
  assert.match(autoLogin, /if \(justLoggedOutThisSession\(\)\) return false;/u);

  const logout = source.slice(source.indexOf("async logout()"), source.indexOf("expireSession()"));
  assert.match(logout, /this\.ready = true;/u);
  assert.match(logout, /clearCreds\(\);/u);
  assert.match(logout, /pendingSsoLoginAbortController\?\.abort\(\);/u);
  assert.match(logout, /sessionStorage\.setItem\("cpu-just-logged-out", "1"\)/u);
  assert.doesNotMatch(logout, /jwxtApi\.logout/u);
});

test("a late SSO response cannot replace a revoked browser session", () => {
  assert.match(serverAuth, /if \(req\.browserSession\)[\s\S]*updateBrowserSession\(req, res, \{ siteToken, jwxtToken: token \}\)/u);
  assert.match(serverAuth, /if \(!sessionEstablished\)[\s\S]*登录会话已取消/u);
});
