const DEFAULT_REDIRECT = "/home";

type LoginRedirectUser = {
  role?: string;
  voiceHubRole?: "admin" | "super_admin" | null;
  lostFoundRole?: "admin" | "super_admin" | null;
} | null | undefined;

export function resolveSafeRedirect(value: unknown, fallback = DEFAULT_REDIRECT) {
  if (Array.isArray(value)) return fallback;
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return fallback;
  if (trimmed.includes("\\")) return fallback;
  return trimmed;
}

export function isOAuthAuthorizationRedirect(value: string) {
  return value === "/api/oauth/authorize" || value.startsWith("/api/oauth/authorize?");
}

export function resolveLoginRedirect(value: unknown, user: LoginRedirectUser) {
  const requestedRedirect = resolveSafeRedirect(value, "");
  if (isOAuthAuthorizationRedirect(requestedRedirect)) return requestedRedirect;
  if (user?.role === "voicehub_admin") return "/voicehub/dashboard";
  if (user?.voiceHubRole === "super_admin" || user?.lostFoundRole === "super_admin") return "/admin?tab=users";
  if (user?.lostFoundRole) return "/admin?tab=lost-found";
  if (user?.voiceHubRole === "admin") return "/voicehub/dashboard";
  return requestedRedirect || DEFAULT_REDIRECT;
}
