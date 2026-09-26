import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

process.env.REDIS_ENABLED = "false";
process.env.DATABASE_URL = "";

const CONSENT_MARKER = "AI consent unavailable; manual review required";

function replace(t: TestContext, target: any, key: string, value: any) {
  const original = target[key];
  target[key] = value;
  t.after(() => { target[key] = original; });
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("condition was not reached in time");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("已退役的同意闸门标记每个进程只成功修复一次，失败时下一轮重试", async (t) => {
  const { prisma } = await import("../src/prisma");
  const { recoverPendingForumSubmissions } = await import("../src/services/forumSubmissionReview");
  const fixes: string[] = [];
  let failNextTopicFix = true;
  replace(t, prisma.topic, "updateMany", async ({ where }: any) => {
    fixes.push(`topic:${where.aiReviewDetail}`);
    if (failNextTopicFix) {
      failNextTopicFix = false;
      throw new Error("database timeout");
    }
    return { count: 0 };
  });
  replace(t, prisma.reply, "updateMany", async ({ where }: any) => {
    fixes.push(`reply:${where.aiReviewDetail}`);
    return { count: 0 };
  });
  replace(t, prisma.topic, "findMany", async () => []);
  replace(t, prisma.reply, "findMany", async () => []);

  await assert.rejects(recoverPendingForumSubmissions(), /database timeout/);
  await recoverPendingForumSubmissions();
  await recoverPendingForumSubmissions();

  assert.deepEqual(fixes, [
    `topic:${CONSENT_MARKER}`,
    `reply:${CONSENT_MARKER}`,
    `topic:${CONSENT_MARKER}`,
    `reply:${CONSENT_MARKER}`,
  ]);
});

test("资料审核轮询只读取审核所需的用户字段", async (t) => {
  const { prisma } = await import("../src/prisma");
  const { recoverPendingProfileReviews } = await import("../src/services/profileReview");
  const queries: any[] = [];
  replace(t, prisma.user, "findMany", async (args: any) => {
    queries.push(args);
    return [];
  });

  await recoverPendingProfileReviews(Date.parse("2026-09-26T00:00:00.000Z"));

  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].select, { id: true, pendingProfile: true, updatedAt: true, avatar: true });
  assert.equal(queries[0].take, 2);
});

const pollers = [
  {
    name: "论坛投稿",
    lock: "forum-review:poll",
    async setup(t: TestContext, prisma: any, review: Promise<null>, started: () => void) {
      replace(t, prisma.topic, "updateMany", async () => ({ count: 0 }));
      replace(t, prisma.reply, "updateMany", async () => ({ count: 0 }));
      replace(t, prisma.topic, "findMany", async ({ where }: any) => (
        where.aiReviewStatus === "checking" ? [{ id: 42, aiReviewDetail: null, aiReviewedAt: null }] : []
      ));
      replace(t, prisma.reply, "findMany", async () => []);
      replace(t, prisma.topic, "findFirst", async () => {
        started();
        return review;
      });
      (await import("../src/services/forumSubmissionReview")).startForumSubmissionReviewPoller();
    },
  },
  {
    name: "私聊消息",
    lock: "direct-message-review:poll",
    async setup(t: TestContext, prisma: any, review: Promise<null>, started: () => void) {
      replace(t, prisma.directMessage, "findMany", async () => [{ id: 7, aiReviewDetail: null, aiReviewedAt: null }]);
      replace(t, prisma.directMessage, "findFirst", async () => {
        started();
        return review;
      });
      (await import("../src/services/directMessageSubmissionReview")).startDirectMessageSubmissionReviewPoller();
    },
  },
  {
    name: "昵称",
    lock: "nickname-review:poll",
    async setup(t: TestContext, prisma: any, review: Promise<null>, started: () => void) {
      replace(t, prisma.user, "findMany", async () => [{ id: 9, nicknameReviewDetail: null, nicknameReviewedAt: null }]);
      replace(t, prisma.user, "findFirst", async () => {
        started();
        return review;
      });
      (await import("../src/services/nicknameReview")).startNicknameReviewPoller();
    },
  },
];

for (const poller of pollers) {
  test(`${poller.name}审核轮询在分布式锁内等待进行中的审核，重叠进程在此期间不会重复扫描`, async (t) => {
    const { prisma } = await import("../src/prisma");
    const { runWithDistributedLock } = await import("../src/services/cache");
    t.mock.method(console, "warn", () => {});
    let finishReview!: (value: null) => void;
    const review = new Promise<null>((resolve) => { finishReview = resolve; });
    let reviewStarted = false;
    await poller.setup(t, prisma, review, () => { reviewStarted = true; });

    await waitFor(() => reviewStarted);
    const overlapping = await runWithDistributedLock(poller.lock, 1_000, async () => true);
    assert.equal(overlapping.acquired, false);

    finishReview(null);
    await waitFor(async () => (await runWithDistributedLock(poller.lock, 1_000, async () => true)).acquired);
  });
}
