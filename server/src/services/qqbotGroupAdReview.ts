import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { Errors } from "../utils/response";
import { finishAiReviewLogError, finishAiReviewLogSuccess, startAiReviewLog } from "./aiReviewLog";
import { extractAiJsonTextResponse, normalizeAiJsonApiUrl, sendAiJsonRequestWithProviderFallback } from "./aiJsonApi";
import { resolveModelCandidates, shouldFallbackToNextModel } from "./modelFallback";
import { prepareMediaLocalFileForProcessing } from "./mediaStorage";
import { decodeQqImageDataUrl, normalizeQqImageForAi } from "./qqbot/imageValidation";
import { getSiteConfig, hasAiProviderAccess, isAiProviderReady, resolveAiServiceCandidatesForScene, resolveAiServiceForScene } from "./siteSettings";

type QqGroupAdResponse = {
  risk_score?: number;
  risk_level?: string;
  decision?: string;
  assistant_intent?: string | boolean;
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
  assistantIntent: boolean;
};

export type QqGroupAdPeakMode = {
  active: boolean;
  start: string;
  end: string;
  serviceId: string;
  model: string;
  timeZone: "Asia/Shanghai";
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
const QQ_GROUP_COMMERCIAL_GROUP_DIVERSION_PATTERN = /(?:兼职|家教|家教兼职|代课|辅导|招工|招聘|招代理|刷单|付费培训|课程销售)/u;
const QQ_GROUP_NUMBER_ANY_LABEL_PATTERN = /(?:群|群号).{0,16}\d{6,12}/u;
const QQ_GROUP_UNOFFICIAL_NOTICE_PATTERN = /(?:学校(?:重要)?(?:消息|通知)|校方(?:重要)?(?:消息|通知)|校园官方|官方(?:群|通知)|重要通知|军训通知|新生(?:活动|开学|入学)?通知|录取通知|通知书(?:邮寄|发放)|开学(?:时间|安排|通知)|入党(?:事宜|通知)|入团(?:事宜|通知)|转换专业(?:事宜|通知)?)/u;
const QQ_GROUP_MASS_INVITE_PATTERN = /(?:@全体成员|最后(?:一次|一条)通知|别错过|务必|抓紧|今晚|截至|互相转达|(?:请|大家).{0,16}(?:加|进|加入|扫码))/u;
const QQ_GROUP_UNVERIFIED_TARGET_PATTERN = /(?:新生(?:通知)?群|通知群|官方群|官方(?:群|通知)|入学群|资料群)/u;
const QQ_GROUP_DISSOLUTION_PATTERN = /(?:本群|此群|该群)(?:作废|即将解散|将要解散|即将关闭|停止使用)/u;
const QQ_GROUP_REPLACEMENT_DIVERSION_PATTERN = /(?:所有人|大家|请各位|请大家|成员).{0,20}(?:转移|转到|迁移|前往).{0,24}(?:新群|群号|QQ群|Q群)/u;
const QQ_GROUP_SUSPICIOUS_NICKNAME_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /学(?:姐|长)/u, reason: "疑似以学长学姐身份接近新生" },
  { pattern: /(?:学生工作处|学工处|教务处|招生办|辅导员|班主任|校方|学校官方|官方通知)/u, reason: "疑似冒充学校部门或教职人员" },
  { pattern: /(?:菜鸟驿站|驿站(?:通知|客服|取件))/u, reason: "疑似冒充快递驿站通知" },
  { pattern: /(?:q|qq)\s*群\s*管家|群\s*管家/iu, reason: "疑似冒充 QQ 群管理身份" },
];
const QQ_GROUP_IDENTITY_DIVERSION_PATTERN = /(?:https?:\/\/|www\.|二维码|扫码|加群|进群|入群|加入(?:新)?群|群号|私聊|联系(?:我|本人|客服)?|加(?:我|好友|微信|QQ)|(?:微信|vx|v信|威信)\s*(?:号|id)?\s*[:：]?\s*[a-z][a-z0-9_-]{5,19}\b|(?<!\d)1[3-9]\d{9}(?!\d)|(?:QQ\s*(?:群|群号)|Q\s*群|群号).{0,16}\d{6,12})/iu;
const QQ_GROUP_SENIOR_TARGET_PATTERN = /(?:新生|大一|准大学生|入学|开学|宿舍|军训|录取|通知书|资料|官方群|通知群)/u;
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
  const providers = resolveAiServiceCandidatesForScene(config, "qq-group-ad");
  return Boolean(config.qqGroupAdReviewEnabled && providers.some((provider) => isAiProviderReady({
    provider: provider.provider,
    apiUrl: provider.apiUrl,
    apiKey: provider.apiKey,
    model: config.qqGroupAdReviewModel,
  })));
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
  /** Keep the ad model in intent-only mode when the group ad switch is off. */
  moderationEnabled?: boolean;
  /** Ask the same review call whether this plain-text group message clearly asks the bot for an answer. */
  detectAssistantIntent?: boolean;
  metadata?: Record<string, unknown> | null;
}): Promise<QqGroupAdReviewResult> {
  const config = getSiteConfig();
  const reviewMode = input.reviewMode === "qr-only" ? "qr-only" : "full";
  const moderationEnabled = input.moderationEnabled !== false;
  const peakMode = resolveQqGroupAdPeakMode(config);
  const enhancedMode = moderationEnabled && reviewMode === "full" && peakMode.active;
  const effectiveTextModel = enhancedMode && peakMode.model
    ? peakMode.model
    : config.qqGroupAdReviewModel;
  const providers = resolveAiServiceCandidatesForScene(config, "qq-group-ad");
  const provider = providers[0];
  const peakProvider = resolveQqGroupAdPeakProvider(config, provider);
  const peakRouteReady = enhancedMode && Boolean(peakMode.model) && isAiProviderReady({
    provider: peakProvider.provider,
    apiUrl: peakProvider.apiUrl,
    apiKey: peakProvider.apiKey,
    model: peakMode.model,
  });
  const readyProviders = peakRouteReady ? [peakProvider, ...providers] : providers;
  if (!config.qqGroupAdReviewEnabled || !readyProviders.some((candidate) => isAiProviderReady({
    provider: candidate.provider,
    apiUrl: candidate.apiUrl,
    apiKey: candidate.apiKey,
    model: peakRouteReady && candidate === peakProvider ? peakMode.model : config.qqGroupAdReviewModel,
  }))) {
    return {
      action: "allow",
      riskScore: 0,
      riskLevel: "low",
      reason: "QQ群广告过滤未开启",
      detail: "",
      model: peakRouteReady ? effectiveTextModel : config.qqGroupAdReviewModel,
      modelDecision: "auto_pass",
      assistantIntent: false,
    };
  }

  const imageUrls = Array.from(new Set((input.imageUrls || []).map((url) => String(url || "").trim()).filter(Boolean))).slice(0, 4);
  const detectAssistantIntent = input.detectAssistantIntent === true && reviewMode === "full";
  const nicknameRiskReason = enhancedMode
    ? detectSuspiciousQqNicknameReason(input.nickname)
    : null;
  const identityDiversionReason = enhancedMode
    ? detectQqNicknameImpersonationDiversionReason(input.nickname, input.content)
    : null;
  const hardBlockReason = moderationEnabled && reviewMode === "full"
    ? identityDiversionReason || detectQqGroupAdHardBlockReason(input.content, input.blockQrCodes === true)
    : null;
  if (hardBlockReason) {
    return {
      action: "block",
      riskScore: 100,
      riskLevel: "high",
      reason: hardBlockReason,
      detail: identityDiversionReason
        ? "高峰增强模式命中疑似冒充身份昵称，且消息同时存在面向新生或外部联系导流证据。"
        : "命中明确的 QQ 群号或加群导流特征，无需等待模型阈值判断。",
      model: "local-signal",
      modelDecision: "block",
      assistantIntent: false,
    };
  }
  const localBypassReason = moderationEnabled && reviewMode === "full" && !enhancedMode && !imageUrls.length
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
      assistantIntent: false,
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
    moderationEnabled,
    detectAssistantIntent,
    nickname: normalizeNicknameForRisk(input.nickname),
    enhancedMode,
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
  const assistantIntentInstruction = detectAssistantIntent
    ? [
        "另外，请单独判断这条纯文字群消息是否明确希望 QQBot 回答一个有具体内容的问题。只有消息本身清楚地提出知识咨询、功能咨询、求助、询问做法或要求解释时才算 reply；普通陈述、打招呼、吐槽、闲聊、转述他人问题、催促机器人回应、询问机器人为什么没回复，或仅仅出现疑问词/问号都算 none。不要使用关键词命中代替语义判断。",
        "严格示例：‘怎么刷课？’、‘教务处没反应怎么办？’ -> reply；‘为什么不理我？’、‘怎么还不回复？’、‘在吗？’、‘谢谢’ -> none。前两类是可实际回答的内容问题，后一类只是对机器人状态或社交回应的追问。",
        "请在 JSON 中增加 assistant_intent 字段，只能填写 reply 或 none。该字段只表示是否应转给 QQBot，不改变广告 decision。",
      ].join("\n")
    : "";
  const campusPolicy = [
    "这是学生群，审核范围应保持窄：只过滤明确的商业广告，不要把普通校园信息当成广告。",
    "社团、协会、学生会、学生组织、兴趣小组、校队、志愿服务和校园活动的招新/纳新/报名/成员招募，只要没有收费、卖货、付费服务、兼职代理、刷单或商业返利等证据，默认 auto_pass。",
    "组织招新中的报名方式、联系人、QQ/微信群号、二维码或链接只是报名渠道，不是商业证据；不要仅因“招募、招新、加入、报名、加群、导流”等词 block。",
    "家教、兼职、代课、辅导、招工、付费培训、课程销售等以报酬或商业服务为核心的信息属于商业广告；即使和游戏群、兴趣群或其他校园信息列在一起，只要附有群号、联系方式或报名引导，也应 block。",
    "图片若是校内社团或学生组织招新海报，也按上述边界处理；只有画面同时出现明确收费交易、付费服务或商业推广，才按商业广告处理。",
    "特别注意：如果文本或图片把内容包装成“学校重要消息”“官方通知”“校园官方官方群”等，并以军训、宿舍、开学、入党入团或新生安排为名，要求加入未核验 QQ 群、扫码、转发或在截止时间前完成操作，视为疑似冒充官方的引流消息，必须 decision=block；不得因其中出现“社团招新”“学生会”等字样而套用校园组织招新豁免。",
    "证据不足时优先 auto_pass 或 manual_review，不能靠猜测 block。",
  ].join("\n");
  const enhancedPolicy = enhancedMode
    ? [
        "当前处于广告高峰增强审核时段，请更仔细核对冒充身份、面向新生建立信任、伪造官方/物流/群管理通知后再导流等组合风险，不得因文案写得像校园通知就降低警惕。",
        `发送者昵称风险信号：${nicknameRiskReason || "未命中已知冒充身份样式"}。`,
        "昵称风险信号只能提高核查强度，不能单独作为拦截依据；需要结合消息中的加群、扫码、联系方式、外链、收费交易、虚假通知或面向新生的诱导证据作出判断。",
        "高峰增强模式仅适用于非白名单用户。合法校园讨论和没有导流/商业证据的普通消息仍应放行。",
      ].join("\n")
    : "";
  const effectiveMetadata = {
    ...(input.metadata || {}),
    imageUrls,
    blockQrCodes: input.blockQrCodes === true,
    enhancedMode,
    ...(enhancedMode ? {
      peakWindow: `${peakMode.start}-${peakMode.end}`,
      peakTimeZone: peakMode.timeZone,
      peakServiceId: peakMode.serviceId,
      nicknameRiskReason: nicknameRiskReason || "",
    } : {}),
  };
  const promptText = reviewMode === "qr-only"
    ? "只检查本消息所附图片和视频抽帧里有没有可识别二维码。即使画面是明显广告、招新、推广或引流，也不得因此拦截；没有二维码就必须放行。"
    : `${moderationEnabled ? qrPolicy : "本次不执行广告拦截，只判断是否明确希望 QQBot 回答。\n\n"}${moderationEnabled ? campusPolicy : ""}${enhancedPolicy ? `\n\n${enhancedPolicy}` : ""}${imageUrls.length ? "\n\n这是一条包含附图的群消息。请直接查看附图；附图消息不会转给日常问答。" : ""}\n\n${fillPromptTemplate(config.qqGroupAdReviewUserPrompt, {
        groupId: input.groupId,
        groupName: input.groupName || input.groupId,
        qqId: input.qqId,
        nickname: input.nickname || "",
        content: input.content,
        metadataJson: JSON.stringify(effectiveMetadata),
      })}${assistantIntentInstruction}`;
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
  const attachmentSummary = preparedImages.length
    ? `\n\n[附件诊断] ${preparedImages.map((image, index) => `图片${index + 1}：${image.sourceMimeType} -> ${image.mimeType}，${image.byteLength} bytes，${image.transcoded ? "已转码" : "原格式"}，sha256=${image.sha256}`).join("；")}`
    : "";
  const reviewMetadataSummary = Object.keys(effectiveMetadata).length
    ? `\n\n[审核路径诊断] ${JSON.stringify(effectiveMetadata).slice(0, 1800)}`
    : "";
  const reviewProvider = preparedImages.length
    ? resolveQqGroupAdImageProvider(config, provider)
    : provider;
  const imageProviders = preparedImages.length
    ? resolveAiServiceCandidatesForScene(config, "image-review")
    : [];
  const standardProviderCandidates = preparedImages.length
    ? (imageProviders.some((candidate) => hasAiProviderAccess(candidate)) ? imageProviders : [reviewProvider])
    : providers;
  const candidates = resolveQqGroupAdModelCandidates(config, preparedImages.length > 0, peakRouteReady);
  if (!candidates.length) {
    throw Errors.server("QQ群图片广告过滤未配置支持图片输入的模型，请在后台把‘图片审核’模型改为支持视觉输入的模型（例如 gpt-4o-mini）");
  }
  const promptCacheKey = buildQqGroupAdPromptCacheKey({
    configHash,
    groupId: input.groupId,
    reviewMode,
    moderationEnabled,
    detectAssistantIntent,
    enhancedMode,
  });
  let lastError: Error | null = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const model = candidates[index];
    const providerCandidates = resolveQqGroupAdProviderCandidatesForModel({
      standardProviders: standardProviderCandidates,
      peakProvider,
      model,
      normalModel: config.qqGroupAdReviewModel,
      peakModel: peakMode.model,
      peakRouteReady,
      hasImages: preparedImages.length > 0,
    });
    const attemptProvider = providerCandidates[0] || reviewProvider;
    const endpoint = normalizeAiJsonApiUrl(
      attemptProvider.apiUrl,
      provider.apiUrl || "https://api.deepseek.com/chat/completions",
    );
    const started = await startAiReviewLog({
      kind: "qqbot-group-ad",
      targetId: null,
      targetLabel: `${input.groupName || input.groupId} / ${input.qqId}`,
      createdById: null,
      provider: attemptProvider.provider,
      model,
      endpoint,
      requestSummary: `${promptText}${attachmentSummary}${reviewMetadataSummary}`,
    });
    const logId = started?.id ?? null;

    let response: Response;
    let responseMode = detectReviewApiMode(endpoint);
    let responseErrorText = "";
    try {
      const result = await sendAiJsonRequestWithProviderFallback({
        providers: providerCandidates,
        fallbackEndpoint: endpoint,
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
    const policyHardBlock = input.blockQrCodes === true
      && modelDecision === "block"
      && isQqGroupQrDecision(parsed.reason, parsed.detail);
    const action = reviewMode === "qr-only"
      ? resolveQqGroupQrOnlyReviewAction({ riskScore, modelDecision })
      : !moderationEnabled
        ? "allow" as const
        : resolveQqGroupAdReviewAction({
          riskScore,
          threshold: config.qqGroupAdReviewThreshold,
          modelDecision,
          policyHardBlock,
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
      assistantIntent: detectAssistantIntent && shouldForwardQqBotAssistantIntent(
        input.content,
        parsed.assistant_intent,
      ),
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

function normalizeNicknameForRisk(input: string | null | undefined) {
  return String(input || "")
    .normalize("NFKC")
    .replace(/[\u200b-\u200f\u2060\ufeff]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Nicknames that present the sender as a senior student, school office,
 * parcel station or QQ group administrator are useful risk signals during
 * peak-hour review. A nickname alone never blocks a message.
 */
export function detectSuspiciousQqNicknameReason(input: string | null | undefined) {
  const nickname = normalizeNicknameForRisk(input);
  if (!nickname) return null;
  return QQ_GROUP_SUSPICIOUS_NICKNAME_PATTERNS.find(({ pattern }) => pattern.test(nickname))?.reason || null;
}

/**
 * Enhanced mode may hard-block only when a suspicious identity nickname is
 * paired with actual diversion evidence. Senior-student nicknames additionally
 * require a freshman/arrival context so ordinary conversations are not caught.
 */
export function detectQqNicknameImpersonationDiversionReason(
  nicknameInput: string | null | undefined,
  contentInput: string,
) {
  const nickname = normalizeNicknameForRisk(nicknameInput);
  const nicknameReason = detectSuspiciousQqNicknameReason(nickname);
  const content = normalizeMessageForCache(contentInput);
  if (!nicknameReason || !content || !QQ_GROUP_IDENTITY_DIVERSION_PATTERN.test(content)) return null;
  if (/学(?:姐|长)/u.test(nickname) && !QQ_GROUP_SENIOR_TARGET_PATTERN.test(content)) return null;
  return `疑似使用冒充身份昵称进行导流（${nicknameReason}）`;
}

/**
 * A message must not use the student-organization exception to disguise an
 * unverified QQ group as a school or official notification. A QQ group number
 * is not required when the message names a suspicious group target such as a
 * "新生通知群" or "官方群" and uses mass-invite language.
 */
export function detectQqUnofficialNoticeDiversionReason(input: string) {
  const content = normalizeMessageForCache(input);
  if (!content) return null;
  const hasDissolutionDiversion = QQ_GROUP_DISSOLUTION_PATTERN.test(content)
    && QQ_GROUP_REPLACEMENT_DIVERSION_PATTERN.test(content)
    && /(?<!\d)\d{6,12}(?!\d)/u.test(content);
  if (hasDissolutionDiversion) return "疑似冒充学校/官方通知并引导加入未核验 QQ 群";
  if (!QQ_GROUP_UNOFFICIAL_NOTICE_PATTERN.test(content)) return null;
  const hasQqGroupNumber = QQ_GROUP_AD_QQ_NUMBER_PATTERN.test(content);
  const groupNumbers = content.match(/(?<!\d)\d{6,12}(?!\d)/gu) || [];
  const hasRepeatedGroupNumber = new Set(groupNumbers).size < groupNumbers.length;
  const hasUnverifiedGroupTarget = QQ_GROUP_UNVERIFIED_TARGET_PATTERN.test(content);
  if (!hasQqGroupNumber && !hasUnverifiedGroupTarget) return null;
  if (!QQ_GROUP_MASS_INVITE_PATTERN.test(content) && !hasRepeatedGroupNumber) return null;
  return "疑似冒充学校/官方通知并引导加入未核验 QQ 群";
}

export function detectQqGroupAdHardBlockReason(input: string, blockQrCodes = false) {
  const content = normalizeMessageForCache(input);
  if (!content) return null;
  if (blockQrCodes && /二维码|扫码|扫描二维码/u.test(content)) return "包含二维码或扫码引导（本群已开启禁止二维码）";
  if (QQ_GROUP_COMMERCIAL_GROUP_DIVERSION_PATTERN.test(content) && QQ_GROUP_NUMBER_ANY_LABEL_PATTERN.test(content)) {
    return "包含兼职/家教等商业招募并附群号导流";
  }
  const unofficialNoticeReason = detectQqUnofficialNoticeDiversionReason(content);
  if (unofficialNoticeReason) return unofficialNoticeReason;
  if (detectQqCampusOrganizationRecruitmentBypassReason(content)) return null;
  if (QQ_GROUP_AD_QQ_NUMBER_PATTERN.test(content)) return "包含 QQ 群号并带有群号导流";
  if (QQ_GROUP_AD_INVITE_NUMBER_PATTERN.test(content)) return "包含明确的加群/联系导流号码";
  return null;
}

/**
 * Choose the only permitted moderation path for a valid per-group whitelist.
 * Group cards keep their explicit switch; every other reviewable attachment is
 * either QR-only or bypassed without entering the advertising prompt.
 */
export function resolveQqGroupWhitelistReviewPlan(input: {
  whitelisted: boolean;
  hasGroupCard: boolean;
  hasReviewableMedia: boolean;
  hasQrTextSignal?: boolean;
  blockQrCode: boolean;
  blockGroupCard: boolean;
}): "full" | "qr-only" | "block-group-card" | "bypass" {
  if (!input.whitelisted) return "full";
  if (input.hasGroupCard && input.blockGroupCard) return "block-group-card";
  if ((input.hasReviewableMedia || input.hasQrTextSignal) && input.blockQrCode) return "qr-only";
  return "bypass";
}

function parseTimeOfDayMinutes(value: unknown) {
  const match = String(value || "").trim().match(/^(\d{2}):([0-5]\d)$/u);
  if (!match) return null;
  const hour = Number(match[1]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  return hour * 60 + Number(match[2]);
}

/** Resolve the configured daily window against China Standard Time (UTC+8). */
export function resolveQqGroupAdPeakMode(
  config: Pick<ReturnType<typeof getSiteConfig>,
    "qqGroupAdReviewPeakEnabled" | "qqGroupAdReviewPeakStart" | "qqGroupAdReviewPeakEnd" | "qqGroupAdReviewPeakServiceId" | "qqGroupAdReviewPeakModel"
  >,
  now = new Date(),
): QqGroupAdPeakMode {
  const start = String(config.qqGroupAdReviewPeakStart || "00:30").trim();
  const end = String(config.qqGroupAdReviewPeakEnd || "08:30").trim();
  const startMinutes = parseTimeOfDayMinutes(start);
  const endMinutes = parseTimeOfDayMinutes(end);
  const chinaMinutes = ((now.getUTCHours() + 8) % 24) * 60 + now.getUTCMinutes();
  const insideWindow = startMinutes === null || endMinutes === null || startMinutes === endMinutes
    ? false
    : startMinutes < endMinutes
      ? chinaMinutes >= startMinutes && chinaMinutes < endMinutes
      : chinaMinutes >= startMinutes || chinaMinutes < endMinutes;
  return {
    active: config.qqGroupAdReviewPeakEnabled === true && insideWindow,
    start,
    end,
    serviceId: String(config.qqGroupAdReviewPeakServiceId || "").trim(),
    model: String(config.qqGroupAdReviewPeakModel || "").trim(),
    timeZone: "Asia/Shanghai",
  };
}

export function resolveQqGroupAdPeakProvider(
  config: Pick<ReturnType<typeof getSiteConfig>, "aiServices" | "qqGroupAdReviewPeakServiceId">,
  fallback: {
    serviceId: string;
    name: string;
    provider: string;
    apiUrl: string;
    apiKey: string;
    model?: string;
  },
) {
  const requestedId = String(config.qqGroupAdReviewPeakServiceId || "").trim();
  const selected = config.aiServices.find((service) => service.id === requestedId);
  return selected
    ? { serviceId: selected.id, ...selected }
    : fallback;
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
  const providers = resolveAiServiceCandidatesForScene(config, "qq-group-ad");
  const imageProviders = resolveAiServiceCandidatesForScene(config, "image-review");
  const peakProvider = resolveQqGroupAdPeakProvider(config, providers[0]);
  return hashString([
    providers.map((provider) => `${provider.serviceId || ""}\n${provider.provider}\n${provider.apiUrl}`).join("\n"),
    config.qqGroupAdReviewModel,
    config.qqGroupAdReviewFallbackModels,
    config.qqGroupAdReviewPeakEnabled,
    config.qqGroupAdReviewPeakStart,
    config.qqGroupAdReviewPeakEnd,
    config.qqGroupAdReviewPeakServiceId,
    config.qqGroupAdReviewPeakModel,
    `${peakProvider.serviceId || ""}\n${peakProvider.provider}\n${peakProvider.apiUrl}`,
    imageProviders.map((provider) => `${provider.serviceId || ""}\n${provider.provider}\n${provider.apiUrl}`).join("\n"),
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
  moderationEnabled: boolean;
  detectAssistantIntent: boolean;
  nickname: string;
  enhancedMode: boolean;
}) {
  return `qqbot:group-ad-review:${hashString(`${input.configHash}\n${input.groupId}\n${input.reviewMode}\n${input.moderationEnabled ? "moderate" : "intent-only"}\n${input.detectAssistantIntent ? "assistant-intent" : "ad-only"}\n${input.enhancedMode ? "enhanced" : "standard"}\n${input.nickname}\n${input.content}\n${input.blockQrCodes ? "qr-block" : "qr-normal"}\n${input.imageUrls.join("\n")}`)}`;
}

/**
 * Resolve the model order for QQ ad review. Text messages keep using the
 * dedicated QQ model. Messages with images start with the separately
 * configurable image-review model, then use its fallbacks and finally any
 * compatible QQ models. This prevents a configured Spark model from receiving
 * an image payload and turning a moderation event into a 400 error.
 */
export function resolveQqGroupAdModelCandidates(
  config: Pick<ReturnType<typeof getSiteConfig>, "qqGroupAdReviewModel" | "qqGroupAdReviewFallbackModels" | "qqGroupAdReviewPeakModel" | "imageReviewModel" | "imageReviewFallbackModels">,
  hasImages: boolean,
  enhancedMode = false,
) {
  const normalTextCandidates = resolveModelCandidates(config.qqGroupAdReviewModel, config.qqGroupAdReviewFallbackModels);
  const peakModel = enhancedMode ? String(config.qqGroupAdReviewPeakModel || "").trim() : "";
  const textCandidates = Array.from(new Set([
    ...(peakModel ? [peakModel] : []),
    ...normalTextCandidates,
  ]));
  if (!hasImages) return textCandidates;
  const imageCandidates = resolveModelCandidates(config.imageReviewModel, config.imageReviewFallbackModels);
  const candidates = [...imageCandidates, ...normalTextCandidates];
  const seen = new Set<string>();
  return candidates.filter((model) => {
    const key = model.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return !QQ_GROUP_AD_IMAGE_UNSUPPORTED_MODEL_PATTERNS.some((pattern) => pattern.test(model));
  });
}

export function resolveQqGroupAdProviderCandidatesForModel<T extends {
  serviceId?: string;
  name?: string;
  provider: string;
  apiUrl: string;
  apiKey: string;
  model?: string;
}>(input: {
  standardProviders: T[];
  peakProvider: T;
  model: string;
  normalModel: string;
  peakModel: string;
  peakRouteReady: boolean;
  hasImages: boolean;
}) {
  const model = String(input.model || "").trim().toLowerCase();
  const peakModel = String(input.peakModel || "").trim().toLowerCase();
  if (input.hasImages || !input.peakRouteReady || !peakModel || model !== peakModel) {
    return input.standardProviders;
  }
  if (model !== String(input.normalModel || "").trim().toLowerCase()) {
    return [input.peakProvider];
  }
  return [
    input.peakProvider,
    ...input.standardProviders.filter((candidate) => candidate.serviceId !== input.peakProvider.serviceId),
  ];
}

function resolveQqGroupAdImageProvider(
  config: ReturnType<typeof getSiteConfig>,
  fallback: { provider: string; apiUrl: string; apiKey: string },
) {
  const imageProvider = resolveAiServiceForScene(config, "image-review");
  const imageApiKey = String(imageProvider.apiKey || "").trim();
  const imageApiUrl = String(imageProvider.apiUrl || "").trim();
  if (hasAiProviderAccess(imageProvider)) {
    return {
      provider: imageProvider.provider,
      apiUrl: imageApiUrl,
      apiKey: imageApiKey,
    };
  }
  return {
    provider: fallback.provider,
    apiUrl: fallback.apiUrl,
    apiKey: fallback.apiKey,
  };
}

type PreparedQqGroupAdImage = {
  sourceUrl: string;
  dataUrl: string;
  mimeType: string;
  sourceMimeType: string;
  transcoded: boolean;
  byteLength: number;
  sha256: string;
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
  if (/^data:image\//i.test(sourceUrl)) {
    const decoded = decodeQqImageDataUrl(sourceUrl);
    if (!decoded) throw new Error("QQ群图片内容不是有效的 JPEG/PNG/WebP/GIF");
    const normalized = await normalizeQqImageForAi(decoded.buffer);
    if (!normalized) throw new Error("QQ群图片内容不是有效的视觉图片");
    if (normalized.buffer.length > QQ_GROUP_AD_IMAGE_MAX_INLINE_BYTES) throw new Error("QQ群图片文件过大");
    return {
      sourceUrl,
      dataUrl: `data:${normalized.mimeType};base64,${normalized.buffer.toString("base64")}`,
      mimeType: normalized.mimeType,
      sourceMimeType: normalized.sourceMimeType,
      transcoded: normalized.transcoded,
      byteLength: normalized.buffer.length,
      sha256: createHash("sha256").update(normalized.buffer).digest("hex").slice(0, 16),
    };
  }

  const preparedFile = await prepareMediaLocalFileForProcessing(sourceUrl);
  try {
    let buffer: Buffer;
    if (preparedFile.localPath) {
      buffer = await readFile(preparedFile.localPath);
    } else if (/^https?:\/\//i.test(sourceUrl)) {
      const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`QQ群图片下载失败：HTTP ${response.status}`);
      const contentLength = Number(response.headers.get("content-length") || 0);
      if (contentLength > QQ_GROUP_AD_IMAGE_MAX_INLINE_BYTES) throw new Error("QQ群图片文件过大");
      buffer = Buffer.from(await response.arrayBuffer());
    } else {
      throw new Error("QQ群图片没有可读取的本地文件或网络地址");
    }
    if (!buffer.length || buffer.length > QQ_GROUP_AD_IMAGE_MAX_INLINE_BYTES) {
      throw new Error(buffer.length ? "QQ群图片文件过大" : "QQ群图片文件为空");
    }
    const normalized = await normalizeQqImageForAi(buffer);
    if (!normalized) throw new Error("QQ群图片内容不是有效的视觉图片");
    if (normalized.buffer.length > QQ_GROUP_AD_IMAGE_MAX_INLINE_BYTES) throw new Error("QQ群图片文件过大");
    return {
      sourceUrl,
      dataUrl: `data:${normalized.mimeType};base64,${normalized.buffer.toString("base64")}`,
      mimeType: normalized.mimeType,
      sourceMimeType: normalized.sourceMimeType,
      transcoded: normalized.transcoded,
      byteLength: normalized.buffer.length,
      sha256: createHash("sha256").update(normalized.buffer).digest("hex").slice(0, 16),
    };
  } finally {
    if (preparedFile.temporary && preparedFile.localPath) {
      await rm(preparedFile.localPath, { force: true }).catch(() => undefined);
    }
  }
}

function buildQqGroupAdPromptCacheKey(input: {
  configHash: string;
  groupId: string;
  reviewMode: "full" | "qr-only";
  moderationEnabled: boolean;
  detectAssistantIntent: boolean;
  enhancedMode: boolean;
}) {
  return `qqbot-group-ad:${hashString(`${input.configHash}\n${input.groupId}\n${input.reviewMode}\n${input.moderationEnabled ? "moderate" : "intent-only"}\n${input.detectAssistantIntent ? "assistant-intent" : "ad-only"}\n${input.enhancedMode ? "enhanced" : "standard"}`)}`;
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
  policyHardBlock?: boolean;
}): "allow" | "block" {
  if (input.modelDecision === "manual_review") return "allow";
  if (input.policyHardBlock && input.modelDecision === "block") return "block";
  if (input.modelDecision === "block" && input.riskScore >= Math.max(0, input.threshold - 10)) return "block";
  return input.riskScore >= input.threshold ? "block" : "allow";
}

export function isQqBotAssistantIntent(value: unknown) {
  if (value === true) return true;
  const normalized = String(value || "").trim().toLowerCase();
  // Fail closed: the prompt only permits `reply` or `none`; accepting loose
  // synonyms such as `question` made weak local models turn social chatter
  // into unsolicited bot replies.
  return normalized === "reply";
}

/**
 * A model may still label a social-status complaint as `reply`.  This is a
 * hard negative for proactive group replies only: it does not affect explicit
 * @mentions or private conversations, and it does not replace the model's
 * semantic classification for real questions.
 */
export function shouldForwardQqBotAssistantIntent(content: string, modelIntent: unknown) {
  return isQqBotAssistantIntent(modelIntent) && !isQqBotAssistantMetaMessage(content);
}

export function isQqBotAssistantMetaMessage(content: string) {
  const normalized = normalizeMessageForCache(content).replace(/[\s\u200b]+/gu, "");
  if (!normalized) return false;
  if (/^(?:在吗|在不在|有人吗|有人在吗|bot在吗|qqbot在吗|拾间ai在吗)[？?！!。．…]*$/iu.test(normalized)) {
    return true;
  }
  if (/^(?:你|拾间ai|qqbot|bot)?(?:怎么|为什么|为何|咋|咋么)?(?:还|一直|怎么还)?(?:不理我|没理我|没有理我|不回复(?:我)?|没回复(?:我)?|没有回复(?:我)?|不回答(?:我)?|没回答(?:我)?|没有回答(?:我)?|不回应(?:我)?|没回应(?:我)?|没有回应(?:我)?|不搭理我|没搭理我)[？?！!。．…]*$/iu.test(normalized)) {
    return true;
  }
  if (/^(?:刚才|刚刚|前面).*(?:没|没有|不).*(?:回复|回答|回应|理我|搭理我)/u.test(normalized)
    && !/(?:怎么办|如何|怎么处理|怎么解决|怎么查|怎么用|怎么做)/u.test(normalized)) {
    return true;
  }
  if (/^(?:回复我|回我一下|回一下|回答我一下|看到了吗|听到了吗|有人在听吗)[？?！!。．…]*$/u.test(normalized)) {
    return true;
  }
  return false;
}

/** QR-only checks must have an explicit QR decision from the dedicated detector. */
export function resolveQqGroupQrOnlyReviewAction(input: {
  riskScore: number;
  modelDecision: string;
}): "allow" | "block" {
  // The qr-only route exists because the group policy explicitly says that a
  // recognizable QR code is forbidden. Do not apply the general ad-risk
  // threshold here: an explicit block from this dedicated detector is the
  // policy signal we need to enforce.
  return input.modelDecision === "block" ? "block" : "allow";
}

export function isQqGroupQrDecision(reason: unknown, detail: unknown) {
  const text = `${String(reason || "")} ${String(detail || "")}`;
  if (/(?:没有|未发现|未检测到|无|不含|未见)\s*(?:可识别的?)?二维码/iu.test(text)) return false;
  return /二维码|扫码|扫描|qr\s*code|\bqr\b/iu.test(text);
}
