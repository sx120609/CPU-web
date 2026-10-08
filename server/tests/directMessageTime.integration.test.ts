import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import express from "express";
import { prisma } from "../src/prisma";
import { directMessageRouter } from "../src/routes/directMessage";
import { errorHandler } from "../src/middleware/error";
import { updateDirectConversationAfterDelivery } from "../src/services/directMessageSubmissionReview";

// Run only against a disposable local schema after prisma db push --skip-generate.
test("direct-message SQL and all API previews preserve UTC in both database timezones", {
  skip: process.env.DIRECT_MESSAGE_TIME_INTEGRATION_TEST !== "1",
}, async (t) => {
  const url = new URL(process.env.DATABASE_URL || "http://invalid");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.searchParams.get("schema"), "message_time_test");
  assert.equal(url.searchParams.get("connection_limit"), "1", "SET TIME ZONE must affect the only connection");
  t.after(() => prisma.$disconnect());
  let viewerId = 0;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { userId: viewerId, role: "user", blockedUserIds: [] } as any;
    next();
  });
  app.use(directMessageRouter);
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  async function api(path: string, content?: string) {
    const response = await fetch(`${origin}${path}`, content === undefined ? {} : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }),
    });
    const body = await response.json() as any;
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.code, 0);
    return body.data;
  }

  for (const zone of ["UTC", "Asia/Shanghai"]) {
    await t.test(zone, async () => {
      await prisma.$executeRawUnsafe(`SET TIME ZONE '${zone}'`);
      const suffix = randomUUID();
      const owner = await prisma.user.create({ data: { username: `time-owner-${suffix}`, passwordHash: "test", nickname: "Time owner" } });
      const other = await prisma.user.create({ data: { username: `time-other-${suffix}`, passwordHash: "test", nickname: "Time other" } });
      viewerId = owner.id;
      const beforeSend = Date.now();
      const sent = await api(`/with/${other.id}/messages`, "synthetic time regression");
      const afterSend = Date.now();
      const id = sent.conversation.id;
      assert.equal(sent.conversation.lastMessageAt, sent.message.createdAt);
      assert.equal(sent.conversation.lastMessage.createdAt, sent.message.createdAt);
      for (const value of [sent.conversation.createdAt, sent.message.createdAt]) {
        assert.match(value, /Z$/);
        assert.ok(Date.parse(value) >= beforeSend && Date.parse(value) <= afterSend);
      }

      // Actual Prisma parameter binding + actual PostgreSQL column types, not a SQL mock.
      const first = new Date("2026-10-07T15:59:00Z");
      const latest = new Date("2026-10-07T16:01:00Z"); // crosses midnight in UTC+8
      await prisma.directConversation.update({ where: { id }, data: { lastMessageAt: first } });
      await updateDirectConversationAfterDelivery(prisma, { conversationId: id, senderId: other.id, createdAt: latest });
      let stored = await prisma.directConversation.findUniqueOrThrow({ where: { id } });
      assert.equal(stored.lastMessageAt.toISOString(), latest.toISOString());
      assert.equal(stored.recipientRepliedAt?.toISOString(), latest.toISOString());
      assert.ok(Math.abs(stored.updatedAt.getTime() - Date.now()) < 5000);
      // Older reviews completing later must not move the conversation backwards.
      await updateDirectConversationAfterDelivery(prisma, { conversationId: id, senderId: other.id, createdAt: first });
      stored = await prisma.directConversation.findUniqueOrThrow({ where: { id } });
      assert.equal(stored.lastMessageAt.toISOString(), latest.toISOString());
      assert.equal(stored.recipientRepliedAt?.toISOString(), latest.toISOString());

      await prisma.directMessage.update({ where: { id: sent.message.id }, data: { createdAt: first } });
      const message = await prisma.directMessage.create({ data: { conversationId: id, senderId: other.id, content: "synthetic midnight", createdAt: latest } });
      await prisma.directMessage.create({ data: { conversationId: id, senderId: other.id, content: "synthetic hidden", hidden: true, createdAt: new Date("2026-10-08T08:00:00Z") } });
      // Simulate legacy denormalized data; reads must repair presentation without rewriting it.
      const legacy = new Date("2026-10-08T00:01:00Z");
      await prisma.directConversation.update({ where: { id }, data: { lastMessageAt: legacy } });
      const third = await prisma.user.create({ data: { username: `time-third-${suffix}`, passwordHash: "test", nickname: "Time third" } });
      const older = await prisma.directConversation.create({ data: {
        participantLowId: owner.id, participantHighId: third.id, initiatedById: owner.id,
        lastMessageAt: new Date("2026-10-09T00:00:00Z"),
      } });
      await prisma.directMessage.create({ data: { conversationId: older.id, senderId: third.id, content: "synthetic older preview", createdAt: first } });
      const board = await prisma.board.create({ data: { slug: `time-${suffix}`, name: "Time regression" } });
      const topic = await prisma.topic.create({ data: { boardId: board.id, authorId: other.id, title: "Synthetic", content: "Synthetic" } });
      for (const path of [`/with/${other.id}`, `/forum/topic/${topic.id}`, `/conversations/${id}/messages?limit=1`, `/conversations/${id}/messages?before=${message.id}&limit=1`]) {
        const data = await api(path);
        assert.equal(data.conversation.lastMessageAt, latest.toISOString(), path);
        assert.equal(data.conversation.lastMessage.id, message.id, path);
        assert.equal(data.conversation.lastMessage.createdAt, latest.toISOString(), path);
        for (const item of data.messages || []) assert.match(item.createdAt, /Z$/);
      }
      const list = await api("/conversations");
      const preview = list.conversations.find((item: any) => item.id === id);
      assert.equal(preview.lastMessageAt, latest.toISOString());
      assert.equal(preview.lastMessage.id, message.id);
      assert.ok(list.conversations.findIndex((item: any) => item.id === id) < list.conversations.findIndex((item: any) => item.id === older.id));
      assert.equal((await prisma.directConversation.findUniqueOrThrow({ where: { id } })).lastMessageAt.toISOString(), legacy.toISOString());
      assert.equal((await prisma.directMessage.findUniqueOrThrow({ where: { id: message.id } })).createdAt.toISOString(), latest.toISOString());
      const reply = await api(`/conversations/${id}/messages`, "synthetic second send");
      assert.equal(reply.conversation.lastMessageAt, reply.message.createdAt);
      assert.equal(reply.conversation.lastMessage.id, reply.message.id);
      const forumReply = await api(`/forum/topic/${topic.id}/messages`, "synthetic forum send");
      assert.equal(forumReply.conversation.lastMessageAt, forumReply.message.createdAt);
      assert.equal(forumReply.conversation.lastMessage.id, forumReply.message.id);
      const anonymousTopic = await prisma.topic.create({ data: { boardId: board.id, authorId: other.id, title: "Synthetic anonymous", content: "Synthetic", isAnonymous: true, anonymousAlias: "Time alias" } });
      const anonymousSend = await api(`/forum/topic/${anonymousTopic.id}/messages`, "synthetic anonymous send");
      assert.notEqual(anonymousSend.conversation.id, id);
      const anonymousTarget = await api(`/forum/topic/${anonymousTopic.id}`);
      assert.equal(anonymousTarget.conversation.lastMessageAt, anonymousSend.message.createdAt);
      assert.equal(anonymousTarget.conversation.lastMessage.id, anonymousSend.message.id);
    });
  }
});
