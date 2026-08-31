import { Errors } from "../utils/response";

export type HomeFeedStream = "all" | "forum" | "market";

export function parseHomeFeedStream(value: unknown): HomeFeedStream {
  const stream = String(value ?? "all").trim().toLowerCase();
  if (stream === "all" || stream === "forum" || stream === "market") return stream;
  throw Errors.badRequest("首页动态分流参数无效");
}

export function selectHomeFeedBoardTypes(boardTypes: string[], stream: HomeFeedStream) {
  const contentTypes = boardTypes.filter((type) => type !== "announce");
  if (stream === "forum") return contentTypes.filter((type) => type !== "market");
  if (stream === "market") return contentTypes.filter((type) => type === "market");
  return contentTypes;
}
