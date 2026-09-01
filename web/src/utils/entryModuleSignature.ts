export function buildEntryModuleSignature(sources: Iterable<string>, baseUrl: string) {
  return Array.from(sources)
    .map((src) => normalizeEntryModuleUrl(src, baseUrl))
    .filter(Boolean)
    .sort()
    .join("|");
}

export function normalizeEntryModuleUrl(src: string, baseUrl: string) {
  try {
    const url = new URL(src, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return `${url.origin}${url.pathname}`;
  } catch {
    return "";
  }
}
