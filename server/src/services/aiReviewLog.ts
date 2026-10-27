import { prisma } from "../prisma";
import type { AiLogScene } from "../shared/aiLogScenes";

export type AiReviewLogInput = {
  kind: AiLogScene;
  targetId?: number | null;
  targetLabel?: string | null;
  targetUrl?: string | null;
  provider: string;
  model: string;
  endpoint?: string | null;
  requestSummary?: string | null;
  createdById?: number | null;
  pointCost?: number | null;
};

export async function startAiReviewLog(input: AiReviewLogInput) {
  return prisma.aiReviewLog.create({
    data: {
      kind: input.kind,
      targetId: input.targetId ?? null,
      targetLabel: input.targetLabel?.slice(0, 160) || null,
      targetUrl: input.targetUrl?.slice(0, 500) || null,
      provider: input.provider.slice(0, 60),
      model: input.model.slice(0, 120),
      endpoint: input.endpoint?.slice(0, 240) || null,
      requestSummary: input.requestSummary?.slice(0, 4000) || "",
      createdById: input.createdById ?? null,
      pointCost: Math.max(0, Number(input.pointCost ?? 0) || 0),
      status: "started",
      startedAt: new Date(),
    },
    select: { id: true, startedAt: true },
  }).catch(() => null);
}

export async function finishAiReviewLogSuccess(
  logId: number | null | undefined,
  responseSummary?: string | null,
  route?: { provider?: string | null; model?: string | null; endpoint?: string | null; pointCost?: number | null },
) {
  if (!logId) return;
  const now = new Date();
  const existing = await prisma.aiReviewLog.findUnique({
    where: { id: logId },
    select: { startedAt: true },
  }).catch(() => null);
  const durationMs = existing?.startedAt ? Math.max(0, now.getTime() - existing.startedAt.getTime()) : null;
  await prisma.aiReviewLog.update({
    where: { id: logId },
    data: {
      status: "success",
      responseSummary: responseSummary?.slice(0, 4000) || "",
      ...(route?.provider ? { provider: route.provider.slice(0, 60) } : {}),
      ...(route?.model ? { model: route.model.slice(0, 120) } : {}),
      ...(route?.endpoint ? { endpoint: route.endpoint.slice(0, 240) } : {}),
      ...(route?.pointCost !== undefined && route.pointCost !== null
        ? { pointCost: Math.max(0, Number(route.pointCost) || 0) }
        : {}),
      finishedAt: now,
      durationMs,
    },
  }).catch(() => null);
}

export async function finishAiReviewLogError(logId: number | null | undefined, errorMessage?: string | null, responseSummary?: string | null) {
  if (!logId) return;
  const now = new Date();
  const existing = await prisma.aiReviewLog.findUnique({
    where: { id: logId },
    select: { startedAt: true },
  }).catch(() => null);
  const durationMs = existing?.startedAt ? Math.max(0, now.getTime() - existing.startedAt.getTime()) : null;
  await prisma.aiReviewLog.update({
    where: { id: logId },
    data: {
      status: "error",
      errorMessage: errorMessage?.slice(0, 1000) || "unknown error",
      responseSummary: responseSummary?.slice(0, 4000) || "",
      finishedAt: now,
      durationMs,
      pointCost: 0,
    },
  }).catch(() => null);
}

/**
 * 用户取消或离开页面的请求记成 status "error"，靠错误文字区分。新代码统一写 REQUEST_ABORTED 前缀，
 * 其余三种是线上已有记录里的取消写法。后台日志和服务流量统计都不把它们算作失败。
 */
const CANCELLED_ERROR_FILTERS = [
  { errorMessage: { startsWith: "REQUEST_ABORTED" } },
  { errorMessage: { contains: "AI_SEARCH_ABORTED" } },
  { errorMessage: { equals: "请求已取消" } },
  { errorMessage: { contains: "客户端已断开连接" } },
];
export const AI_LOG_CANCELLED_WHERE = { status: "error", OR: CANCELLED_ERROR_FILTERS };
export const AI_LOG_NOT_CANCELLED_WHERE = { OR: [{ errorMessage: null }, { NOT: { OR: CANCELLED_ERROR_FILTERS } }] };

export function isCancelledAiLogError(errorMessage?: string | null) {
  const message = errorMessage || "";
  return message.startsWith("REQUEST_ABORTED") || message.includes("AI_SEARCH_ABORTED")
    || message === "请求已取消" || message.includes("客户端已断开连接");
}

export async function finishAiReviewLogCancelled(logId: number | null | undefined, reason: unknown) {
  const detail = reason instanceof Error ? reason.message : String(reason || "");
  await finishAiReviewLogError(logId, `REQUEST_ABORTED: ${detail || "用户取消了请求"}`);
}
