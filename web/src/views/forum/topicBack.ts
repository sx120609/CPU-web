// Back navigation for the topic page. Pure, so tests can run it without a router or a DOM.
//
// Lists add `?from=<fullPath>` when they open a topic. The back control names that page and returns to it:
// through history when the previous entry is that very page (keeps its scroll position and does not grow
// history), otherwise by pushing it. Without `from` the label and the target stay as before (最新).

const ORIGIN = "https://topic-back.invalid";

/** A same-app path ("/…"), normalised so `from` and `history.state.back` compare equal; "" otherwise. */
export function normalizeTopicBackTarget(raw: unknown): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return "";
  const text = value.trim();
  // "//host" and "/\host" would leave the app.
  if (!text.startsWith("/") || text.startsWith("//") || text.startsWith("/\\")) return "";
  let url: URL;
  try {
    url = new URL(text, ORIGIN);
  } catch {
    return "";
  }
  if (url.origin !== ORIGIN) return "";
  const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/u, "") : url.pathname;
  return `${pathname}${url.search}${url.hash}`;
}

function parse(target: string) {
  const url = new URL(target, ORIGIN);
  return { path: url.pathname, channel: url.searchParams.get("channel") || "" };
}

/** The label of the back control: 返回首页 / 论坛 / 板块 / 二手 / 最新 / 热榜 / 搜索, or 返回上页. */
export function topicBackLabel(from: unknown, isAnnouncement = false): string {
  const target = normalizeTopicBackTarget(from);
  if (!target) return isAnnouncement ? "返回上页" : "返回最新";
  const { path, channel } = parse(target);
  if (path === "/" || path === "/home") return "返回首页";
  if (path === "/search/results") return "返回搜索";
  if (path === "/forum/latest") return "返回最新";
  if (path === "/forum/hot") return "返回热榜";
  if (path === "/forum/b/market" || path === "/market") return "返回二手";
  if (path.startsWith("/forum/b/")) return "返回板块";
  if (path === "/forum") {
    // The phone forum shows its lists as channels of one page.
    if (channel === "hot") return "返回热榜";
    if (channel === "market") return "返回二手";
    if (channel === "question" || channel === "freshman") return "返回板块";
    return "返回论坛";
  }
  return "返回上页";
}

export type TopicBackStep =
  | { kind: "history-back" }
  | { kind: "push"; to: string }
  | { kind: "announcement" }
  | { kind: "latest" };

/**
 * What the back control does. `historyBack` is the router's `history.state.back`, the entry before this one.
 * History is only used when it leads to the page the label names, so the label and the action always agree.
 */
export function topicBackStep(from: unknown, historyBack: unknown, isAnnouncement = false): TopicBackStep {
  const target = normalizeTopicBackTarget(from);
  if (target) {
    return normalizeTopicBackTarget(historyBack) === target ? { kind: "history-back" } : { kind: "push", to: target };
  }
  return isAnnouncement ? { kind: "announcement" } : { kind: "latest" };
}
