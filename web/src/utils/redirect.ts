const DEFAULT_REDIRECT = "/home";

export function resolveSafeRedirect(value: unknown, fallback = DEFAULT_REDIRECT) {
  if (Array.isArray(value)) return fallback;
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return fallback;
  if (trimmed.includes("\\")) return fallback;
  return trimmed;
}
