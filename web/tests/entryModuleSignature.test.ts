import assert from "node:assert/strict";
import test from "node:test";
import { buildEntryModuleSignature, normalizeEntryModuleUrl } from "../src/utils/entryModuleSignature";

test("entry module signatures include same-origin and CDN modules", () => {
  assert.equal(
    buildEntryModuleSignature([
      "/assets/app-shell-local.js",
      "https://static.cputime.cn/cpu-web-media/web-static/assets/app-shell-cdn.js?cache=1",
    ], "https://cputime.cn"),
    "https://cputime.cn/assets/app-shell-local.js|https://static.cputime.cn/cpu-web-media/web-static/assets/app-shell-cdn.js",
  );
});

test("entry module signatures ignore non-network sources", () => {
  assert.equal(normalizeEntryModuleUrl("data:text/javascript,export default 1", "https://cputime.cn"), "");
  assert.equal(normalizeEntryModuleUrl("not a url", "invalid base"), "");
});
