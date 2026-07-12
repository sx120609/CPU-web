-- Ensure the marketplace can be used on production databases that were not created from the demo seed.
INSERT INTO "Board" (
  "slug", "name", "description", "icon", "color", "order", "type", "readOnly", "anonymousEnabled", "topicCount"
)
VALUES (
  'market', '商城', '实体商品 / 电子资料 / 校园好物', '🛒', '#168c78',
  COALESCE((SELECT MAX("order") + 1 FROM "Board"), 0), 'market', false, false, 0
)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "icon" = EXCLUDED."icon",
  "color" = EXCLUDED."color",
  "type" = 'market',
  "readOnly" = false;

INSERT INTO "SiteSetting" ("key", "value", "updatedAt")
VALUES ('feature.market', 'on', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
