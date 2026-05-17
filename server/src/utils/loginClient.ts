import type { Request } from "express";

export type LoginClient = "ios" | "android" | "web" | "unknown";

export interface LoginClientInfo {
  client: LoginClient;
  label: string;
}

function normalizeClient(value: string | undefined | null): LoginClient | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (["ios", "iphone", "ipad"].includes(v)) return "ios";
  if (["android", "android-app"].includes(v)) return "android";
  if (v === "web" || v === "browser") return "web";
  if (v === "unknown") return "unknown";
  return null;
}

export function detectLoginClient(req: Request): LoginClientInfo {
  const explicit = normalizeClient(req.get("x-cpu-client"));
  if (explicit) return toInfo(explicit);

  const ua = (req.get("user-agent") ?? "").toLowerCase();
  if (ua.includes("cpuwebscheduleapp")) return toInfo("android");
  if (ua) return toInfo("web");
  return toInfo("unknown");
}

function toInfo(client: LoginClient): LoginClientInfo {
  if (client === "ios") return { client, label: "iOS" };
  if (client === "android") return { client, label: "安卓" };
  if (client === "web") return { client, label: "网页" };
  return { client, label: "未知" };
}
