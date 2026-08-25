import assert from "node:assert/strict";
import test from "node:test";
import {
  clearSmartPostJobsForTests,
  enqueueSmartPostJob,
  getSmartPostJob,
} from "../src/services/topicSmartPostJob";
import type { SmartPostDraftInput, SmartPostDraftResult } from "../src/services/topicSmartPost";

const completedResult: SmartPostDraftResult = {
  title: "测试草稿",
  content: "## 正文",
  summary: "测试完成",
  provider: "openai",
  model: "gpt-test",
  source: "text",
  usage: {
    inputTokens: 100,
    outputTokens: 20,
    totalTokens: 120,
    tokensPerQuota: 4000,
    chargedQuota: 1,
  },
  quota: {
    remaining: 4,
    points: 0,
    totalRemaining: 4,
    nextResetAt: new Date(0).toISOString(),
  },
};

function waitForTerminal(jobId: string, userId: number) {
  return new Promise<ReturnType<typeof getSmartPostJob>>((resolve, reject) => {
    const deadline = Date.now() + 2_000;
    const poll = () => {
      try {
        const job = getSmartPostJob(jobId, userId);
        if (job.state === "completed" || job.state === "failed") return resolve(job);
        if (Date.now() >= deadline) return reject(new Error("job timeout"));
        setTimeout(poll, 5);
      } catch (error) {
        reject(error);
      }
    };
    poll();
  });
}

test.beforeEach(() => clearSmartPostJobsForTests());

test("智慧发帖后台任务持续记录进度并返回结果", async () => {
  const runner = async (input: SmartPostDraftInput) => {
    input.onProgress?.(48, "第 2/3 轮：正在生成草稿");
    await new Promise((resolve) => setTimeout(resolve, 10));
    return completedResult;
  };
  const queued = enqueueSmartPostJob({
    userId: 42,
    operation: "compose",
    content: "测试材料",
  }, runner);
  assert.equal(queued.state, "queued");
  assert.throws(() => getSmartPostJob(queued.jobId, 43), /不存在或已过期/u);

  const completed = await waitForTerminal(queued.jobId, 42);
  assert.equal(completed.state, "completed");
  assert.equal(completed.progress, 100);
  assert.deepEqual(completed.result, completedResult);
});

test("智慧发帖后台任务保留可见失败原因", async () => {
  const queued = enqueueSmartPostJob({
    userId: 42,
    operation: "compose",
    content: "测试材料",
  }, async () => {
    throw new Error("AI 审核请求失败：上游超时，本次额度已退还");
  });
  const failed = await waitForTerminal(queued.jobId, 42);
  assert.equal(failed.state, "failed");
  assert.match(failed.error || "", /智慧发帖 AI 请求失败/u);
  assert.match(failed.error || "", /额度已退还/u);
});
