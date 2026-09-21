import assert from "node:assert/strict";
import test from "node:test";

process.env.REDIS_ENABLED = "false";
process.env.DATABASE_URL = "";

test("an unavailable AI result stays hidden and retries beyond the old manual-transfer limit", async (t) => {
  const { prisma } = await import("../src/prisma");
  const { processTopicSubmissionReview } = await import("../src/services/forumSubmissionReview");
  const item: any = {
    id: 1, authorId: 2, title: "普通课程", content: "求教材", metadata: "{}",
    hidden: true, aiReviewStatus: "checking", aiReviewDetail: "[attempt:6] timeout",
    updatedAt: new Date(), board: { id: 1, type: "market", name: "二手交流" },
  };
  const replace = (target: any, key: string, value: any) => {
    const previous = target[key]; target[key] = value;
    t.after(() => { target[key] = previous; });
  };
  replace(prisma.topic, "findFirst", async () => ({ ...item }));
  const writes: any[] = [];
  replace(prisma.topic, "updateMany", async ({ data }: any) => {
    writes.push(data); Object.assign(item, data); return { count: 1 };
  });
  replace(prisma, "$transaction", async () => assert.fail("outages must never publish"));
  replace(prisma.notification, "createMany", async () => assert.fail("must not broadcast manual review requests"));
  const unavailable = async (): Promise<any> => ({
    status: "blocked_ai", reason: "服务暂不可用", detail: '{"unavailable":true}', model: "test", riskScore: 70, riskLevel: "medium",
  });
  await processTopicSubmissionReview(1, unavailable);
  assert.equal(item.aiReviewStatus, "checking");
  assert.equal(item.hidden, true);
  assert.match(item.aiReviewDetail, /attempt:7/);
  assert.doesNotMatch(item.aiReviewReason, /人工/);
  item.aiReviewDetail = "[attempt:99] timeout";
  await processTopicSubmissionReview(1, unavailable);
  assert.equal(item.aiReviewStatus, "checking");
  assert.match(item.aiReviewDetail, /attempt:100/);
  assert.equal(writes.length, 2);
  item.aiReviewStatus = "manual_requested";
  item.aiReviewDetail = "用户主动申诉";
  await processTopicSubmissionReview(1, async () => assert.fail("preserve explicit appeals"));
  assert.equal(writes.length, 2);
});

test("keyword/AI conflicts are saved privately for human review without punishment or duplicate requests", async (t) => {
  const { prisma } = await import("../src/prisma");
  const { processTopicSubmissionReview } = await import("../src/services/forumSubmissionReview");
  const { reviewContentKeywords, applyKeywordReview } = await import("../src/services/contentKeywordReview");
  const item: any = { id: 1, boardId: 1, authorId: 2, title: "课程资料", content: "麻豆传媒", metadata: "{}", tags: [],
    hidden: true, aiReviewStatus: "checking", aiReviewDetail: "", updatedAt: new Date(), board: { id: 1, name: "二手交流", type: "market" } };
  const replace = (target: any, key: string, value: any) => {
    const previous = target[key]; target[key] = value;
    t.after(() => { target[key] = previous; });
  };
  replace(prisma.topic, "findFirst", async () => ({ ...item }));
  replace(prisma.topic, "updateMany", async ({ data }: any) => { Object.assign(item, data); return { count: 1 }; });
  replace(prisma.topic, "count", async () => 0);
  replace(prisma.board, "update", async () => ({}));
  const userWrites: any[] = [];
  replace(prisma.user, "update", async ({ data }: any) => { userWrites.push(data); return {}; });
  replace(prisma.user, "findMany", async () => [{ id: 99 }]);
  replace(prisma, "$transaction", async (work: any) => work(prisma));
  const notifications: any[] = [];
  replace(prisma.notification, "create", async ({ data }: any) => { notifications.push(data); return data; });
  replace(prisma.notification, "createMany", async ({ data }: any) => { notifications.push(...data); return { count: data.length }; });
  const result = applyKeywordReview(reviewContentKeywords(item), { status: "auto_passed", riskScore: 5, riskLevel: "low", reason: "仅名称", detail: '{"modelDecision":"auto_pass"}', model: "test" });
  await processTopicSubmissionReview(1, async () => result);
  assert.equal(item.hidden, true);
  assert.equal(item.aiReviewStatus, "manual_requested");
  assert.equal(JSON.parse(item.aiReviewDetail).matchedTerm, "麻豆传媒");
  assert.equal(notifications.length, 2);
  assert.ok(notifications.some(n => JSON.parse(n.payload).type === "topic-manual-review-admin"));
  assert.ok(userWrites.every(write => !write.topicSubmissionLocked));
  await processTopicSubmissionReview(1, async () => assert.fail("human confirmation must not be auto-overridden"));
  assert.equal(notifications.length, 2);
});
