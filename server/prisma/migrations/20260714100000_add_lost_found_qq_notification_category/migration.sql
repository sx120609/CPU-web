-- New QQBot configurations include lost-and-found notifications by default.
ALTER TABLE "QqBotConfig"
ALTER COLUMN "notifyCategories"
SET DEFAULT '["reply","mention","like","system","service-tool","lost-found","school-feed"]';

-- Upgrade the previous default without overriding deliberately customized lists.
UPDATE "QqBotConfig"
SET "notifyCategories" = '["reply","mention","like","system","service-tool","lost-found","school-feed"]'
WHERE "notifyCategories" IN (
  '["reply","mention","like","system","service-tool","school-feed"]',
  '["reply","mention","like","system"]'
);
