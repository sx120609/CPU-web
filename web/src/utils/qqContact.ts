export function normalizeQqId(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

export function buildQqAddFriendUrl(value: unknown) {
  const qq = normalizeQqId(value);
  if (!qq) return "";
  const url = new URL("https://qm.qq.com/cgi-bin/qm/qr");
  url.searchParams.set("uin", qq);
  url.searchParams.set("Site", "cputime.cn");
  url.searchParams.set("Menu", "yes");
  return url.toString();
}
