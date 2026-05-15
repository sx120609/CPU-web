-- ============================================================
-- 站点功能开关（"言论敏感时一键下架"用）
-- ============================================================

-- CreateTable
CREATE TABLE "SiteSetting" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "SiteSetting_key_key" ON "SiteSetting"("key");

-- 插入三条默认开关：默认全开（保持现有上线行为），admin 可在后台随时关
INSERT OR IGNORE INTO "SiteSetting" ("key", "value", "updatedAt") VALUES
  ('feature.forum',        'on', CURRENT_TIMESTAMP),
  ('feature.market',       'on', CURRENT_TIMESTAMP),
  ('feature.coursereview', 'on', CURRENT_TIMESTAMP);
