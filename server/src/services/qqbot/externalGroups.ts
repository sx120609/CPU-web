// 与其他服务共用同一个 QQ 号时，交给对方处理的群（例如独立部署的兴趣群 bot）。
// 这些群的消息、邀请和入群事件拾间一律不处理，也不会被自动登记为投稿群或推送站内通知。
export function qqBotExternalGroupIds(value = process.env.QQBOT_EXTERNAL_GROUP_IDS) {
  return new Set(
    String(value ?? "")
      .split(/[,，\s]+/)
      .map((item) => item.trim())
      .filter((item) => /^\d+$/.test(item)),
  );
}

export function isQqBotExternalGroup(groupId: unknown, value?: string) {
  const normalized = String(groupId ?? "").trim();
  return Boolean(normalized) && qqBotExternalGroupIds(value).has(normalized);
}
