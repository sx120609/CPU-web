import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { grantAssistantPoints } from "./campusAssistantPoints";
import {
  learningAssistantInputContentSchema,
  parseLearningAssistantAnswer,
  requestLearningAssistantAi,
  resolveLearningAssistantTier,
  sanitizeLearningAssistantAnswer,
  type LearningAssistantAiBody,
  type LearningAssistantDifficulty,
} from "./learningAssistantAi";

// 学习通助手的同题答案缓存与答案申诉。
//
// 只缓存单选、多选、判断、填空：简答、论述这类全班答案一字不差容易被查重，仍然每次问 AI。
// 命中缓存不调用模型，也就不扣额度和点数。缓存的错答案靠申诉改正：申诉由 AI 重做三轮，
// 多数结果即判决，不经人工。

export type LearningQuestionType = "single" | "multiple" | "judgement" | "blank";

const TYPE_BY_LABEL: Record<string, LearningQuestionType> = { 单选: "single", 多选: "multiple", 判断: "judgement", 填空: "blank" };
const DIFFICULTIES: LearningAssistantDifficulty[] = ["low", "high", "max"];

/**
 * 从题目提示词认题型。学习通助手写“这是一道单选题”；多平台助手写“题型：单选题”，
 * 它的选择题答案是选项原文而不是字母，只缓存、不受理申诉。
 */
export function detectLearningQuestionType(text: string, options: { allowMultiplatform?: boolean } = {}): LearningQuestionType | null {
  const own = text.match(/这是一道(单选|多选|判断|填空)题/);
  if (own) return TYPE_BY_LABEL[own[1]];
  if (!options.allowMultiplatform) return null;
  const other = text.match(/题型：(单选|多选|判断|填空)题/);
  return other ? TYPE_BY_LABEL[other[1]] : null;
}

const blankText = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[\s\p{P}]/gu, "");

/** 答案的比对形式，与学习通助手解析 AI 答案的方式一致。认不出时返回空字符串。 */
export function normalizeLearningAnswer(type: LearningQuestionType, value: string): string {
  const text = String(value || "").trim();
  if (!text) return "";
  if (type === "single") return text.toUpperCase().match(/[A-Z]/)?.[0] ?? "";
  if (type === "multiple") {
    const letters = text.toUpperCase().match(/[A-Z]+/)?.[0] ?? "";
    return [...new Set(letters)].sort().join("");
  }
  if (type === "judgement") {
    if (/错误|不对|不正确|错|否|×|✗|false/i.test(text)) return "错误";
    if (/正确|对|是|√|✓|true/i.test(text)) return "正确";
    return "";
  }
  const blanks = text.split("|").map(blankText);
  return blanks.every(Boolean) ? blanks.join("|") : "";
}

type ContentPart = Exclude<LearningAssistantAiBody["input"][number]["content"], string>[number];

function contentParts(content: LearningAssistantAiBody["input"][number]["content"]): ContentPart[] {
  return typeof content === "string" ? [{ type: "input_text", text: content }] : content;
}

function promptText(parts: ContentPart[]) {
  return parts.flatMap((part) => (part.type === "input_text" ? [part.text] : [])).join("\n");
}

/**
 * 缓存键：档位、该档位当前的模型和整段题目内容。带当前题目截图（detail: high）的请求每人都不一样，不缓存。
 */
export function learningAnswerCacheKey(body: LearningAssistantAiBody, difficulty: LearningAssistantDifficulty = body.reasoningEffort): string | null {
  if (body.input.length !== 1) return null;
  const parts = contentParts(body.input[0].content);
  if (!detectLearningQuestionType(promptText(parts), { allowMultiplatform: true })) return null;
  if (parts.some((part) => part.type === "input_image" && part.detail === "high")) return null;
  const tier = resolveLearningAssistantTier(difficulty);
  const material = JSON.stringify({
    v: 1,
    difficulty,
    model: tier.model,
    effort: tier.reasoningEffort,
    content: parts.map((part) => (part.type === "input_text" ? ["t", part.text] : ["i", part.image_url])),
  });
  return createHash("sha256").update(material).digest("hex");
}

export type LearningAnswerCacheMeta = { cached: boolean; appealable: boolean };

function appealableFor(body: LearningAssistantAiBody) {
  return Boolean(detectLearningQuestionType(promptText(contentParts(body.input[0].content))));
}

export async function readLearningAnswerCache(body: LearningAssistantAiBody): Promise<{ outputText: string; meta: LearningAnswerCacheMeta } | null> {
  const cacheKey = learningAnswerCacheKey(body);
  if (!cacheKey) return null;
  try {
    const entry = await prisma.learningAnswerCache.findUnique({ where: { cacheKey }, select: { id: true, outputText: true } });
    if (!entry) return null;
    void prisma.learningAnswerCache.update({
      where: { id: entry.id },
      data: { hitCount: { increment: 1 }, lastHitAt: new Date() },
    }).catch(() => undefined);
    return { outputText: entry.outputText, meta: { cached: true, appealable: appealableFor(body) } };
  } catch {
    // 缓存读不到就照常问 AI
    return null;
  }
}

/** 只收能按题型解析出答案的回复，“信息不足”之类的说明不进缓存。返回这条答案是否可申诉。 */
export async function writeLearningAnswerCache(body: LearningAssistantAiBody, outputText: string): Promise<LearningAnswerCacheMeta> {
  const cacheKey = learningAnswerCacheKey(body);
  const notCached = { cached: false, appealable: false };
  if (!cacheKey) return notCached;
  const type = detectLearningQuestionType(promptText(contentParts(body.input[0].content)), { allowMultiplatform: true })!;
  const answer = sanitizeLearningAssistantAnswer(parseLearningAssistantAnswer(outputText)).answer;
  // 多平台助手的选择题答案是选项原文，不能按字母解析，只要求非空
  const optionText = !appealableFor(body) && (type === "single" || type === "multiple");
  if (!(optionText ? answer : normalizeLearningAnswer(type, answer))) return notCached;
  try {
    await prisma.learningAnswerCache.upsert({
      where: { cacheKey },
      // 同一题同时有两个人在问：先写进去的为准
      update: {},
      create: { cacheKey, questionType: type, outputText },
    });
    return { cached: false, appealable: appealableFor(body) };
  } catch {
    return notCached;
  }
}

export const LEARNING_ANSWER_APPEAL_PREFIX = "【答案申诉】";
export const LEARNING_ANSWER_APPEAL_REWARDS = {
  "claim-correct": 10,
  "both-wrong": 1,
  "original-correct": 0,
  inconclusive: 0,
} as const;
export const LEARNING_ANSWER_APPEAL_DAILY_LIMIT = 10;
const APPEAL_ROUNDS = 3;

export type LearningAnswerAppealVerdict = keyof typeof LEARNING_ANSWER_APPEAL_REWARDS;

/** 申诉沿用答题对话通道：原题、原答案、再加一句以申诉前缀开头的追问。 */
export function isLearningAnswerAppealBody(raw: unknown) {
  const input = (raw as { input?: unknown })?.input;
  if (!Array.isArray(input) || input.length !== 3) return false;
  const last = input[2] as { role?: unknown; content?: unknown };
  if (last?.role !== "user") return false;
  const text = typeof last.content === "string"
    ? last.content
    : Array.isArray(last.content) ? String((last.content[0] as { text?: unknown })?.text ?? "") : "";
  return text.trimStart().startsWith(LEARNING_ANSWER_APPEAL_PREFIX);
}

export const learningAnswerAppealBodySchema = z.object({
  model: z.string().min(1).max(200),
  input: z.tuple([
    z.object({ role: z.literal("user"), content: learningAssistantInputContentSchema }).strict(),
    z.object({
      role: z.literal("assistant"),
      content: z.union([
        z.string().max(32_000),
        z.array(z.object({ type: z.literal("output_text"), text: z.string().max(32_000) }).strict()).min(1).max(10),
      ]),
    }).strict(),
    z.object({
      role: z.literal("user"),
      content: z.union([
        z.string().max(2_000),
        z.array(z.object({ type: z.literal("input_text"), text: z.string().max(2_000) }).strict()).length(1),
      ]),
    }).strict(),
  ]),
  temperature: z.number().min(0).max(2).optional(),
  reasoningEffort: z.enum(["low", "high", "max"]).default("low"),
  stream: z.literal(false).optional(),
}).strict();

export type LearningAnswerAppealBody = z.infer<typeof learningAnswerAppealBodySchema>;

const CLAIM_FORMAT_HINT: Record<LearningQuestionType, string> = {
  single: "请填写正确选项的字母，例如 B",
  multiple: "请填写全部正确选项的字母，例如 ACD",
  judgement: "请填写“对”或“错”",
  blank: "请填写每个空的答案，多个空用 | 分隔",
};

export type LearningAnswerJudgeRound = { answer: string; normalized: string; outputText: string };

/** 至少两轮给出同一答案才算有结论；再看结论与原答案、申诉答案是否一致。 */
export function decideLearningAnswerAppeal(original: string, claim: string, rounds: LearningAnswerJudgeRound[]) {
  const counts = new Map<string, LearningAnswerJudgeRound[]>();
  for (const round of rounds) {
    if (!round.normalized) continue;
    counts.set(round.normalized, [...(counts.get(round.normalized) ?? []), round]);
  }
  const majority = [...counts.values()].find((group) => group.length >= 2) ?? null;
  const verdict: LearningAnswerAppealVerdict = !majority
    ? "inconclusive"
    : majority[0].normalized === original
      ? "original-correct"
      : majority[0].normalized === claim ? "claim-correct" : "both-wrong";
  return { verdict, majority: majority?.[0] ?? null, refundPoints: LEARNING_ANSWER_APPEAL_REWARDS[verdict] };
}

function judgePrompt(original: string, claim: string, round: number) {
  const [first, second] = round % 2 === 0 ? [original, claim] : [claim, original];
  return [
    "【申诉复核】上面这道题此前给出过答案，现在有人提出异议。下面两个候选答案不说明来源，可能其中一个正确，也可能都不正确。",
    `候选答案甲：${first}`,
    `候选答案乙：${second}`,
    "请不受候选答案影响，独立重新解题，给出你判定的正确答案。answer 的格式必须符合题目要求；explanation 简短说明依据。",
  ].join("\n");
}

export type LearningAnswerAppealOutcome = {
  verdict: LearningAnswerAppealVerdict;
  refundPoints: number;
  originalAnswer: string;
  claimedAnswer: string;
  judgedAnswer: string;
  explanation: string;
  message: string;
};

function appealMessage(verdict: LearningAnswerAppealVerdict, judgedAnswer: string, refundPoints: number) {
  if (verdict === "claim-correct") return `复核认定原答案有误、你提供的答案正确，已返还 ${refundPoints} 点；缓存答案已改为 ${judgedAnswer}。`;
  if (verdict === "both-wrong") return `复核认定原答案有误，但你提供的答案也不正确，已返还 ${refundPoints} 点；缓存答案已改为复核答案 ${judgedAnswer}。`;
  if (verdict === "original-correct") return `复核认定原答案 ${judgedAnswer} 正确，不返还点数。`;
  return "三轮复核意见不一致，维持原答案，不返还点数。";
}

async function findCachedOriginal(original: LearningAssistantAiBody) {
  const order = [original.reasoningEffort, ...DIFFICULTIES.filter((item) => item !== original.reasoningEffort)];
  for (const difficulty of order) {
    const cacheKey = learningAnswerCacheKey(original, difficulty);
    if (!cacheKey) return null;
    const entry = await prisma.learningAnswerCache.findUnique({ where: { cacheKey } });
    if (entry) return entry;
  }
  return null;
}

/**
 * 原答案以服务端缓存为准，不认客户端自报的那一条，免得有人伪造“原答案错了”来换返还。
 * 先占住“每人每条答案一次”的名额再复核，复核失败就把名额还回去。
 */
export async function handleLearningAnswerAppeal(userId: number, body: LearningAnswerAppealBody, signal: AbortSignal): Promise<LearningAnswerAppealOutcome> {
  const original: LearningAssistantAiBody = {
    model: body.model,
    input: [body.input[0]],
    reasoningEffort: body.reasoningEffort,
    ...(body.temperature === undefined ? {} : { temperature: body.temperature }),
  };
  const originalParts = contentParts(body.input[0].content);
  const type = detectLearningQuestionType(promptText(originalParts));
  if (!type) throw Errors.badRequest("只有单选、多选、判断和填空题可以申诉");
  const appealText = promptText(contentParts(body.input[2].content)).trim();
  const claimedAnswer = appealText.slice(LEARNING_ANSWER_APPEAL_PREFIX.length).trim().slice(0, 500);
  if (!claimedAnswer) throw Errors.badRequest("请填写你认为正确的答案");
  const claim = normalizeLearningAnswer(type, claimedAnswer);
  if (!claim) throw Errors.badRequest(CLAIM_FORMAT_HINT[type]);

  const entry = await findCachedOriginal(original);
  if (!entry) throw Errors.badRequest("没有找到这道题的答案记录（截图题或后台已更换模型），暂时无法申诉");
  const originalAnswer = sanitizeLearningAssistantAnswer(parseLearningAssistantAnswer(entry.outputText)).answer;
  const originalNormalized = normalizeLearningAnswer(type, originalAnswer);
  if (originalNormalized === claim) throw Errors.badRequest("你填写的答案和原答案相同");

  const recent = await prisma.learningAnswerAppeal.count({
    where: { userId, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  });
  if (recent >= LEARNING_ANSWER_APPEAL_DAILY_LIMIT) {
    throw Errors.badRequest(`每 24 小时最多申诉 ${LEARNING_ANSWER_APPEAL_DAILY_LIMIT} 次，请稍后再来`);
  }

  let appealId: number;
  try {
    appealId = (await prisma.learningAnswerAppeal.create({
      data: { cacheId: entry.id, userId, originalAnswer: originalAnswer.slice(0, 2000), claimedAnswer },
      select: { id: true },
    })).id;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw Errors.conflict("这道题的这个答案你已经申诉过了");
    }
    throw error;
  }

  try {
    const settled = await Promise.allSettled(Array.from({ length: APPEAL_ROUNDS }, (_, round) => requestLearningAssistantAi(
      {
        model: body.model,
        reasoningEffort: "max",
        input: [{ role: "user", content: [...originalParts, { type: "input_text", text: judgePrompt(originalAnswer, claimedAnswer, round) }] }],
      },
      `appeal-${userId}`,
      signal,
      { createdById: userId, targetLabel: "学习通答案申诉复核" },
    )));
    const rounds: LearningAnswerJudgeRound[] = settled.flatMap((result) => {
      if (result.status !== "fulfilled" || !result.value.ok) return [];
      const outputText = result.value.outputText || "";
      const answer = sanitizeLearningAssistantAnswer(parseLearningAssistantAnswer(outputText)).answer;
      return [{ answer, normalized: normalizeLearningAnswer(type, answer), outputText }];
    });
    if (rounds.length < 2) throw Errors.badGateway("AI 复核暂时没有完成，申诉未计次数，请稍后再试");

    const decision = decideLearningAnswerAppeal(originalNormalized, claim, rounds);
    const judgedAnswer = decision.majority?.answer ?? "";
    const explanation = decision.majority
      ? parseLearningAssistantAnswer(decision.majority.outputText).explanation
      : "";
    await prisma.$transaction(async (tx) => {
      await tx.learningAnswerAppeal.update({
        where: { id: appealId },
        data: { verdict: decision.verdict, judgedAnswer: judgedAnswer.slice(0, 2000), refundPoints: decision.refundPoints },
      });
      if (decision.majority && (decision.verdict === "claim-correct" || decision.verdict === "both-wrong")) {
        await tx.learningAnswerCache.update({
          where: { id: entry.id },
          data: { outputText: decision.majority.outputText, source: "appeal" },
        });
      }
      if (decision.refundPoints > 0) {
        await grantAssistantPoints(tx, {
          userId,
          points: decision.refundPoints,
          source: "answer_appeal_refund",
          reason: decision.verdict === "claim-correct" ? "学习通答案申诉成功" : "学习通答案申诉：原答案有误",
          referenceType: "learning_answer_appeal",
          referenceId: String(appealId),
        });
      }
    });
    return {
      verdict: decision.verdict,
      refundPoints: decision.refundPoints,
      originalAnswer,
      claimedAnswer,
      judgedAnswer,
      explanation,
      message: appealMessage(decision.verdict, judgedAnswer, decision.refundPoints),
    };
  } catch (error) {
    await prisma.learningAnswerAppeal.delete({ where: { id: appealId } }).catch(() => undefined);
    throw error;
  }
}

export function learningAnswerAppealResponse(outcome: LearningAnswerAppealOutcome) {
  return {
    output_text: outcome.message,
    learning_appeal: outcome,
    output: [{
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: outcome.message, annotations: [] }],
    }],
  };
}
