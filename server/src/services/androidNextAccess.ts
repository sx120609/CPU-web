import access from "../releases/android-next-access.json";
import { createHash } from "node:crypto";

/**
 * Who may see 药大拾间 NEXT. In "invite" mode the site does not advertise it:
 * only people with an invitation link (`/next?invite=<code>`) can read its
 * release and download it, and installed NEXT apps keep updating. "public"
 * shows it to every Android visitor of the download page.
 */
export type AndroidNextAccess = { mode: "invite" | "public"; inviteCodeSha256: string[] };

const CODE = /^[A-Za-z0-9]{8,64}$/;

export function validateAndroidNextAccess(value: AndroidNextAccess): AndroidNextAccess {
  if ((value.mode !== "invite" && value.mode !== "public") || !Array.isArray(value.inviteCodeSha256)
    || value.inviteCodeSha256.length > 50 || new Set(value.inviteCodeSha256).size !== value.inviteCodeSha256.length
    || value.inviteCodeSha256.some((hash) => !/^[a-f0-9]{64}$/.test(hash))) {
    throw new Error("药大拾间 NEXT 访问规则无效");
  }
  return value;
}

/** Invitation codes are case-insensitive; only their SHA-256 is kept in the repository. */
export function inviteCodeHash(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

export function isValidAndroidNextInvite(policy: AndroidNextAccess, code: unknown): code is string {
  return typeof code === "string" && CODE.test(code.trim()) && policy.inviteCodeSha256.includes(inviteCodeHash(code));
}

/** The installed NEXT app (its user agent) or a valid invitation may read NEXT; anyone may in public mode. */
export function canSeeAndroidNext(policy: AndroidNextAccess, request: { userAgent?: string; invite?: unknown }): boolean {
  if (policy.mode === "public") return true;
  if (/\bCPUWebNextApp\//i.test(request.userAgent || "")) return true;
  return isValidAndroidNextInvite(policy, request.invite);
}

export const androidNextAccess = validateAndroidNextAccess(access as AndroidNextAccess);
