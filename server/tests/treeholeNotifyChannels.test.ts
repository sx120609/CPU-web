import test from "node:test";
import assert from "node:assert/strict";
import { withTreeholeNotifyCategory } from "../src/services/treeholeNotifyChannels";
import { shouldDeliverQqNotificationToGroup, shouldDeliverQqNotificationToUser } from "../src/services/qqbot/notifications";
import { normalizeNotifyCategories, shouldDeliverWechatNotification, wechatNotificationPriority } from "../src/services/wechatService";

test("the one-time backfill appends treehole to stored channel categories", () => {
  assert.equal(withTreeholeNotifyCategory('["reply","system"]'), '["reply","system","treehole"]');
  assert.equal(withTreeholeNotifyCategory("[]"), '["treehole"]');
  assert.equal(withTreeholeNotifyCategory('["reply","treehole"]'), null);
  assert.equal(withTreeholeNotifyCategory("not json"), null);
  assert.equal(withTreeholeNotifyCategory('{"reply":true}'), null);
});

test("treehole reminders reach a user's own QQ but never a QQ group", () => {
  const notification = { userId: 7, category: "treehole", targetClient: null, payload: '{"type":"treehole-message"}' };
  assert.equal(shouldDeliverQqNotificationToUser(notification, { qqBotNotifyEnabled: true }), true);
  assert.equal(shouldDeliverQqNotificationToUser(notification, { qqBotNotifyEnabled: false }), false);
  const group = { notificationEnabled: true, notifyCategories: ["system", "school-feed"], notifyAudiences: ["public", "staff"] };
  assert.equal(shouldDeliverQqNotificationToGroup(group, notification, "admin"), false);
});

test("WeChat accepts the treehole category and ranks it with other time-sensitive notices", () => {
  assert.deepEqual(normalizeNotifyCategories(["reply", "treehole", "unknown"]), ["reply", "treehole"]);
  assert.equal(shouldDeliverWechatNotification({ category: "treehole", targetClient: null }, { wechatNotifyEnabled: true }), true);
  assert.equal(shouldDeliverWechatNotification({ category: "treehole", targetClient: null }, { wechatNotifyEnabled: false }), false);
  assert.ok(wechatNotificationPriority({ category: "treehole", payload: "{}" }) > wechatNotificationPriority({ category: "reply", payload: "{}" }));
});
