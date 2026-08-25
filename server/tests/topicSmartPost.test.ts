import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import {
  extractAiJsonCompletionMetadata,
  sendAiJsonRequest,
} from "../src/services/aiJsonApi";
import {
  estimateSmartPostQuota,
  extractSmartPostFileText,
  normalizeSmartPostFile,
  normalizeSmartPostFiles,
  parseSmartPostAnalysis,
  parseSmartPostDraft,
  resolveSmartPostUsage,
} from "../src/services/topicSmartPost";

test("Responses 请求把原始 PDF/PPTX 映射为 input_file，并把图片映射为 input_image", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: any = null;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body || "{}"));
    return new Response(JSON.stringify({
      output: [{ type: "message", content: [{ type: "output_text", text: '{"title":"测试标题","content":"正文","summary":"已整理"}' }] }],
      usage: { input_tokens: 120, output_tokens: 30, total_tokens: 150 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const result = await sendAiJsonRequest({
      endpoint: "https://api.openai.com/v1/responses",
      apiKey: "test-key",
      provider: "openai",
      model: "gpt-5.6-sol",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "整理附件" },
          {
            type: "file",
            file: {
              filename: "材料.pdf",
              mimeType: "application/pdf",
              data: Buffer.from("%PDF-test").toString("base64"),
            },
          },
          {
            type: "file",
            file: {
              filename: "宣讲材料.pptx",
              mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
              data: Buffer.from("PK\u0003\u0004-test").toString("base64"),
            },
          },
          {
            type: "image_url",
            image_url: { url: `data:image/png;base64,${Buffer.from("image").toString("base64")}`, detail: "high" },
          },
        ],
      }],
    });
    assert.equal(result.response.ok, true);
    assert.deepEqual(requestBody.input[0].content[0], { type: "input_text", text: "整理附件" });
    assert.equal(requestBody.input[0].content[1].type, "input_file");
    assert.equal(requestBody.input[0].content[1].filename, "材料.pdf");
    assert.match(requestBody.input[0].content[1].file_data, /^data:application\/pdf;base64,/u);
    assert.equal(requestBody.input[0].content[2].type, "input_file");
    assert.equal(requestBody.input[0].content[2].filename, "宣讲材料.pptx");
    assert.equal(requestBody.input[0].content[3].type, "input_image");
    assert.equal(requestBody.input[0].content[3].detail, "high");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Responses、Chat Completions 与 Ollama usage 统一为实际 token", () => {
  assert.deepEqual(extractAiJsonCompletionMetadata({
    usage: { input_tokens: 1200, output_tokens: 310, total_tokens: 1510 },
  }, "responses"), {
    finishReason: null,
    doneReason: null,
    done: null,
    promptEvalCount: 1200,
    evalCount: 310,
    inputTokens: 1200,
    outputTokens: 310,
    totalTokens: 1510,
    totalDurationMs: null,
    loadDurationMs: null,
    promptEvalDurationMs: null,
    evalDurationMs: null,
  });

  assert.equal(resolveSmartPostUsage({ inputTokens: 4001, outputTokens: 3999, totalTokens: 8000 }, 4000).chargedQuota, 2);
  assert.deepEqual(resolveSmartPostUsage([
    { inputTokens: 1200, outputTokens: 300, totalTokens: 1500 },
    { inputTokens: 1800, outputTokens: 900, totalTokens: 2700 },
    { inputTokens: 2200, outputTokens: 700, totalTokens: 2900 },
  ], 4000), {
    inputTokens: 5200,
    outputTokens: 1900,
    totalTokens: 7100,
    tokensPerQuota: 4000,
    chargedQuota: 2,
  });
  assert.equal(resolveSmartPostUsage({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }, 4000).chargedQuota, 1);
  assert.throws(
    () => resolveSmartPostUsage({ inputTokens: null, outputTokens: null, totalTokens: null }, 4000),
    /未返回实际 Token 用量/u,
  );
});

test("智慧发帖第一轮材料分析只接受严格结构", () => {
  assert.deepEqual(parseSmartPostAnalysis(JSON.stringify({
    intent: "发布成员招募说明",
    audience: "在校学生",
    facts: ["面向全校招募"],
    structure: ["团队介绍", "报名方式"],
    constraints: ["不冒充校方官方通知"],
    riskNotes: [],
  })), {
    intent: "发布成员招募说明",
    audience: "在校学生",
    facts: ["面向全校招募"],
    structure: ["团队介绍", "报名方式"],
    constraints: ["不冒充校方官方通知"],
    riskNotes: [],
  });
  assert.throws(() => parseSmartPostAnalysis(JSON.stringify({
    intent: "生成帖子",
    audience: "学生",
    facts: ["事实"],
    structure: ["结构"],
    constraints: [],
    riskNotes: [],
    publish: true,
  })), /字段无效/u);
});

test("智慧发帖草稿只接受完整 JSON 且限制帖子长度", () => {
  assert.deepEqual(parseSmartPostDraft('```json\n{"title":"招募成员","content":"## 正文\\n\\n欢迎加入","summary":"整理了结构"}\n```'), {
    title: "招募成员",
    content: "## 正文\n\n欢迎加入",
    summary: "整理了结构",
  });
  assert.throws(() => parseSmartPostDraft('{"title":"短","content":"","summary":"缺少正文"}'), /不完整/u);
  assert.throws(
    () => parseSmartPostDraft('{"title":"标题","content":"正文","summary":"摘要","published":true}'),
    /字段无效/u,
  );
  assert.throws(
    () => parseSmartPostDraft('这是草稿：{"title":"标题","content":"正文","summary":"摘要"}'),
    /格式无效/u,
  );
});

test("智慧发帖文件接受宣传常用类型，并限制多附件数量", () => {
  const file = normalizeSmartPostFile({
    buffer: Buffer.from("%PDF-test"),
    originalname: "招募说明.pdf",
    mimetype: "application/octet-stream",
  });
  assert.equal(file.mimetype, "application/pdf");
  const image = normalizeSmartPostFile({
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
    originalname: "海报.png",
    mimetype: "image/png",
  });
  assert.equal(image.mimetype, "image/png");
  assert.throws(() => normalizeSmartPostFile({
    buffer: Buffer.from("legacy"),
    originalname: "旧文档.doc",
    mimetype: "application/msword",
  }), /仅支持/u);
  assert.throws(() => normalizeSmartPostFile({
    buffer: Buffer.from("not-a-pdf"),
    originalname: "伪装材料.pdf",
    mimetype: "application/pdf",
  }), /文件内容/u);
  assert.throws(() => normalizeSmartPostFiles(Array.from({ length: 9 }, (_value, index) => ({
    buffer: Buffer.from("%PDF-test"),
    originalname: `材料-${index}.pdf`,
    mimetype: "application/pdf",
  }))), /最多上传 8 个附件/u);
});

test("multipart 中文附件名按 UTF-8 恢复，不把乱码写入任务与日志", () => {
  const chineseName = "中国药科大学本科毕业论文.pdf";
  const mojibakeName = Buffer.from(chineseName, "utf8").toString("latin1");
  const normalized = normalizeSmartPostFile({
    buffer: Buffer.from("%PDF-test"),
    originalname: mojibakeName,
    mimetype: "application/pdf",
  });
  assert.equal(normalized.originalname, chineseName);
});

test("智慧发帖可从 PPTX 幻灯片与备注提取文字", async () => {
  const zip = new JSZip();
  zip.file("ppt/presentation.xml", "<p:presentation/>");
  zip.file("ppt/slides/slide1.xml", "<p:sld><a:t>成员招募</a:t><a:t>报名截止 9 月 1 日</a:t></p:sld>");
  zip.file("ppt/notesSlides/notesSlide1.xml", "<p:notes><a:t>面向在校学生</a:t></p:notes>");
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const text = await extractSmartPostFileText(normalizeSmartPostFile({
    buffer,
    originalname: "招募宣讲.pptx",
    mimetype: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  }));
  assert.match(text, /成员招募/u);
  assert.match(text, /报名截止 9 月 1 日/u);
  assert.match(text, /面向在校学生/u);
});

test("提交前额度估算返回宽区间，并使用当前每额度 Token 配置", () => {
  const estimate = estimateSmartPostQuota({
    textLength: 2_000,
    files: [
      { name: "招募说明.pdf", size: 2 * 1024 * 1024 },
      { name: "海报.png", size: 800 * 1024 },
    ],
    tokensPerQuota: 4_000,
  });
  assert.equal(estimate.tokensPerQuota, 4_000);
  assert.ok(estimate.minTokens < estimate.maxTokens);
  assert.equal(estimate.minQuota, Math.ceil(estimate.minTokens / 4_000));
  assert.equal(estimate.maxQuota, Math.ceil(estimate.maxTokens / 4_000));

  const formatEstimate = estimateSmartPostQuota({
    operation: "format",
    textLength: 2_000,
    files: [{ name: "不会提交的附件.pdf", size: 12 * 1024 * 1024 }],
    tokensPerQuota: 4_000,
  });
  assert.ok(formatEstimate.maxTokens < estimate.minTokens);
  assert.equal(formatEstimate.minQuota, Math.ceil(formatEstimate.minTokens / 4_000));
  assert.equal(formatEstimate.maxQuota, Math.ceil(formatEstimate.maxTokens / 4_000));
});
