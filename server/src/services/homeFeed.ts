import { Errors } from "../utils/response";
import { visibleBoardSlugFilter } from "./retiredBoards";

export type HomeFeedStream = "all" | "forum" | "market" | "lost-found";
export const LOST_FOUND_BOARD_SLUG = "lost-found";

export function parseHomeFeedStream(value: unknown): HomeFeedStream {
  const stream = String(value ?? "all").trim().toLowerCase();
  if (stream === "all" || stream === "forum" || stream === "market" || stream === "lost-found") return stream;
  throw Errors.badRequest("首页动态分流参数无效");
}

export function selectHomeFeedBoardTypes(boardTypes: string[], stream: HomeFeedStream) {
  const contentTypes = boardTypes.filter((type) => type !== "announce");
  if (stream === "forum") return contentTypes.filter((type) => type !== "market");
  if (stream === "market") return contentTypes.filter((type) => type === "market");
  if (stream === "lost-found") return contentTypes.filter((type) => type === "normal");
  return contentTypes;
}

export function selectHomeFeedBoardSlugWhere(stream: HomeFeedStream, lostFoundOpen = true) {
  const retired = visibleBoardSlugFilter().slug.notIn;
  if (stream === "forum") {
    return { slug: { notIn: [...retired, LOST_FOUND_BOARD_SLUG] } };
  }
  if (stream === "lost-found") {
    return lostFoundOpen && !retired.includes(LOST_FOUND_BOARD_SLUG as any)
      ? { slug: LOST_FOUND_BOARD_SLUG }
      : { slug: { in: [] as string[] } };
  }
  return lostFoundOpen
    ? { slug: { notIn: [...retired] } }
    : { slug: { notIn: [...retired, LOST_FOUND_BOARD_SLUG] } };
}
