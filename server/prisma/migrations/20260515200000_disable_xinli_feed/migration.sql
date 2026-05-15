-- 心理通知爬虫禁用：业务不再聚合此源
UPDATE "SchoolFeedSource" SET "enabled" = 0 WHERE "slug" = 'xinli-notice';
