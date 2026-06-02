import { prisma } from "../prisma";

export type AiReviewLogInput = {
  kind: "topic" | "reply" | "topic-edit" | "image" | "video";
  targetId?: number | null;
  targetLabel?: string | null;
  targetUrl?: string | null;
  provider: string;
  model: string;
  endpoint?: string | null;
  requestSummary?: string | null;
  createdById?: number | null;
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
      status: "started",
      startedAt: new Date(),
    },
    select: { id: true, startedAt: true },
  }).catch(() => null);
}

export async function finishAiReviewLogSuccess(logId: number | null | undefined, responseSummary?: string | null) {
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
    },
  }).catch(() => null);
}
