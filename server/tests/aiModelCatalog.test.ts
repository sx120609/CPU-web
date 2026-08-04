import assert from "node:assert/strict";
import test from "node:test";
import { detectAiJsonApiMode, normalizeAiJsonApiUrl } from "../src/services/aiJsonApi";
import { buildAiModelEndpointCandidates, extractAiModelIds } from "../src/services/aiModelCatalog";

test("model catalog prefers the upstream singular /model endpoint", () => {
  assert.deepEqual(
    buildAiModelEndpointCandidates("https://example.com/v1/chat/completions"),
    ["https://example.com/v1/model", "https://example.com/v1/models"],
  );
});

test("model catalog normalizes common upstream response shapes", () => {
  assert.deepEqual(
    extractAiModelIds({ data: [{ id: "gpt-5" }, { model: "gpt-4.1" }, { id: "gpt-5" }] }),
    ["gpt-4.1", "gpt-5"],
  );
  assert.deepEqual(extractAiModelIds({ models: ["model-b", "model-a"] }), ["model-a", "model-b"]);
});

test("AI endpoint mode follows the configured upstream URL without a provider selector", () => {
  assert.equal(detectAiJsonApiMode("https://example.com/v1/responses"), "responses");
  assert.equal(detectAiJsonApiMode("https://example.com/v1/chat/completions"), "chat_completions");
  assert.equal(
    normalizeAiJsonApiUrl("https://example.com/v1/responses", "https://fallback.test/v1/chat/completions"),
    "https://example.com/v1/responses",
  );
  assert.equal(
    normalizeAiJsonApiUrl("https://example.com/v1/chat/completions", "https://fallback.test/v1/responses"),
    "https://example.com/v1/chat/completions",
  );
});
