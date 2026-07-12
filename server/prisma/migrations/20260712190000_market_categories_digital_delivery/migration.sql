-- Rename the user-facing board while preserving the existing /market route.
UPDATE "Board"
SET "name" = '商城', "description" = '实体商品 / 电子资料 / 校园好物'
WHERE "slug" = 'market';

-- Snapshot fulfillment data on both the listing and order. The encrypted
-- payload is never returned by the public item APIs.
ALTER TABLE "MarketItem"
  ADD COLUMN "deliveryType" TEXT NOT NULL DEFAULT 'physical',
  ADD COLUMN "digitalDeliveryEncrypted" TEXT;

ALTER TABLE "MarketOrder"
  ADD COLUMN "deliveryType" TEXT NOT NULL DEFAULT 'physical',
  ADD COLUMN "digitalDeliveryEncrypted" TEXT,
  ADD COLUMN "digitalDeliveredAt" TIMESTAMP(3);

CREATE TABLE "MarketCategory" (
  "id" SERIAL NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "icon" TEXT NOT NULL DEFAULT '📦',
  "description" TEXT NOT NULL DEFAULT '',
  "fulfillmentType" TEXT NOT NULL DEFAULT 'physical',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "sort" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MarketCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketCategory_slug_key" ON "MarketCategory"("slug");
CREATE INDEX "MarketCategory_enabled_sort_idx" ON "MarketCategory"("enabled", "sort");

INSERT INTO "MarketCategory" ("slug", "name", "icon", "description", "fulfillmentType", "enabled", "sort", "updatedAt") VALUES
  ('digital', '数码 3C', '💻', '手机、电脑、数码配件', 'physical', true, 10, CURRENT_TIMESTAMP),
  ('books', '教材书籍', '📚', '教材、课外书与纸质资料', 'physical', true, 20, CURRENT_TIMESTAMP),
  ('digital_goods', '电子资料', '📁', '电子书、原创笔记与数字文件', 'digital', true, 30, CURRENT_TIMESTAMP),
  ('dorm', '宿舍用品', '🛏️', '宿舍与日常生活用品', 'physical', true, 40, CURRENT_TIMESTAMP),
  ('appliance', '小家电', '🔌', '小型电器与配件', 'physical', true, 50, CURRENT_TIMESTAMP),
  ('fashion', '服饰鞋包', '👕', '服饰、鞋履与箱包', 'physical', true, 60, CURRENT_TIMESTAMP),
  ('sports', '运动户外', '🏸', '运动器材与户外用品', 'physical', true, 70, CURRENT_TIMESTAMP),
  ('tickets', '票务卡券', '🎫', '合规票券与校园卡券', 'physical', true, 80, CURRENT_TIMESTAMP),
  ('other', '其他商品', '📦', '未归入其他分类的商品', 'physical', true, 90, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

