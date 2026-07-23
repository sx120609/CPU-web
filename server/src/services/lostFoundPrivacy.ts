export type LostFoundViewer = {
  userId?: number | null;
  role?: string | null;
  lostFoundRole?: string | null;
} | null | undefined;

const LOST_FOUND_STAFF_ROLES = new Set(["admin", "mod"]);
const LOST_FOUND_MODULE_ROLES = new Set(["admin", "super_admin"]);
const LOST_FOUND_TEXT_FIELDS = [
  "itemName",
  "description",
  "location",
  "storageLocation",
  "publisherDepartment",
  "remark",
] as const;
const LOST_FOUND_METADATA_FIELDS = [
  "location",
  "storageLocation",
  "publisherDepartment",
  "remark",
] as const;

function maskPersonName(name: string) {
  const chars = Array.from(name);
  if (chars.length <= 1) return "*";
  if (chars.length === 2) return `${chars[0]}*`;
  return `${chars[0]}${"*".repeat(chars.length - 2)}${chars.at(-1)}`;
}

function maskEmail(value: string) {
  const separator = value.lastIndexOf("@");
  if (separator <= 0) return value;
  const local = value.slice(0, separator);
  const domain = value.slice(separator);
  if (local.length === 1) return `*${domain}`;
  return `${local[0]}${"*".repeat(Math.min(3, local.length - 1))}${domain}`;
}

/**
 * Masks common personal identifiers without changing unrelated numbers such as
 * dates or room numbers. Already-masked values do not match these rules again.
 */
export function maskLostFoundSensitiveText(value: unknown) {
  let text = String(value ?? "");
  if (!text) return text;

  // Chinese resident ID: keep the issuing-region prefix and final four chars.
  text = text.replace(
    /(?<!\d)(\d{3})\d{11}(\d{3}[\dXx])(?!\d)/g,
    (_match, prefix: string, suffix: string) => `${prefix}${"*".repeat(11)}${suffix}`,
  );

  // Mainland mobile numbers, with optional country code and separators.
  text = text.replace(
    /(?<!\d)(?:\+?86[\s-]?)?(1[3-9]\d)[\s-]?(\d{4})[\s-]?(\d{4})(?!\d)/g,
    (_match, prefix: string, _middle: string, suffix: string) => `${prefix}****${suffix}`,
  );

  // CPU student numbers currently use ten digits.
  text = text.replace(
    /(?<!\d)(\d{4})\d{4}(\d{2})(?!\d)/g,
    (_match, prefix: string, suffix: string) => `${prefix}****${suffix}`,
  );

  // Landline numbers: retain the area code and final four digits.
  text = text.replace(
    /(?<!\d)(0\d{2,3})[\s-]?(\d{3,4})(\d{4})(?!\d)/g,
    (_match, areaCode: string, _middle: string, suffix: string) => `${areaCode}-****${suffix}`,
  );

  text = text.replace(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
    (email) => maskEmail(email),
  );

  // Names are masked only when a field label makes the meaning unambiguous.
  text = text.replace(
    /((?:姓名|联系人|失主|拾取人|捡拾人|登记人|领取人)\s*[:：]?\s*)([\u3400-\u9fff]{2,4})/g,
    (_match, label: string, name: string) => `${label}${maskPersonName(name)}`,
  );

  return text;
}

export function canViewLostFoundRaw(viewer: LostFoundViewer, authorId?: number | null) {
  if (!viewer) return false;
  return Boolean(
    (authorId && viewer.userId === authorId)
    || LOST_FOUND_STAFF_ROLES.has(String(viewer.role || ""))
    || LOST_FOUND_MODULE_ROLES.has(String(viewer.lostFoundRole || "")),
  );
}

export function sanitizeLostFoundItemFields<T extends Record<string, any>>(item: T, revealRaw: boolean): T {
  if (revealRaw) return item;
  const sanitized: Record<string, any> = { ...item };
  for (const field of LOST_FOUND_TEXT_FIELDS) {
    if (field in sanitized) sanitized[field] = maskLostFoundSensitiveText(sanitized[field]);
  }
  return sanitized as T;
}

export function sanitizeLostFoundTopicFields<T extends Record<string, any>>(topic: T, viewer?: LostFoundViewer): T {
  const rawMetadata = topic.metadata;
  const metadata = typeof rawMetadata === "string"
    ? safeJson(rawMetadata)
    : rawMetadata && typeof rawMetadata === "object"
      ? rawMetadata
      : {};
  if (!metadata.lostFoundItem || canViewLostFoundRaw(viewer, topic.authorId)) return topic;

  const sanitizedMetadata = { ...metadata };
  for (const field of LOST_FOUND_METADATA_FIELDS) {
    if (field in sanitizedMetadata) {
      sanitizedMetadata[field] = maskLostFoundSensitiveText(sanitizedMetadata[field]);
    }
  }
  return {
    ...topic,
    title: maskLostFoundSensitiveText(topic.title),
    content: maskLostFoundSensitiveText(topic.content),
    metadata: typeof rawMetadata === "string"
      ? JSON.stringify(sanitizedMetadata)
      : sanitizedMetadata,
  };
}

function safeJson(value: string) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
