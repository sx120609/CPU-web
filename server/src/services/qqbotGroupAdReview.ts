import { createHash } from "node:crypto";
import path from "node:path";
import { readFile, rm } from "node:fs/promises";
import { Errors } from "../utils/response";
import { finishAiReviewLogError, finishAiReviewLogSuccess, startAiReviewLog } from "./aiReviewLog";
import { extractAiJsonTextResponse, normalizeAiJsonApiUrl, sendAiJsonRequest } from "./aiJsonApi";
import { resolveModelCandidates, shouldFallbackToNextModel } from "./modelFallback";
import { prepareMediaLocalFileForProcessing } from "./mediaStorage";
import { getSiteConfig, resolveSharedAiProviderConfig } from "./siteSettings";

type QqGroupAdResponse = {
  risk_score?: number;
  risk_level?: string;
  decision?: string;
  reason?: string;
  detail?: string;
  categories?: Record<string, number>;
};

export type QqGroupAdReviewResult = {
  action: "allow" | "block";
  riskScore: number;
  riskLevel: "low" | "medium" | "high";
  reason: string;
  detail: string;
  model: string;
  modelDecision: string;
};

const QQ_GROUP_AD_REVIEW_RESULT_CACHE_TTL_MS = 10 * 60_000;
const QQ_GROUP_AD_IMAGE_MAX_INLINE_BYTES = 12 * 1024 * 1024;
const QQ_GROUP_QR_ONLY_SYSTEM_PROMPT = [
  "你是二维码存在性检测器。发送者已在广告过滤白名单中，本次不得进行广告审核。",
  "唯一任务：检查随消息提供的图片或视频抽帧中是否存在清晰、可识别的二维码。",
  "不要判断广告、推广、招募、引流、联系方式、群卡片、文案内容或其他风险；这些内容无论是否明显都与本次判断无关。",
  "发现二维码时返回 risk_score=100、risk_level=high、decision=block、reason=二维码。",
  "没有发现二维码或无法确认时返回 risk_score=0、risk_level=low、decision=auto_pass、reason=未发现二维码。",
  "只返回 JSON：{\"risk_score\":0-100,\"risk_level\":\"low|high\",\"decision\":\"auto_pass|block\",\"reason\":\"一句短原因\",\"detail\":\"补充说明\"}",
].join("\n");
const QQ_GROUP_AD_KFC_MEME_PATTERNS = [
  /疯狂星期四/u,
  /[vV]\s*我\s*(?:50|五十)/u,
  /肯德基|kfc/iu,
];
const QQ_GROUP_AD_KFC_MEME_HARD_DIVERSION_PATTERNS = [
  /https?:\/\//iu,
  /www\./iu,
  /二维码|扫码/u,
  /加群|进群|拉群|群号/u,
  /(?:微信|vx|v信|威信)\s*(?:号|id)?\s*[:：]?\s*[a-z][a-z0-9_-]{5,19}\b/iu,
  /(?<!\d)1[3-9]\d{9}(?!\d)/u,
];
const QQ_GROUP_AD_QQ_NUMBER_PATTERN = /(?:QQ\s*(?:\u7fa4|\u7fa4\u53f7)|Q\s*\u7fa4|\u7fa4\u53f7).{0,16}\d{6,12}/iu;
const QQ_GROUP_AD_INVITE_NUMBER_PATTERN = /(?:\u52a0|\u8fdb|\u52a0\u5165|\u62c9|\u626b\u7801|\u8054\u7cfb|\u79c1\u804a).{0,24}\d{6,12}/u;
const QQ_GROUP_CAMPUS_RECRUITMENT_PATTERN = /(?:招新|纳新|招募(?:成员|新成员|队员|志愿者)?|报名|加入(?:我们|社团|协会)?)/u;
const QQ_GROUP_CAMPUS_ORGANIZATION_PATTERN = /(?:社团|协会|学生会|学生组织|兴趣小组|兴趣社|校队|志愿服务|校园活动|校园组织|院学生会|校学生会|部门招新)/u;
const QQ_GROUP_CAMPUS_CONTEXT_PATTERN = /(?:学校|校园|学院|大学|本科|学生|同学|校内|校级|院级|新生|班级)/u;
const QQ_GROUP_COMMERCIAL_AD_PATTERN = /(?:收费|付费|价格|售价|下单|购买|商品|服务费|佣金|兼职|刷单|代理(?:加盟|返利|商)?|加盟|培训班|培训收费|课程(?:销售|收费)|代购|推广返利|商业推广|商务合作|广告位|优惠券|折扣价|售卖|收款|付款|转账|返现|红包|招代理|招聘|公司|企业|品牌|商家|门店|招商|店铺)/u;
/**
 * Codex Spark/Codex variants currently reject image parts. Keep this guard
 * local to QQ ad review so a text-only moderation model can still be used for
 * normal messages while attachments are routed to the image-review model.
 */
const QQ_GROUP_AD_IMAGE_UNSUPPORTED_MODEL_PATTERNS = [
  /(?:^|[-_])spark(?:$|[-_])/iu,
  /(?:^|[-_])codex(?:$|[-_])/iu,
];
const localResultCache = new Map<string, { expiresAt: number; value: QqGroupAdReviewResult }>();

export function shouldRunQqGroupAdReview() {
  const config = getSiteConfig();
  return Boolean(config.qqGroupAdReviewEnabled && resolveSharedAiProviderConfig(config).apiKey);
}

export async function reviewQqGroupMessageForAd(input: {
  groupId: string;
  groupName?: string | null;
  qqId: string;
  nickname?: string | null;
  content: string;
  imageUrls?: string[];
  /** When enabled, any recognizable QR code in text/media is a hard block. */
  blockQrCodes?: boolean;
  /** Whitelisted media uses this mode so advertising intent can never affect the result. */
  reviewMode?: "full" | "qr-only";
  metadata?: Record<string, unknown> | null;
}): Promise<QqGroupAdReviewResult> {
  const config = getSiteConfig();
  const provider = resolveSharedAiProviderConfig(config);
  if (!config.qqGroupAdReviewEnabled || !provider.apiKey) {
    return {
      action: "allow",
      riskScore: 0,
      riskLevel: "low",
      reason: "QQ群广告过滤未开启",
      detail: "",
      model: config.qqGroupAdReviewModel,
      modelDecision: "auto_pass",
    };
  }

  const imageUrls = Array.from(new Set((input.imageUrls || []).map((url) => String(url || "").trim()).filter(Boolean))).slice(0, 4);
  const reviewMode = input.reviewMode === "qr-only" ? "qr-only" : "full";
  const hardBlockReason = reviewMode === "full"
    ? detectQqGroupAdHardBlockReason(input.content, input.blockQrCodes === true)
    : null;
  if (hardBlockReason) {
    return {
      action: "block",
      riskScore: 100,
      riskLevel: "high",
      reason: hardBlockReason,
      detail: "命中明确的 QQ 群号或加群导流特征，无需等待模型阈值判断。",
      model: "local-signal",
      modelDecision: "block",
    };
  }
  const localBypassReason = reviewMode === "full" && !imageUrls.length
    ? detectQqCampusOrganizationRecruitmentBypassReason(input.content)
      || detectHarmlessQqGroupAdBypassReason(input.content)
    : null;
  if (localBypassReason) {
    return {
      action: "allow",
      riskScore: 0,
      riskLevel: "low",
      reason: localBypassReason,
      detail: "命中本地学生组织/玩梗误判豁免，未见明确商业交易或商业推广证据。",
      model: "local-bypass",
      modelDecision: "auto_pass",
    };
  }

  const configHash = buildQqGroupAdReviewConfigHash(config);
  const normalizedContent = normalizeMessageForCache(input.content);
  const resultCacheKey = buildQqGroupAdReviewResultCacheKey({
    configHash,
    groupId: input.groupId,
    content: normalizedContent,
    imageUrls,
    blockQrCodes: input.blockQrCodes === true,
    reviewMode,
  });
  const cached = readLocalResultCache(resultCacheKey);
  if (cached) {
    return cached;
  }

  const preparedImages = imageUrls.length
    ? await prepareQqGroupAdImagePayloads(imageUrls)
    : [];
  if (imageUrls.length && !preparedImages.length) {
    throw Errors.server("QQ群图片读取失败，未将不可访问的图片地址直接交给模型；请稍后重试");
  }
  const qrPolicy = input.blockQrCodes === true
    ? "本群已开启“禁止二维码”：只要文字或任一附件（包括视频抽帧）中出现可识别二维码，即使没有其他广告文案，也必须 decision=block，并在 reason 中明确写“二维码”。\n\n"
    : "本群未开启强制二维码拦截；二维码本身不等于广告，只有同时构成真实商业导流、收费交易或商业推广时才拦截。校园社团/学生组织招新中的二维码是报名渠道，默认放行。\n\n";
  const campusPolicy = [
    "这是学生群，审核范围应保持窄：只过滤明确的商业广告，不要把普通校园信息当成广告。",
    "社团、协会、学生会、学生组织、兴趣小组、校队、志愿服务和校园活动的招新/纳新/报名/成员招募，只要没有收费、卖货、付费服务、兼职代理、刷单或商业返利等证据，默认 auto_pass。",
    "组织招新中的报名方式、联系人、QQ/微信群号、二维码或链接只是报名渠道，不是商业证据；不要仅因“招募、招新、加入、报名、加群、导流”等词 block。",
    "图片若是校内社团或学生组织招新海报，也按上述边界处理；只有画面同时出现明确收费交易、付费服务或商业推广，才按商业广告处理。",
    "证据不足时优先 auto_pass 或 manual_review，不能靠猜测 block。",
  ].join("\n");
  const promptText = reviewMode === "qr-only"
    ? "只检查本消息所附图片和视频抽帧里有没有可识别二维码。即使画面是明显广告、招新、推广或引流，也不得因此拦截；没有二维码就必须放行。"
    : `${qrPolicy}${campusPolicy}\n\n${imageUrls.length ? "这是一条包含附图的群消息。请直接查看附图，按学生群的窄范围商业广告边界判断；不要因为文字为空而放行。\n\n" : ""}${fillPromptTemplate(config.qqGroupAdReviewUserPrompt, {
        groupId: input.groupId,
        groupName: input.groupName || input.groupId,
        qqId: input.qqId,
        nickname: input.nickname || "",
        content: input.content,
        metadataJson: JSON.stringify({ ...(input.metadata || {}), imageUrls, blockQrCodes: input.blockQrCodes === true }),
      })}`;
  const userContent = [
    { type: "text" as const, text: promptText },
    ...preparedImages.map((image) => ({
      type: "image_url" as const,
      image_url: { url: image.dataUrl, detail: "auto" as const },
    })),
  ];
  const messages = [
    { role: "system" as const, content: reviewMode === "qr-only" ? QQ_GROUP_QR_ONLY_SYSTEM_PROMPT : config.qqGroupAdReviewSystemPrompt },
    { role: "user" as const, content: userContent },
  ];
  const reviewProvider = preparedImages.length
    ? resolveQqGroupAdImageProvider(config, provider)
    : provider;
  const endpoint = normalizeAiJsonApiUrl(reviewProvider.apiUrl, provider.apiUrl || "https://api.deepseek.com/chat/completions");
  const candidates = resolveQqGroupAdModelCandidates(config, preparedImages.length > 0);
  if (!candidates.length) {
    throw Errors.server("QQ群图片广告过滤未配置支持图片输入的模型，请在后台把‘图片审核’模型改为支持视觉输入的模型（例如 gpt-4o-mini）");
  }
  const promptCacheKey = buildQqGroupAdPromptCacheKey({
    configHash,
    groupId: input.groupId,
    reviewMode,
  });
  let lastError: Error | null = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const model = candidates[index];
    const started = await startAiReviewLog({
      kind: "qqbot-group-ad",
      targetId: null,
      targetLabel: `${input.groupName || input.groupId} / ${input.qqId}`,
      createdById: null,
      provider: config.qqGroupAdReviewProvider,
      model,
      endpoint,
      requestSummary: promptText,
    });
    const logId = started?.id ?? null;

    let response: Response;
    let responseMode = detectReviewApiMode(endpoint);
    let responseErrorText = "";
    try {
      const result = await sendAiJsonRequest({
        endpoint,
        apiKey: reviewProvider.apiKey,
        model,
        temperature: 0.1,
        messages,
        promptCacheKey,
        enablePromptCacheRetention: true,
      });
      response = result.response;
      responseMode = result.mode;
      responseErrorText = result.errorText;
    } catch (error) {
      const detail = describeRequestError(error);
      await finishAiReviewLogError(logId, "FETCH_ERROR", detail);
      lastError = Errors.server(`QQ群广告过滤请求失败：${detail}`);
      if (index < candidates.length - 1) continue;
      throw lastError;
    }

    if (!response.ok) {
      const text = responseErrorText || await response.text().catch(() => "");
      await finishAiReviewLogError(logId, `HTTP ${response.status}`, text);
      const canFallback = index < candidates.length - 1 && shouldFallbackToNextModel(response.status, text);
      if (canFallback) {
        lastError = Errors.server(`QQ群广告过滤模型 ${model} 当前不可用，已自动尝试下一个备选模型`);
        continue;
      }
      throw Errors.server(`QQ群广告过滤请求失败：${response.status}${text ? ` ${text.slice(0, 120)}` : ""}`);
    }

    let json: any;
    try {
      json = await response.json();
    } catch (error) {
      const detail = describeRequestError(error);
      await finishAiReviewLogError(logId, "INVALID_JSON", detail);
      throw Errors.server(`QQ群广告过滤返回解析失败：${detail}`);
    }

    const content = extractAiJsonTextResponse(json, responseMode);
    await finishAiReviewLogSuccess(logId, typeof content === "string" ? content : JSON.stringify(content ?? {}).slice(0, 4000));

    const parsed = parseAdReviewResponse(content);
    const riskScore = clampScore(parsed.risk_score);
    const modelDecision = String(parsed.decision || "").trim().toLowerCase();
    const action = reviewMode === "qr-only"
      ? resolveQqGroupQrOnlyReviewAction({ riskScore, modelDecision })
      : resolveQqGroupAdReviewAction({
          riskScore,
          threshold: config.qqGroupAdReviewThreshold,
          modelDecision,
        });
    const result: QqGroupAdReviewResult = {
      action,
      riskScore,
      riskLevel: normalizeRiskLevel(parsed.risk_level),
      reason: reviewMode === "qr-only"
        ? (action === "block" ? "二维码" : "未发现二维码")
        : String(parsed.reason || "").trim() || (action === "block" ? "疑似广告或引流内容" : "通过"),
      detail: String(parsed.detail || "").trim(),
      model,
      modelDecision,
    };
    writeLocalResultCache(resultCacheKey, result, QQ_GROUP_AD_REVIEW_RESULT_CACHE_TTL_MS);
    return result;
  }

  throw lastError || Errors.server("QQ群广告过滤请求失败");
}

export function detectHarmlessQqGroupAdBypassReason(input: string) {
  const content = normalizeMessageForCache(input);
  if (!content) return null;
  const normalized = content.toLowerCase();
  const memeSignalCount = QQ_GROUP_AD_KFC_MEME_PATTERNS.reduce((count, pattern) => (
    pattern.test(content) ? count + 1 : count
  ), 0);
  if (memeSignalCount < 2) return null;
  if (QQ_GROUP_AD_KFC_MEME_HARD_DIVERSION_PATTERNS.some((pattern) => pattern.test(normalized))) return null;
  return "命中疯狂星期四等玩梗文案豁免";
}

/**
 * Student clubs and campus organizations are legitimate group content even
 * when they publish a QQ group number for sign-up. Require both a recruitment
 * signal and a clear organization/campus signal, and reject the bypass when
 * commercial wording is present so this remains a narrow exception.
 */
export function detectQqCampusOrganizationRecruitmentBypassReason(input: string) {
  const content = normalizeMessageForCache(input);
  if (!content || !QQ_GROUP_CAMPUS_RECRUITMENT_PATTERN.test(content)) return null;
  const hasOrganizationSignal = QQ_GROUP_CAMPUS_ORGANIZATION_PATTERN.test(content);
  const hasCampusContext = QQ_GROUP_CAMPUS_CONTEXT_PATTERN.test(content);
  if (!hasOrganizationSignal || (!hasCampusContext && !/(?:社团|学生会|学生组织|校队|志愿服务)/u.test(content))) return null;
  if (QQ_GROUP_COMMERCIAL_AD_PATTERN.test(content)) return null;
  return "命中校园社团/学生组织招新豁免";
}

export function detectQqGroupAdHardBlockReason(input: string, blockQrCodes = false) {
  const content = normalizeMessageForCache(input);
  if (!content) return null;
  if (blockQrCodes && /二维码|扫码|扫描二维码/u.test(content)) return "包含二维码或扫码引导（本群已开启禁止二维码）";
  if (detectQqCampusOrganizationRecruitmentBypassReason(content)) return null;
  if (QQ_GROUP_AD_QQ_NUMBER_PATTERN.test(content)) return "包含 QQ 群号并带有群号导流";
  if (QQ_GROUP_AD_INVITE_NUMBER_PATTERN.test(content)) return "包含明确的加群/联系导流号码";
  return null;
}

function fillPromptTemplate(template: string, values: Record<string, string>) {
  return String(template || "").replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? "");
}

function readLocalResultCache(key: string) {
  const cached = localResultCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    localResultCache.delete(key);
    return null;
  }
  return cached.value;
}

function writeLocalResultCache(key: string, value: QqGroupAdReviewResult, ttlMs: number) {
  pruneLocalResultCache();
  localResultCache.set(key, {
    value,
    expiresAt: Date.now() + Math.max(1, ttlMs),
  });
}

function pruneLocalResultCache() {
  const now = Date.now();
  if (localResultCache.size > 500) {
    for (const [key, cached] of localResultCache.entries()) {
      if (cached.expiresAt <= now) localResultCache.delete(key);
    }
  }
}

function normalizeMessageForCache(input: string) {
  return String(input || "").replace(/\s+/g, " ").trim();
}

function buildQqGroupAdReviewConfigHash(config: ReturnType<typeof getSiteConfig>) {
  return hashString([
    config.qqGroupAdReviewProvider,
    resolveSharedAiProviderConfig(config).apiUrl,
    config.qqGroupAdReviewModel,
    config.qqGroupAdReviewFallbackModels,
    config.imageReviewApiUrl,
    config.imageReviewModel,
    config.imageReviewFallbackModels,
    config.qqGroupAdReviewThreshold,
    config.qqGroupAdReviewSystemPrompt,
    config.qqGroupAdReviewUserPrompt,
  ].join("\n"));
}

function buildQqGroupAdReviewResultCacheKey(input: {
  configHash: string;
  groupId: string;
  content: string;
  imageUrls: string[];
  blockQrCodes: boolean;
  reviewMode: "full" | "qr-only";
}) {
  return `qqbot:group-ad-review:${hashString(`${input.configHash}\n${input.groupId}\n${input.reviewMode}\n${input.content}\n${input.blockQrCodes ? "qr-block" : "qr-normal"}\n${input.imageUrls.join("\n")}`)}`;
}

/**
 * Resolve the model order for QQ ad review. Text messages keep using the
 * dedicated QQ model. Messages with images start with the separately
 * configurable image-review model, then use its fallbacks and finally any
 * compatible QQ models. This prevents a configured Spark model from receiving
 * an image payload and turning a moderation event into a 400 error.
 */
export function resolveQqGroupAdModelCandidates(
  config: Pick<ReturnType<typeof getSiteConfig>, "qqGroupAdReviewModel" | "qqGroupAdReviewFallbackModels" | "imageReviewModel" | "imageReviewFallbackModels">,
  hasImages: boolean,
) {
  const textCandidates = resolveModelCandidates(config.qqGroupAdReviewModel, config.qqGroupAdReviewFallbackModels);
  if (!hasImages) return textCandidates;
  const imageCandidates = resolveModelCandidates(config.imageReviewModel, config.imageReviewFallbackModels);
  const candidates = [...imageCandidates, ...textCandidates];
  const seen = new Set<string>();
  return candidates.filter((model) => {
    const key = model.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return !QQ_GROUP_AD_IMAGE_UNSUPPORTED_MODEL_PATTERNS.some((pattern) => pattern.test(model));
  });
}

function resolveQqGroupAdImageProvider(
  config: ReturnType<typeof getSiteConfig>,
  fallback: { apiUrl: string; apiKey: string },
) {
  const imageApiKey = String(config.imageReviewApiKey || "").trim();
  const imageApiUrl = String(config.imageReviewApiUrl || "").trim();
  return {
    apiUrl: imageApiKey && imageApiUrl ? imageApiUrl : fallback.apiUrl,
    apiKey: imageApiKey || fallback.apiKey,
  };
}

type PreparedQqGroupAdImage = {
  sourceUrl: string;
  dataUrl: string;
};

/**
 * The URLs produced by the QQ renderer are normally private `/uploads/...`
 * paths. An external AI gateway cannot fetch those paths reliably, so image
 * moderation must read the original bytes on this server and send them as an
 * inline data URL. The bytes are not resized or recompressed.
 */
export async function prepareQqGroupAdImagePayloads(imageUrls: string[]): Promise<PreparedQqGroupAdImage[]> {
  const uniqueUrls = Array.from(new Set(imageUrls.map((value) => String(value || "").trim()).filter(Boolean))).slice(0, 4);
  const prepared = await Promise.allSettled(uniqueUrls.map((url) => prepareQqGroupAdImagePayload(url)));
  return prepared.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
}

async function prepareQqGroupAdImagePayload(sourceUrl: string): Promise<PreparedQqGroupAdImage> {
  if (/^data:image\/(?:jpeg|png|webp|gif);base64,/i.test(sourceUrl)) {
    const base64 = sourceUrl.slice(sourceUrl.indexOf(",") + 1).replace(/\s+/g, "");
    const byteLength = Buffer.byteLength(base64, "base64");
    if (!byteLength || byteLength > QQ_GROUP_AD_IMAGE_MAX_INLINE_BYTES) {
      throw new Error(byteLength ? "QQ群图片文件过大" : "QQ群图片文件为空");
    }
    return { sourceUrl, dataUrl: sourceUrl };
  }

  const preparedFile = await prepareMediaLocalFileForProcessing(sourceUrl);
  try {
    let buffer: Buffer;
    let fileHint = preparedFile.localPath || sourceUrl;
    let responseMime = "";
    if (preparedFile.localPath) {
      buffer = await readFile(preparedFile.localPath);
    } else if (/^https?:\/\//i.test(sourceUrl)) {
      const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`QQ群图片下载失败：HTTP ${response.status}`);
      const contentLength = Number(response.headers.get("content-length") || 0);
      if (contentLength > QQ_GROUP_AD_IMAGE_MAX_INLINE_BYTES) throw new Error("QQ群图片文件过大");
      buffer = Buffer.from(await response.arrayBuffer());
      responseMime = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    } else {
      throw new Error("QQ群图片没有可读取的本地文件或网络地址");
    }
    if (!buffer.length || buffer.length > QQ_GROUP_AD_IMAGE_MAX_INLINE_BYTES) {
      throw new Error(buffer.length ? "QQ群图片文件过大" : "QQ群图片文件为空");
    }
    const mimeType = detectQqGroupAdImageMimeType(buffer, fileHint, responseMime);
    if (!mimeType) throw new Error("QQ群图片格式不受支持");
    return {
      sourceUrl,
      dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
    };
  } finally {
    if (preparedFile.temporary && preparedFile.localPath) {
      await rm(preparedFile.localPath, { force: true }).catch(() => undefined);
    }
  }
}

function detectQqGroupAdImageMimeType(buffer: Buffer, fileHint: string, responseMime = "") {
  const normalizedMime = responseMime.toLowerCase();
  if (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(normalizedMime)) return normalizedMime;
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buffer.length >= 6) {
    const header = buffer.subarray(0, 6).toString("ascii");
    if (header === "GIF87a" || header === "GIF89a") return "image/gif";
  }
  const ext = path.extname(fileHint).replace(/^\./, "").toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "";
}

function buildQqGroupAdPromptCacheKey(input: {
  configHash: string;
  groupId: string;
  reviewMode: "full" | "qr-only";
}) {
  return `qqbot-group-ad:${hashString(`${input.configHash}\n${input.groupId}\n${input.reviewMode}`)}`;
}

function hashString(input: string) {
  return createHash("sha256").update(input).digest("hex").slice(0, 24);
}

function describeRequestError(error: unknown) {
  const parts: string[] = [];
  const maybeError = error as { message?: unknown; cause?: unknown; code?: unknown };
  if (typeof maybeError?.message === "string" && maybeError.message.trim()) parts.push(maybeError.message.trim());
  if (typeof maybeError?.code === "string" && maybeError.code.trim()) parts.push(maybeError.code.trim());
  const cause = maybeError?.cause as { message?: unknown; code?: unknown } | undefined;
  if (typeof cause?.message === "string" && cause.message.trim()) parts.push(cause.message.trim());
  if (typeof cause?.code === "string" && cause.code.trim()) parts.push(cause.code.trim());
  if (!parts.length && error) parts.push(String(error));
  return Array.from(new Set(parts)).join("；").slice(0, 500) || "网络请求失败";
}

function detectReviewApiMode(endpoint: string) {
  return /\/responses\/?$/i.test(endpoint) ? "responses" as const : "chat_completions" as const;
}

function parseAdReviewResponse(content: unknown): QqGroupAdResponse {
  const text = typeof content === "string" ? content.trim() : "";
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === "object" && parsed ? parsed as QqGroupAdResponse : {};
  } catch {
    return {};
  }
}

function clampScore(value: unknown) {
  const score = Number(value);
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function normalizeRiskLevel(value: unknown): "low" | "medium" | "high" {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "high") return "high";
  if (normalized === "medium") return "medium";
  return "low";
}

export function resolveQqGroupAdReviewAction(input: {
  riskScore: number;
  threshold: number;
  modelDecision: string;
}): "allow" | "block" {
  if (input.modelDecision === "manual_review") return "allow";
  if (input.modelDecision === "block" && input.riskScore >= Math.max(0, input.threshold - 10)) return "block";
  return input.riskScore >= input.threshold ? "block" : "allow";
}

/** QR-only checks must have an explicit, high-confidence QR decision. */
export function resolveQqGroupQrOnlyReviewAction(input: {
  riskScore: number;
  modelDecision: string;
}): "allow" | "block" {
  return input.modelDecision === "block" && input.riskScore >= 80 ? "block" : "allow";
}
