const STAFF_GROUP_ACTIONABLE_NOTIFICATION_TYPES = new Set([
  "topic-manual-review-admin",
  "reply-manual-review-admin",
]);

type QqGroupNotificationPolicy = {
  notificationEnabled: boolean;
  notifyCategories: readonly string[];
  notifyAudiences: readonly string[];
};

type UserMessageSetting = {
  qqBotNotifyEnabled?: boolean;
  subscribeReply?: boolean;
  subscribeLike?: boolean;
  subscribeSchool?: boolean;
  subscribeSystem?: boolean;
} | null | undefined;

export function isNotificationVisibleToQq(notification: { targetClient?: string | null }) {
  return !notification.targetClient || notification.targetClient === "all";
}

export function shouldDeliverQqNotificationToUser(
  notification: { category?: string | null; targetClient?: string | null; level?: string | null },
  messageSetting?: UserMessageSetting,
) {
  if (!isNotificationVisibleToQq(notification)) return false;
  if (messageSetting?.qqBotNotifyEnabled === false) return false;
  if (notification.category === "reply") return messageSetting?.subscribeReply !== false;
  if (notification.category === "like") return messageSetting?.subscribeLike !== false;
  if (notification.category === "school-feed") return messageSetting?.subscribeSchool !== false;
  if (notification.category === "system") return messageSetting?.subscribeSystem !== false;
  return true;
}

export function shouldDeliverQqNotificationToGroup(
  group: QqGroupNotificationPolicy,
  notification: { userId?: number | null; category?: string | null; targetClient?: string | null; payload?: unknown },
  recipientRole?: string | null,
) {
  if (!group.notificationEnabled) return false;
  if (!notification.category || !group.notifyCategories.includes(notification.category)) return false;
  if (notification.userId == null) {
    return group.notifyAudiences.includes("public") && isNotificationVisibleToQq(notification);
  }
  if (!group.notifyAudiences.includes("staff")) return false;
  if (recipientRole !== "admin" && recipientRole !== "mod") return false;
  return isStaffGroupActionableNotification(notification);
}

export function buildGroupNotificationDeliveryKey(notification: {
  id?: number | null;
  userId?: number | null;
  category?: string | null;
  title?: string | null;
  content?: string | null;
  payload?: unknown;
  link?: string | null;
  source?: string | null;
}) {
  if (notification.userId == null) return `global:${notification.id || 0}`;
  const payload = parseNotificationPayload(notification.payload);
  const topicId = toPositiveInt(payload.topicId);
  const replyId = toPositiveInt(payload.replyId);
  const type = String(payload.type || "").trim();
  return [
    "staff",
    type || notification.category || "",
    topicId || 0,
    replyId || 0,
  ].join(":");
}

export function isStaffGroupActionableNotification(notification: { category?: string | null; payload?: unknown }) {
  if (notification.category !== "system") return false;
  const payload = parseNotificationPayload(notification.payload);
  const type = String(payload.type || "").trim();
  return STAFF_GROUP_ACTIONABLE_NOTIFICATION_TYPES.has(type);
}

export function parseNotificationPayload(payload: unknown): Record<string, any> {
  if (!payload) return {};
  if (typeof payload === "string") {
    try {
      return JSON.parse(payload);
    } catch {
      return {};
    }
  }
  if (typeof payload === "object") return payload as Record<string, any>;
  return {};
}

export function toPositiveInt(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
