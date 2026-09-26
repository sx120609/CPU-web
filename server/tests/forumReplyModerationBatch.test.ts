import assert from "node:assert/strict";
import test from "node:test";

process.env.REDIS_ENABLED = "false";
process.env.DATABASE_URL = "";
process.env.MEDIA_STORAGE_PROVIDER = "local";

type AssetRow = {
  id: number;
  url: string;
  status: string;
  reason: string | null;
  lastError: string | null;
  reviewModel: string | null;
  reviewEndpoint: string | null;
  [key: string]: unknown;
};

function pick(row: AssetRow, select?: Record<string, unknown>) {
  if (!select) return { ...row };
  return Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, row[key]]));
}

function mockAssetTable(delegate: any, seed: Array<{ url: string; status: string; reason?: string | null; lastError?: string | null }>) {
  const originals = {
    findMany: delegate.findMany,
    findUnique: delegate.findUnique,
    create: delegate.create,
    update: delegate.update,
  };
  const rows = new Map<string, AssetRow>();
  const stats = { findMany: 0 };
  let nextId = 1;
  const insert = (data: Partial<AssetRow> & { url: string }) => {
    const row: AssetRow = { id: nextId++, status: "pending", reason: null, lastError: null, reviewModel: null, reviewEndpoint: null, ...data };
    rows.set(row.url, row);
    return row;
  };
  const reset = () => {
    rows.clear();
    stats.findMany = 0;
    seed.forEach((item) => insert(item));
  };
  delegate.findMany = async ({ where, select }: any) => {
    stats.findMany += 1;
    const urls = new Set<string>(where.url.in);
    return [...rows.values()].filter((row) => urls.has(row.url)).map((row) => pick(row, select));
  };
  delegate.findUnique = async ({ where, select }: any) => {
    const row = where.url ? rows.get(where.url) : [...rows.values()].find((item) => item.id === where.id);
    return row ? pick(row, select) : null;
  };
  // 与真实库一样按 url 唯一；逐条渲染时同一回复的摘要与渲染可能并发补登记，这里按已存在返回。
  delegate.create = async ({ data }: any) => ({ ...(rows.get(data.url) ?? insert(data)) });
  delegate.update = async ({ where, data }: any) => {
    const row = [...rows.values()].find((item) => item.id === where.id)!;
    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined) row[key] = value;
    });
    return { ...row };
  };
  return { stats, reset, restore: () => Object.assign(delegate, originals) };
}

const author = { id: 5, nickname: "作者", avatar: null, role: "user", createdAt: new Date("2025-01-01T00:00:00Z"), postCount: 3, replyCount: 9 };
const replies = [
  { id: 1, topicId: 9, authorId: 5, floor: 1, content: "<p>纯文本回复</p>", isAnonymous: false, author },
  { id: 2, topicId: 9, authorId: 5, floor: 2, content: '<p><img src="/uploads/forum/ok.webp"></p>', isAnonymous: false, author },
  {
    id: 3,
    topicId: 9,
    authorId: 2,
    floor: 3,
    content: '<p><img src="https://cputime.cn/uploads/forum/ok.webp"><img src="/uploads/forum/bad.webp"><img src="/uploads/forum/wait.webp"></p>',
    isAnonymous: true,
    anonymousAlias: "匿名同学",
    author: { ...author, id: 2, nickname: "真实昵称" },
  },
  { id: 4, topicId: 9, authorId: 5, floor: 4, content: "![新图](/uploads/forum/new.png)<p>刚上传</p>", isAnonymous: false, author },
  {
    id: 5,
    topicId: 9,
    authorId: 5,
    floor: 5,
    content: '<video src="/uploads/forum/ok.mp4" controls></video><p><img src="https://example.com/external.png"></p>',
    isAnonymous: false,
    author,
  },
  {
    id: 6,
    topicId: 9,
    authorId: 5,
    floor: 6,
    content: '<video src="/uploads/forum/bad.mp4"></video><video src="/uploads/forum/manual.mp4"></video><video src="/uploads/forum/new.mp4"></video>',
    isAnonymous: false,
    author,
  },
  {
    id: 7,
    topicId: 9,
    authorId: 5,
    floor: 7,
    content: '<p>&lt;div class=&quot;qq-video-card&quot;&gt;&lt;img src=&quot;/uploads/forum/cover.jpg&quot;&gt;&lt;video class=&quot;qq-inline-video&quot; src=&quot;/uploads/forum/ok.mp4&quot;&gt;&lt;/video&gt;&lt;/div&gt;</p>',
    isAnonymous: false,
    author,
  },
  { id: 8, topicId: 9, authorId: 5, floor: 8, content: '<p><a href="/uploads/forum/file.pdf">附件</a><img src="https://example.com/only-external.png"></p>', isAnonymous: false, author },
  { id: 9, topicId: 9, authorId: 5, floor: 9, content: '<p><img src="/uploads/forum/ok.webp"></p><video src="https://example.com/remote.mp4"></video>', isAnonymous: false, author },
];

for (const reviewEnabled of [false, true]) {
  test(`回复列表批量预取审核状态后与逐条渲染输出一致（审核${reviewEnabled ? "开启" : "关闭"}）`, async () => {
    const { prisma } = await import("../src/prisma");
    const { loadFeatures } = await import("../src/services/siteSettings");
    const { decodeRepliesForViewerWithImages, decodeReplyForViewerWithImages, decodeTopicForViewer, decodeTopicsForViewerForList } = await import("../src/services/forumPresentation");
    const { renderModeratedContents } = await import("../src/services/imageModeration");
    const { renderModeratedVideoContent } = await import("../src/services/videoModeration");
    const originalSettings = prisma.siteSetting.findMany;
    const reviewSwitch = reviewEnabled ? "on" : "off";
    prisma.siteSetting.findMany = (async () => [
      { key: "forum.anonymous.policyVersion", value: "new-user-weekly-v2" },
      ...["imageReview", "videoReview"].flatMap((scene) => [
        { key: `ai.${scene}.enabled`, value: reviewSwitch },
        { key: `ai.${scene}.apiUrl`, value: "https://ai.example.com/v1/chat/completions" },
        { key: `ai.${scene}.apiKey`, value: "test-key" },
        { key: `ai.${scene}.model`, value: "review-model" },
      ]),
    ]) as unknown as typeof originalSettings;
    const images = mockAssetTable(prisma.forumImageAsset, [
      { url: "/uploads/forum/ok.webp", status: "approved" },
      { url: "/uploads/forum/bad.webp", status: "rejected", reason: "违规图片" },
      { url: "/uploads/forum/wait.webp", status: "pending" },
      { url: "/uploads/forum/cover.jpg", status: "approved" },
    ]);
    const videos = mockAssetTable(prisma.forumVideoAsset, [
      { url: "/uploads/forum/ok.mp4", status: "approved" },
      { url: "/uploads/forum/bad.mp4", status: "rejected", reason: "违规视频" },
      { url: "/uploads/forum/manual.mp4", status: "manual_review" },
    ]);
    try {
      await loadFeatures();
      for (const viewer of [null, { userId: 2, role: "user" }, { userId: 1, role: "admin" }]) {
        images.reset();
        videos.reset();
        const batched = await decodeRepliesForViewerWithImages(replies, viewer);
        const batchedQueries = { images: images.stats.findMany, videos: videos.stats.findMany };

        images.reset();
        videos.reset();
        const individual = await Promise.all(replies.map((reply) => decodeReplyForViewerWithImages(reply, viewer)));

        assert.deepEqual(batched, individual);
        // 一次图片预取 + 旧版 QQ 视频卡片解码后新出现的封面图单独补查一次；视频只查一次。
        assert.deepEqual(batchedQueries, { images: 2, videos: 1 });
        assert.ok(images.stats.findMany + videos.stats.findMany > 6);

        assert.equal(batched[2].content.includes("违规图片"), true);
        assert.equal(batched[2].content.includes('src="/uploads/forum/ok.webp"'), true);
        assert.deepEqual(batched[2].imageReview, { enabled: reviewEnabled, totalCount: 3, pendingCount: 1, rejectedCount: 1, approvedCount: 1 });
        assert.equal(batched[4].content.includes("https://example.com/external.png"), true);
        assert.equal(batched[5].content.includes("违规视频"), true);
        assert.equal(batched[6].content.includes('<img src="/uploads/forum/cover.jpg">'), true);
        assert.equal(batched[6].imageReview.totalCount, 0);

        // 帖子列表：视频状态预取一次后，结果与原先逐帖渲染视频、再批量渲染图片的实现一致。
        const topics = replies.map((reply) => ({ ...reply, title: `帖子 ${reply.id}`, metadata: "{}", board: { type: "normal" }, tags: [] }));
        images.reset();
        videos.reset();
        const listed = await decodeTopicsForViewerForList(topics, viewer);
        const listedVideoQueries = videos.stats.findMany;
        images.reset();
        videos.reset();
        const decodedTopics = topics.map((topic) => decodeTopicForViewer(topic, viewer));
        const videoRendered = await Promise.all(decodedTopics.map((topic) => renderModeratedVideoContent(String(topic.content || ""), viewer)));
        const rendered = await renderModeratedContents(videoRendered, viewer);
        assert.deepEqual(listed, decodedTopics.map((topic, index) => ({ ...topic, content: rendered[index] })));
        assert.equal(listedVideoQueries, 1);
        assert.ok(videos.stats.findMany > 1);
      }
    } finally {
      images.restore();
      videos.restore();
      prisma.siteSetting.findMany = originalSettings;
    }
  });
}
