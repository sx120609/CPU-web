// 把真实前端发出的 /api 请求映射到 mock-data.mjs 的示例数据。
// 返回值会被包成 { code: 0, data, message: "" }；返回 undefined 表示没有覆盖到这个接口。
import * as d from "./mock-data.mjs";

const page = (list, params) => {
  const size = Number(params.get("size") || 15);
  return { page: Number(params.get("page") || 1), size, total: list.length, pins: [], list };
};

export function resolveApi(method, pathname, params) {
  const p = pathname.replace(/^\/api/, "");
  const key = `${method} ${p}`;
  switch (key) {
    case "GET /site/features": return d.features;
    case "GET /site/config": return d.siteConfig;
    case "GET /site/navigation": return d.navigation;
    case "GET /user/me": return d.me;
    case "GET /messages": return d.messages;
    case "GET /messages/settings": return d.messageSettings;
    case "GET /topics/smart-compose/current": return null;
    case "POST /topics/impressions": return { views: [] };
    case "GET /forum-ads": return [];
    case "GET /tools": return [];
    case "GET /boards": return d.boards;
    case "GET /couple": return { status: "none" };
    case "GET /announcements/preference": return { customized: false, selected: ["jwc-notice", "xgc-notice", "lib-notice"], defaults: ["jwc-notice", "xgc-notice", "lib-notice"] };
    case "GET /home/summary": return d.homeSummary;
    case "GET /home/hot-ranking": return d.hotRanking;
    case "GET /home/latest-feed":
      return page(params.get("stream") === "market" ? d.marketTopics : d.forumTopics, params);
    case "GET /topics": {
      if (params.get("type") === "announce" || /notice/.test(params.get("board") || "")) {
        const board = params.get("board");
        return page(board ? d.announcements.filter((a) => a.board.slug === board) : d.announcements, params);
      }
      const board = params.get("board");
      const pool = board === "market" ? d.marketTopics : d.forumTopics.filter((t) => !board || t.board.slug === board);
      return page(pool, params);
    }
    default:
      break;
  }
  if (p.startsWith("/jwxt/") && d.jwxt) {
    const hit = d.jwxt(method, p.slice("/jwxt".length), params);
    if (hit !== undefined) return hit;
  }
  return undefined;
}
