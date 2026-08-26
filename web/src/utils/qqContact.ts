export function normalizeQqId(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

export function buildQqAddFriendUrl(value: unknown) {
  const qq = normalizeQqId(value);
  return qq
    ? `mqqapi://card/show_pslcard?src_type=internal&version=1&uin=${qq}&card_type=person&source=sharecard`
    : "";
}

export function buildQqAddFriendLandingUrl(value: unknown, origin: string) {
  const qq = normalizeQqId(value);
  if (!qq) return "";
  const url = new URL("/qqbot-add-friend.html", origin);
  url.searchParams.set("uin", qq);
  return url.toString();
}
