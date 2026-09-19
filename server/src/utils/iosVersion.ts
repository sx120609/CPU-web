import type { Request } from "express";

/** Return the iOS major version reported by the native/web client, if present. */
export function detectIosMajorVersion(req: Request): number | null {
  const explicit = Number.parseInt(String(req.get("x-cpu-ios-version") || ""), 10);
  if (Number.isInteger(explicit) && explicit >= 1 && explicit <= 99) return explicit;

  const userAgent = String(req.get("user-agent") || "");
  const match = userAgent.match(/CPU(?: iPhone)? OS (\d+)(?:[_\.\s]|$)/i);
  const major = Number.parseInt(match?.[1] || "", 10);
  return Number.isInteger(major) && major >= 1 && major <= 99 ? major : null;
}
