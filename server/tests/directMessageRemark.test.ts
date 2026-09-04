import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schemaSource = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const migrationSource = readFileSync(
  new URL("../prisma/migrations/20260904160000_add_direct_message_remarks/migration.sql", import.meta.url),
  "utf8",
);
const routeSource = readFileSync(new URL("../src/routes/directMessage.ts", import.meta.url), "utf8");
const directMessagesSource = readFileSync(
  new URL("../../web/src/components/messages/DirectMessages.vue", import.meta.url),
  "utf8",
);
const topicSource = readFileSync(new URL("../../web/src/views/forum/Topic.vue", import.meta.url), "utf8");
const userProfileSource = readFileSync(new URL("../../web/src/views/profile/User.vue", import.meta.url), "utf8");

test("private remarks belong to one viewer and one target user", () => {
  assert.match(schemaSource, /model DirectMessageRemark \{[\s\S]*?ownerId\s+Int[\s\S]*?targetUserId\s+Int/);
  assert.match(schemaSource, /@@unique\(\[ownerId, targetUserId\]\)/);
  assert.match(migrationSource, /UNIQUE INDEX[\s\S]*?"ownerId", "targetUserId"/);
});

test("remark routes support batch reads, upserts, and clearing", () => {
  assert.match(routeSource, /get\("\/remarks"/);
  assert.match(routeSource, /patch\("\/remarks\/:userId"/);
  assert.match(routeSource, /directMessageRemark\.upsert/);
  assert.match(routeSource, /directMessageRemark\.deleteMany/);
  assert.match(routeSource, /counterpart\.anonymous \? null : counterpartRemark/);
});

test("direct messages, topic authors, and user profiles share the remark editor", () => {
  for (const source of [directMessagesSource, topicSource, userProfileSource]) {
    assert.match(source, /promptDirectMessageRemark/);
  }
  assert.match(topicSource, /directMessageApi\.remarks\(userIds/);
  assert.match(topicSource, /if \(!auth\.isLoggedIn \|\| post\.isAnonymous/);
  assert.match(topicSource, /\{\{ userRemarkForPost\(topic\) \? "改备注" : "备注" \}\}/);
  assert.match(topicSource, /\{\{ userRemarkForPost\(entry\.item\) \? "改备注" : "备注" \}\}/);
});
