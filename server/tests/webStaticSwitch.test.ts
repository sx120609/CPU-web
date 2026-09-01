import assert from "node:assert/strict";
import test from "node:test";
import { assessWebStaticCoverage } from "../src/services/webStaticSwitch";

test("static switch readiness requires every current release object with matching size", () => {
  const expected = [
    { relativePath: "web-static/assets/dual-origin-v2/app.js", size: 120 },
    { relativePath: "web-static/assets/dual-origin-v2/app.css", size: 40 },
    { relativePath: "web-static/assets/dual-origin-v2/font.woff2", size: 800 },
  ];
  const stored = [
    { relativePath: "web-static/assets/dual-origin-v2/app.js", size: 120 },
    { relativePath: "web-static/assets/dual-origin-v2/app.css", size: 41 },
    { relativePath: "unrelated/file.jpg", size: 800 },
  ];

  const result = assessWebStaticCoverage(expected, stored);

  assert.equal(result.expectedCount, 3);
  assert.equal(result.presentCount, 2);
  assert.deepEqual(result.missing, ["web-static/assets/dual-origin-v2/font.woff2"]);
  assert.deepEqual(result.mismatched, ["web-static/assets/dual-origin-v2/app.css"]);
});

test("unknown remote size is accepted only when the object exists", () => {
  const result = assessWebStaticCoverage(
    [{ relativePath: "web-static/assets/dual-origin-v2/app.js", size: 120 }],
    [{ relativePath: "web-static/assets/dual-origin-v2/app.js", size: null }],
  );

  assert.equal(result.presentCount, 1);
  assert.equal(result.missing.length, 0);
  assert.equal(result.mismatched.length, 0);
});
