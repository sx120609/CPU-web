import assert from "node:assert/strict";
import test from "node:test";
import { detectAiJsonApiMode, normalizeAiJsonApiUrl } from "../src/services/aiJsonApi";
import { buildAiModelEndpointCandidates, extractAiModelIds } from "../src/services/aiModelCatalog";
import {
  buildAiServicesFromLegacy,
  isAiProviderReady,
  normalizeAiServiceList,
  resolveAiServiceForScene,
} from "../src/services/siteSettings";

test("model catalog prefers the upstream singular /model endpoint", () => {
  assert.deepEqual(
    buildAiModelEndpointCandidates("https://example.com/v1/chat/completions"),
    ["https://example.com/v1/model", "https://example.com/v1/models"],
  );
});

test("Ollama model catalog accepts a base address and falls back to native tags", () => {
  assert.deepEqual(
    buildAiModelEndpointCandidates("http://127.0.0.1:11434", "ollama"),
    ["http://127.0.0.1:11434/v1/models", "http://127.0.0.1:11434/api/tags"],
  );
  assert.deepEqual(
    buildAiModelEndpointCandidates("http://127.0.0.1:11434/api/chat", "ollama"),
    ["http://127.0.0.1:11434/api/tags", "http://127.0.0.1:11434/v1/models"],
  );
});

test("Ollama is ready without an API key when its address and model are present", () => {
  assert.equal(isAiProviderReady({
    provider: "ollama",
    apiUrl: "http://127.0.0.1:11434",
    apiKey: "",
    model: "qwen3:8b",
  }), true);
  assert.equal(isAiProviderReady({
    provider: "deepseek",
    apiUrl: "https://api.example.com/v1/chat/completions",
    apiKey: "",
    model: "deepseek-chat",
  }), false);
});

test("legacy AI fields migrate into a reusable service pool", () => {
  const services = buildAiServicesFromLegacy({
    aiReviewProvider: "deepseek",
    aiReviewApiUrl: "https://api.deepseek.com/chat/completions",
    aiReviewApiKey: "deep-key",
    qqGroupAdReviewProvider: "ollama",
    qqGroupAdReviewApiUrl: "http://ollama.internal:11434",
    qqGroupAdReviewApiKey: "",
    imageReviewProvider: "openai",
    imageReviewApiUrl: "https://api.openai.com/v1/chat/completions",
    imageReviewApiKey: "open-key",
  });
  assert.equal(services.length, 3);
  assert.deepEqual(services.map((service) => service.id), ["default-main", "qq-group-ad", "image-review"]);
  assert.equal(services[1].provider, "ollama");
  assert.equal(services[1].apiKey, "");
});

test("scene routing resolves each selected service without repeating endpoint fields", () => {
  const services = normalizeAiServiceList([
    { id: "main", name: "主服务", provider: "deepseek", apiUrl: "https://deep.example/v1/chat/completions", apiKey: "deep-key" },
    { id: "local", name: "本地 Ollama", provider: "ollama", apiUrl: "http://127.0.0.1:11434", apiKey: "" },
  ]);
  const config = {
    aiServices: services,
    assistantServiceId: "main",
    learningAssistantServiceId: "local",
    aiReviewServiceId: "main",
    qqGroupAdReviewServiceId: "local",
    imageReviewServiceId: "main",
    videoReviewServiceId: "local",
    aiReviewProvider: "deepseek",
    aiReviewApiUrl: "",
    aiReviewApiKey: "",
    qqGroupAdReviewProvider: "deepseek",
    qqGroupAdReviewApiUrl: "",
    qqGroupAdReviewApiKey: "",
    imageReviewProvider: "deepseek",
    imageReviewApiUrl: "",
    imageReviewApiKey: "",
    videoReviewProvider: "deepseek",
    videoReviewApiUrl: "",
    videoReviewApiKey: "",
  };
  assert.equal(resolveAiServiceForScene(config, "assistant").apiUrl, "https://deep.example/v1/chat/completions");
  assert.equal(resolveAiServiceForScene(config, "learning-assistant").provider, "ollama");
  assert.equal(resolveAiServiceForScene(config, "text-review").provider, "deepseek");
  assert.equal(resolveAiServiceForScene(config, "qq-group-ad").provider, "ollama");
  assert.equal(resolveAiServiceForScene(config, "image-review").apiKey, "deep-key");
  assert.equal(resolveAiServiceForScene(config, "video-review").apiUrl, "http://127.0.0.1:11434");
});

test("model catalog normalizes common upstream response shapes", () => {
  assert.deepEqual(
    extractAiModelIds({ data: [{ id: "gpt-5" }, { model: "gpt-4.1" }, { id: "gpt-5" }] }),
    ["gpt-4.1", "gpt-5"],
  );
  assert.deepEqual(extractAiModelIds({ models: ["model-b", "model-a"] }), ["model-a", "model-b"]);
  assert.deepEqual(extractAiModelIds({ models: [{ name: "qwen3:8b" }] }), ["qwen3:8b"]);
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
  assert.equal(
    normalizeAiJsonApiUrl("http://127.0.0.1:11434", "https://fallback.test/v1/chat/completions"),
    "http://127.0.0.1:11434/v1/chat/completions",
  );
});
