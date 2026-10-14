import assert from "node:assert/strict";
import test from "node:test";
import {
  detectAiJsonApiMode,
  extractAiJsonCompletionMetadata,
  extractAiJsonTextResponse,
  extractAiJsonWebSearchSources,
  normalizeAiJsonApiUrl,
  readAiJsonTextStream,
  sendAiJsonRequest,
  toAnthropicMessagesBody,
} from "../src/services/aiJsonApi";
import { buildAiModelEndpointCandidates } from "../src/services/aiModelCatalog";
import { buildAiUpstreamAuthHeaders } from "../src/services/aiUpstreamAuth";

const PNG_DATA = "iVBORw0KGgo=";

test("Claude Messages endpoints are detected and official base addresses are completed", () => {
  assert.equal(detectAiJsonApiMode("https://api.anthropic.com/v1/messages"), "anthropic_messages");
  assert.equal(detectAiJsonApiMode("https://relay.example.com/claude/v1/messages/"), "anthropic_messages");
  assert.equal(detectAiJsonApiMode("https://relay.example.com/v1/chat/completions"), "chat_completions");
  const fallback = "https://api.openai.com/v1/chat/completions";
  assert.equal(normalizeAiJsonApiUrl("https://api.anthropic.com", fallback), "https://api.anthropic.com/v1/messages");
  assert.equal(normalizeAiJsonApiUrl("https://api.anthropic.com/v1/", fallback), "https://api.anthropic.com/v1/messages");
  assert.equal(normalizeAiJsonApiUrl("https://relay.example.com/v1/messages", fallback), "https://relay.example.com/v1/messages");
  // 中转站只填 /v1 时仍按原来的 Chat Completions 处理。
  assert.equal(normalizeAiJsonApiUrl("https://relay.example.com/v1", fallback), "https://relay.example.com/v1/chat/completions");
});

test("Claude auth uses x-api-key, and relays also get a Bearer token", () => {
  assert.deepEqual(buildAiUpstreamAuthHeaders("https://api.anthropic.com/v1/messages", " sk-ant ", true), {
    "anthropic-version": "2023-06-01",
    "x-api-key": "sk-ant",
  });
  assert.deepEqual(buildAiUpstreamAuthHeaders("https://relay.example.com/v1/messages", "sk-relay", true), {
    "anthropic-version": "2023-06-01",
    "x-api-key": "sk-relay",
    Authorization: "Bearer sk-relay",
  });
  assert.deepEqual(buildAiUpstreamAuthHeaders("https://relay.example.com/v1/chat/completions", "sk", false), {
    Authorization: "Bearer sk",
  });
});

test("Chat Completions bodies are converted to Claude Messages", () => {
  const body = toAnthropicMessagesBody({
    model: "claude-sonnet-5-5",
    temperature: 0.2,
    reasoning_effort: "high",
    response_format: { type: "json_object" },
    web_search_options: { user_location: { type: "approximate", country: "CN", city: "Nanjing", timezone: "Asia/Shanghai" } },
    messages: [
      { role: "system", content: "系统提示" },
      { role: "developer", content: "补充规则" },
      { role: "assistant", content: "上一轮回答" },
      { role: "user", content: "第一段" },
      {
        role: "user",
        content: [
          { type: "text", text: "看图" },
          { type: "image_url", image_url: { url: `data:image/png;base64,${PNG_DATA}`, detail: "high" } },
          { type: "image_url", image_url: { url: "https://example.com/a.jpg" } },
        ],
      },
    ],
  }, { cacheSystemPrompt: true });

  assert.equal(body.model, "claude-sonnet-5-5");
  assert.equal(body.max_tokens, 16_000);
  assert.equal("temperature" in body, false);
  assert.equal("reasoning_effort" in body, false);
  assert.equal("response_format" in body, false);
  const system = body.system as Array<Record<string, unknown>>;
  assert.equal(system.length, 1);
  assert.match(String(system[0].text), /^系统提示\n\n补充规则\n\n只输出一个 JSON 对象/u);
  assert.deepEqual(system[0].cache_control, { type: "ephemeral" });
  assert.deepEqual(body.messages, [
    { role: "user", content: [{ type: "text", text: "请按系统提示完成任务。" }] },
    { role: "assistant", content: [{ type: "text", text: "上一轮回答" }] },
    {
      role: "user",
      content: [
        { type: "text", text: "第一段" },
        { type: "text", text: "看图" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: PNG_DATA } },
        { type: "image", source: { type: "url", url: "https://example.com/a.jpg" } },
      ],
    },
  ]);
  assert.deepEqual(body.tools, [{
    type: "web_search_20250305",
    name: "web_search",
    max_uses: 5,
    user_location: { type: "approximate", city: "Nanjing", country: "CN", timezone: "Asia/Shanghai" },
  }]);
});

test("Responses bodies convert PDFs and reject files Claude cannot read", () => {
  const body = toAnthropicMessagesBody({
    model: "claude-opus-5-5",
    instructions: "说明",
    max_output_tokens: 900,
    stream: true,
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: "读一下" },
        { type: "input_file", filename: "a.pdf", file_data: "data:application/pdf;base64,JVBERg==" },
      ],
    }],
  });
  assert.equal(body.max_tokens, 900);
  assert.equal(body.stream, true);
  assert.deepEqual(body.system, [{ type: "text", text: "说明" }]);
  assert.deepEqual((body.messages as any[])[0].content[1], {
    type: "document",
    title: "a.pdf",
    source: { type: "base64", media_type: "application/pdf", data: "JVBERg==" },
  });
  assert.throws(() => toAnthropicMessagesBody({
    model: "claude-opus-5-5",
    input: [{
      role: "user",
      content: [{
        type: "input_file",
        filename: "a.docx",
        file_data: "data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,UEs=",
      }],
    }],
  }), /只能直接读取 PDF 和纯文本/u);
});

test("Claude responses yield the final answer, finish reason, usage and sources", () => {
  const payload = {
    content: [
      { type: "thinking", thinking: "" },
      { type: "text", text: "我先搜一下。" },
      { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "药大" } },
      {
        type: "web_search_tool_result",
        tool_use_id: "s1",
        content: [{ type: "web_search_result", url: "https://www.cpu.edu.cn/", title: "中国药科大学" }],
      },
      { type: "text", text: "{\"answer\":\"药大", citations: [{ type: "web_search_result_location", url: "https://www.cpu.edu.cn/a", title: "通知" }] },
      { type: "text", text: "在南京\"}" },
    ],
    stop_reason: "max_tokens",
    usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 5 },
  };
  assert.equal(extractAiJsonTextResponse(payload, "anthropic_messages"), "{\"answer\":\"药大在南京\"}");
  const metadata = extractAiJsonCompletionMetadata(payload, "anthropic_messages");
  assert.equal(metadata.finishReason, "length");
  assert.equal(metadata.inputTokens, 100);
  assert.equal(metadata.outputTokens, 5);
  assert.equal(metadata.totalTokens, 105);
  assert.deepEqual(extractAiJsonWebSearchSources(payload), [
    { title: "中国药科大学", url: "https://www.cpu.edu.cn/" },
    { title: "通知", url: "https://www.cpu.edu.cn/a" },
  ]);
  assert.equal(extractAiJsonTextResponse({ content: [{ type: "text", text: "ok" }] }, "anthropic_messages"), "ok");
});

test("Claude SSE streams emit text deltas only and report the stop reason", async () => {
  const events = [
    { type: "message_start", message: { usage: { input_tokens: 3, output_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "secret" } },
    { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "你" } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "好" } },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 7 } },
    { type: "message_stop" },
  ];
  const sse = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
  const deltas: string[] = [];
  const reasons: Array<string | null> = [];
  const content = await readAiJsonTextStream(
    new Response(sse, { headers: { "Content-Type": "text/event-stream" } }),
    "anthropic_messages",
    (delta) => { deltas.push(delta); },
    (metadata) => { reasons.push(metadata.finishReason); },
  );
  assert.equal(content, "你好");
  assert.deepEqual(deltas, ["你", "好"]);
  assert.deepEqual(reasons, ["stop"]);

  const failing = `event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } })}\n\n`;
  await assert.rejects(
    readAiJsonTextStream(new Response(failing, { headers: { "Content-Type": "text/event-stream" } }), "anthropic_messages", () => {}),
    /Claude 流式响应中断：Overloaded/u,
  );
});

test("sendAiJsonRequest posts a Claude Messages request with Claude headers", async () => {
  const originalFetch = globalThis.fetch;
  let captured: { url: string; init: RequestInit } | null = null;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    captured = { url: String(url), init: init || {} };
    return new Response(JSON.stringify({ content: [{ type: "text", text: "{\"ok\":true}" }], stop_reason: "end_turn" }), {
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const result = await sendAiJsonRequest({
      endpoint: "https://api.anthropic.com/v1/messages",
      apiKey: "sk-ant-test",
      provider: "anthropic",
      model: "claude-haiku-5-5",
      temperature: 0.1,
      maxTokens: 64,
      promptCacheKey: "cpu:test:abc",
      enablePromptCacheRetention: true,
      maxTransientRetries: 0,
      messages: [
        { role: "system", content: "只返回 JSON" },
        { role: "user", content: "测试" },
      ],
    });
    assert.equal(result.mode, "anthropic_messages");
    assert.equal(result.promptCacheKeyApplied, true);
    assert.equal(result.promptCacheRetentionApplied, false);
    assert.equal(extractAiJsonTextResponse(await result.response.json(), result.mode), "{\"ok\":true}");
    assert.ok(captured);
    const request = captured as { url: string; init: RequestInit };
    assert.equal(request.url, "https://api.anthropic.com/v1/messages");
    const headers = request.init.headers as Record<string, string>;
    assert.equal(headers["x-api-key"], "sk-ant-test");
    assert.equal(headers["anthropic-version"], "2023-06-01");
    assert.equal(headers.Authorization, undefined);
    const sent = JSON.parse(String(request.init.body));
    assert.equal(sent.max_tokens, 64);
    assert.equal(sent.prompt_cache_key, undefined);
    assert.equal(sent.temperature, undefined);
    assert.deepEqual(sent.system[0].cache_control, { type: "ephemeral" });
    assert.deepEqual(sent.messages, [{ role: "user", content: [{ type: "text", text: "测试" }] }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Claude model catalog reads /v1/models in one page", () => {
  assert.deepEqual(
    buildAiModelEndpointCandidates("https://api.anthropic.com/v1/messages", "anthropic"),
    ["https://api.anthropic.com/v1/models?limit=1000"],
  );
  assert.deepEqual(
    buildAiModelEndpointCandidates("https://relay.example.com/claude/v1/messages"),
    ["https://relay.example.com/claude/v1/models?limit=1000"],
  );
});
