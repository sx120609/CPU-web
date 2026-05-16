-- 新增：研究生招生网通知源（首页聚合硕士/博士最新通知）
-- 幂等写法，兼容已部署数据库直接 migrate deploy。

INSERT OR IGNORE INTO "User" (
  "username", "passwordHash", "nickname", "role", "bio", "updatedAt"
) VALUES (
  'school-bot', '$$bot$$', '学校公告 🤖', 'bot', '我会自动同步学校官方公告', CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO "SchoolFeedSource" (
  "slug", "name", "homepage", "listUrl", "pageSize", "maxPages", "parser", "cronMinutes", "enabled", "botUserId"
)
SELECT
  'yjszs-notice',
  '研究生招生网通知',
  'https://yjszs.cpu.edu.cn/',
  'https://yjszs.cpu.edu.cn/',
  12,
  1,
  'school-cms-v1',
  20,
  true,
  "id"
FROM "User"
WHERE "username" = 'school-bot';

INSERT OR IGNORE INTO "Board" (
  "slug", "name", "description", "icon", "color", "order", "type", "readOnly", "feedSourceId"
)
SELECT
  "slug",
  "name",
  '自动同步自 https://yjszs.cpu.edu.cn/',
  '📢',
  '#1d4d8a',
  COALESCE((SELECT MAX("order") + 1 FROM "Board"), 0),
  'announce',
  true,
  "id"
FROM "SchoolFeedSource"
WHERE "slug" = 'yjszs-notice';
