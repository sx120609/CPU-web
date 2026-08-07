/**
 * Detect QQ group-card messages across common OneBot representations.
 *
 * NapCat/OneBot adapters may expose a group card as a `contact` segment,
 * while forwarded/raw payloads sometimes preserve it as an explicit JSON or
 * XML card.  Keep this detector deliberately narrow so ordinary shares and
 * messages containing a group id are not blocked by accident.
 */
export function containsQqGroupCard(message: unknown): boolean {
  if (typeof message === "string") {
    return /\[CQ:contact,[^\]]*(?:type|scene|sub_type|subType)=(?:group|group_card|groupcard)(?:,|\])/i.test(message)
      || /\[CQ:(?:json|xml),[^\]]*(?:group[ _-]?card|groupcard|群名片|群卡片)/iu.test(message);
  }
  if (Array.isArray(message)) return message.some((item) => containsQqGroupCard(item));
  if (!message || typeof message !== "object") return false;

  const item = message as Record<string, any>;
  const type = String(item.type || "").trim().toLowerCase();
  const data = item.data && typeof item.data === "object" ? item.data : item;
  const subtype = String(data.type ?? data.sub_type ?? data.subType ?? data.scene ?? "")
    .trim()
    .toLowerCase();
  if (type === "contact" && (subtype === "group" || subtype === "group_card" || subtype === "groupcard")) {
    return true;
  }
  if ((type === "json" || type === "xml") && /(?:group[ _-]?card|groupcard|群名片|群卡片)/iu.test(JSON.stringify(data))) {
    return true;
  }

  return containsQqGroupCard(item.data?.content)
    || containsQqGroupCard(item.data?.data)
    || containsQqGroupCard(item.data?.message)
    || containsQqGroupCard(item.message)
    || containsQqGroupCard(item.content);
}
