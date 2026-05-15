-- 已有的功能开关 SiteSetting 表中追加 electric 一项（默认 on）
INSERT OR IGNORE INTO "SiteSetting" ("key", "value", "updatedAt") VALUES
  ('feature.electric', 'on', CURRENT_TIMESTAMP);
