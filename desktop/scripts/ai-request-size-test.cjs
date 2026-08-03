#!/usr/bin/env node

const assert = require("node:assert/strict");
const path = require("node:path");
const { sanitizeAiBody } = require(path.join(__dirname, "..", "dist", "electron", "ai-request.js"));

const bodyFor = (content) => JSON.stringify({
  input: [{ role: "user", content }],
});

const originalPngDataUrl = `data:image/png;base64,${"A".repeat(Math.ceil(8 * 1024 * 1024 * 4 / 3))}`;
const sanitized = sanitizeAiBody(bodyFor([
  { type: "input_text", text: "请识别并解答截图中的题目" },
  { type: "input_image", image_url: originalPngDataUrl, detail: "high" },
]));

assert.equal(sanitized.input[0].content[1].image_url, originalPngDataUrl, "原始 PNG Data URL 不应被压缩或改写");
assert.equal(sanitized.input[0].content[1].detail, "high");
assert.throws(
  () => sanitizeAiBody(bodyFor({ type: "input_text", text: "x".repeat(32001) })),
  /内容过长/,
  "普通文字仍应保留 32KB 上限",
);
assert.throws(
  () => sanitizeAiBody(bodyFor({ type: "input_image", image_url: `data:image/png;base64,${"A".repeat(12 * 1024 * 1024)}` })),
  /原图过大/,
  "超过独立图片上限的请求应被拒绝",
);
assert.throws(
  () => sanitizeAiBody(bodyFor({ type: "input_image", image_url: "data:text/html;base64,QQ==" })),
  /图片地址无效/,
  "非图片 Data URL 不得通过桥接",
);

console.log("AI 请求大小策略：原始 PNG 独立上限、文字上限与图片类型校验通过。");
