import { randomUUID } from "node:crypto";
import { Errors } from "../utils/response";
import {
  createSmartPostDraft,
  normalizeSmartPostFiles,
  type SmartPostDraftInput,
  type SmartPostDraftResult,
  type SmartPostOperation,
} from "./topicSmartPost";

export type SmartPostJobState = "queued" | "running" | "completed" | "failed";

export type SmartPostJobSnapshot = {
  jobId: string;
  state: SmartPostJobState;
  progress: number;
  message: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  result: SmartPostDraftResult | null;
  error: string | null;
  returnPath: string;
  operation: SmartPostOperation;
};

type SmartPostJobRecord = SmartPostJobSnapshot & {
  userId: number;
  acknowledgedAt: string | null;
};

export type SmartPostJobInput = SmartPostDraftInput & { returnPath?: string | null };

type SmartPostJobRunner = (input: SmartPostDraftInput) => Promise<SmartPostDraftResult>;

const jobs = new Map<string, SmartPostJobRecord>();
const MAX_ACTIVE_JOBS = 24;
const TERMINAL_JOB_TTL_MS = 24 * 60 * 60_000;

const cleanupTimer = setInterval(cleanupSmartPostJobs, 30 * 60_000);
cleanupTimer.unref?.();

export function enqueueSmartPostJob(
  rawInput: SmartPostJobInput,
  runner: SmartPostJobRunner = createSmartPostDraft,
): SmartPostJobSnapshot {
  cleanupSmartPostJobs();
  const activeJobs = Array.from(jobs.values()).filter((job) => job.state === "queued" || job.state === "running");
  if (activeJobs.some((job) => job.userId === rawInput.userId)) {
    throw Errors.conflict("你已有一个智慧发帖任务正在处理，请先查看当前任务进度");
  }
  if (activeJobs.length >= MAX_ACTIVE_JOBS) {
    throw Errors.conflict("智慧发帖任务较多，请稍后再试");
  }

  const input: SmartPostDraftInput = {
    ...rawInput,
    files: rawInput.operation === "format"
      ? []
      : normalizeSmartPostFiles([
          ...(rawInput.files || []),
          ...(rawInput.file ? [rawInput.file] : []),
        ]),
    file: null,
  };
  const now = new Date().toISOString();
  const record: SmartPostJobRecord = {
    jobId: randomUUID(),
    userId: input.userId,
    state: "queued",
    progress: 2,
    message: "任务已提交，正在等待 Agent 开始处理",
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    result: null,
    error: null,
    returnPath: normalizeReturnPath(rawInput.returnPath),
    operation: input.operation,
    acknowledgedAt: null,
  };
  jobs.set(record.jobId, record);

  setImmediate(() => {
    void runSmartPostJob(record.jobId, input, runner);
  });
  return toSnapshot(record);
}

export function getSmartPostJob(jobId: string, userId: number): SmartPostJobSnapshot {
  cleanupSmartPostJobs();
  const job = jobs.get(String(jobId || "").trim());
  if (!job || job.userId !== userId) throw Errors.notFound("智慧发帖任务不存在或已过期");
  return toSnapshot(job);
}

export function getLatestSmartPostJob(userId: number): SmartPostJobSnapshot | null {
  cleanupSmartPostJobs();
  const candidates = Array.from(jobs.values())
    .filter((job) => job.userId === userId && !job.acknowledgedAt)
    .sort((left, right) => {
      const leftActive = left.state === "queued" || left.state === "running" ? 1 : 0;
      const rightActive = right.state === "queued" || right.state === "running" ? 1 : 0;
      return rightActive - leftActive || new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    });
  return candidates[0] ? toSnapshot(candidates[0]) : null;
}

export function acknowledgeSmartPostJob(jobId: string, userId: number) {
  cleanupSmartPostJobs();
  const job = jobs.get(String(jobId || "").trim());
  if (!job || job.userId !== userId) throw Errors.notFound("智慧发帖任务不存在或已过期");
  if (job.state === "queued" || job.state === "running") throw Errors.conflict("智慧发帖任务仍在处理中，暂时不能移除");
  job.acknowledgedAt = new Date().toISOString();
  job.updatedAt = job.acknowledgedAt;
  return { acknowledged: true };
}

async function runSmartPostJob(jobId: string, input: SmartPostDraftInput, runner: SmartPostJobRunner) {
  const job = jobs.get(jobId);
  if (!job) return;
  updateJob(job, {
    state: "running",
    progress: 5,
    message: "Agent 已启动，正在准备材料",
  });
  try {
    const result = await runner({
      ...input,
      onProgress(progress, message) {
        const current = jobs.get(jobId);
        if (!current || current.state !== "running") return;
        updateJob(current, {
          progress: Math.max(current.progress, Math.min(99, Math.round(progress))),
          message,
        });
      },
    });
    const current = jobs.get(jobId);
    if (!current) return;
    updateJob(current, {
      state: "completed",
      progress: 100,
      message: input.operation === "format"
        ? "排版已完成，可以返回可视化编辑器继续修改"
        : "草稿已生成，可以返回发帖页继续编辑",
      result,
      error: null,
      completedAt: new Date().toISOString(),
    });
  } catch (error) {
    const current = jobs.get(jobId);
    if (!current) return;
    updateJob(current, {
      state: "failed",
      progress: Math.max(current.progress, 5),
      message: "智慧发帖任务失败",
      result: null,
      error: formatSmartPostJobError(error),
      completedAt: new Date().toISOString(),
    });
  }
}

function updateJob(job: SmartPostJobRecord, patch: Partial<SmartPostJobRecord>) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
}

function toSnapshot(job: SmartPostJobRecord): SmartPostJobSnapshot {
  return {
    jobId: job.jobId,
    state: job.state,
    progress: job.progress,
    message: job.message,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    result: job.result,
    error: job.error,
    returnPath: job.returnPath,
    operation: job.operation,
  };
}

function normalizeReturnPath(value: unknown) {
  const path = String(value || "").trim();
  return /^\/post(?:\/\d+\/edit)?(?:[?#].*)?$/u.test(path) ? path : "/post";
}

function cleanupSmartPostJobs() {
  const now = Date.now();
  for (const [jobId, job] of jobs) {
    if (
      (job.state === "completed" || job.state === "failed")
      && now - new Date(job.completedAt || job.updatedAt).getTime() > TERMINAL_JOB_TTL_MS
    ) {
      jobs.delete(jobId);
    }
  }
}

function formatSmartPostJobError(error: unknown) {
  const message = error instanceof Error && error.message ? error.message : "Agent 处理失败，请稍后重试";
  const normalized = message
    .replace(/AI 审核/gu, "智慧发帖 AI ")
    .replace(/本次额度已退还(?:，本次额度已退还)+/gu, "本次额度已退还")
    .slice(0, 500);
  return /额度已退还|未保留 AI 额度扣费/u.test(normalized)
    ? normalized
    : `${normalized}；本次任务未保留 AI 额度扣费`.slice(0, 500);
}

export function clearSmartPostJobsForTests() {
  jobs.clear();
}
