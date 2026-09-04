export const ACCOUNT_VERIFICATION_TYPES = [
  "campus_organization",
] as const;

export type AccountVerificationType = typeof ACCOUNT_VERIFICATION_TYPES[number];

export const ACCOUNT_VERIFICATION_TYPE_LABELS: Record<AccountVerificationType, string> = {
  campus_organization: "组织认证",
};

export const ACCOUNT_VERIFICATION_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "withdrawn",
  "revoked",
  "superseded",
] as const;

export const ACCOUNT_VERIFICATION_SUBMISSION_WINDOW_DAYS = 30;
export const ACCOUNT_VERIFICATION_SUBMISSION_LIMIT = 3;

export type AccountVerificationSource = {
  verificationType?: string | null;
  verificationLabel?: string | null;
  verificationVerifiedAt?: Date | string | null;
  verificationExpiresAt?: Date | string | null;
};

export function buildAccountVerification(source: AccountVerificationSource | null | undefined, now = new Date()) {
  const type = String(source?.verificationType || "") as AccountVerificationType;
  const label = String(source?.verificationLabel || "").trim();
  const verifiedAt = asValidDate(source?.verificationVerifiedAt);
  const expiresAt = asValidDate(source?.verificationExpiresAt);
  if (!ACCOUNT_VERIFICATION_TYPES.includes(type) || !label || !verifiedAt) return null;
  if (expiresAt && expiresAt.getTime() <= now.getTime()) return null;
  return {
    type,
    typeLabel: ACCOUNT_VERIFICATION_TYPE_LABELS[type],
    label,
    verifiedAt: verifiedAt.toISOString(),
    expiresAt: expiresAt?.toISOString() ?? null,
  };
}

export function accountVerificationSubmissionBlock(input: {
  hasPending: boolean;
  recentSubmissionCount: number;
}) {
  if (input.hasPending) return "已有认证申请正在审核，请勿重复提交";
  if (input.recentSubmissionCount >= ACCOUNT_VERIFICATION_SUBMISSION_LIMIT) {
    return `30 天内最多提交 ${ACCOUNT_VERIFICATION_SUBMISSION_LIMIT} 次认证申请`;
  }
  return "";
}

export function accountVerificationWindowStart(now = new Date()) {
  return new Date(now.getTime() - ACCOUNT_VERIFICATION_SUBMISSION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

export function normalizedVerificationExpiry(value: string | null | undefined, now = new Date()) {
  if (!value) return null;
  const normalized = value.trim();
  let parsed = new Date(normalized);
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const calendarDate = new Date(Date.UTC(year, month - 1, day));
    const exactDate = calendarDate.getUTCFullYear() === year
      && calendarDate.getUTCMonth() === month - 1
      && calendarDate.getUTCDate() === day;
    parsed = exactDate ? new Date(`${normalized}T23:59:59.999+08:00`) : new Date(Number.NaN);
  }
  if (Number.isNaN(parsed.getTime())) throw new Error("认证有效期格式不正确");
  if (parsed.getTime() <= now.getTime()) throw new Error("认证有效期必须晚于当前时间");
  return parsed;
}

function asValidDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
