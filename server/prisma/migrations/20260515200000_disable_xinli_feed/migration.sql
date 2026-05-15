-- 业务决定：心理通知不再聚合，已抓取的内容也一并撤下
-- 顺序：先删 Topic（Reply/Like CASCADE）→ 删 SchoolFeedItem → 删 Board → 删 SchoolFeedSource
--
-- 注意：Board.feedSourceId 外键是 ON DELETE SET NULL，所以 Board 删除前不需要先解绑。

DELETE FROM "Topic" WHERE "boardId" IN (
  SELECT "id" FROM "Board" WHERE "slug" = 'xinli-notice'
);

DELETE FROM "SchoolFeedItem" WHERE "sourceId" IN (
  SELECT "id" FROM "SchoolFeedSource" WHERE "slug" = 'xinli-notice'
);

DELETE FROM "Board" WHERE "slug" = 'xinli-notice';

DELETE FROM "SchoolFeedSource" WHERE "slug" = 'xinli-notice';
