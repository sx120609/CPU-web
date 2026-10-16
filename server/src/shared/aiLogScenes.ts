// AI 调用日志里的全部场景。写日志的服务端和后台的筛选下拉共用这一份：
// 新加一种场景只在这里登记，日志类型和两处筛选就都有了，不会再出现日志里有、筛选里没有的场景。
export const AI_LOG_SCENES = [
  { value: "campus-assistant", label: "拾间 AI 对话" },
  { value: "learning-answer", label: "学习通 AI 解题" },
  { value: "smart-post", label: "智慧发帖" },
  { value: "forum-ai-answer", label: "论坛 AI 参考回答" },
  { value: "topic", label: "帖子审核" },
  { value: "reply", label: "回复审核" },
  { value: "topic-edit", label: "编辑相似度" },
  { value: "direct-message", label: "私信审核" },
  { value: "nickname", label: "昵称审核" },
  { value: "profile", label: "公开资料审核" },
  { value: "image", label: "图片审核" },
  { value: "video", label: "视频审核" },
  { value: "song-review", label: "药苑之声歌曲审核" },
  { value: "qqbot-group-ad", label: "QQ群广告过滤" },
] as const;

export type AiLogScene = (typeof AI_LOG_SCENES)[number]["value"];

/** 不认识的场景原样显示它的标识，旧日志和以后新加的场景不会变成空白。 */
export function aiLogSceneLabel(kind: string | null | undefined) {
  return AI_LOG_SCENES.find((item) => item.value === kind)?.label || kind || "未知场景";
}

/**
 * 筛选下拉的选项：登记过的场景，加上数据里出现过但没登记的。
 * `present` 是当前这页日志里的场景。
 */
export function aiLogSceneOptions(present: Array<string | null | undefined> = []): Array<{ value: string; label: string }> {
  const known = new Set<string>(AI_LOG_SCENES.map((item) => item.value));
  const extra = [...new Set(present.filter((kind): kind is string => Boolean(kind) && !known.has(kind as string)))];
  return [...AI_LOG_SCENES, ...extra.map((kind) => ({ value: kind, label: kind }))];
}
