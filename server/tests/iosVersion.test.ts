import test from "node:test";
import assert from "node:assert/strict";
import { detectIosMajorVersion } from "../src/utils/iosVersion";

function request(headers: Record<string, string>) {
  return { get(name: string) { return headers[name.toLowerCase()] || null; } } as any;
}

test("detects iOS major version from native user agent", () => {
  assert.equal(detectIosMajorVersion(request({
    "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) CPUWebIOSApp/1",
  })), 26);
});

test("accepts an explicit iOS version header and ignores invalid values", () => {
  assert.equal(detectIosMajorVersion(request({ "x-cpu-ios-version": "27.1" })), 27);
  assert.equal(detectIosMajorVersion(request({ "user-agent": "Mozilla/5.0 (X11; Linux x86_64)" })), null);
});
