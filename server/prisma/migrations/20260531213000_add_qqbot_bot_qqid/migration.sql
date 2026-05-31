-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_QqBotConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "botQqId" TEXT NOT NULL DEFAULT '',
    "napcatBaseUrl" TEXT NOT NULL DEFAULT '',
    "accessToken" TEXT NOT NULL DEFAULT '',
    "webhookSecret" TEXT NOT NULL DEFAULT '',
    "defaultBoardSlug" TEXT NOT NULL DEFAULT 'general',
    "allowPrivatePost" BOOLEAN NOT NULL DEFAULT true,
    "allowGroupPost" BOOLEAN NOT NULL DEFAULT false,
    "notificationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "notifyCategories" TEXT NOT NULL DEFAULT '["reply","mention","like","system"]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_QqBotConfig" ("accessToken", "allowGroupPost", "allowPrivatePost", "createdAt", "defaultBoardSlug", "enabled", "id", "napcatBaseUrl", "notificationEnabled", "notifyCategories", "updatedAt", "webhookSecret")
SELECT "accessToken", "allowGroupPost", "allowPrivatePost", "createdAt", "defaultBoardSlug", "enabled", "id", "napcatBaseUrl", "notificationEnabled", "notifyCategories", "updatedAt", "webhookSecret" FROM "QqBotConfig";
DROP TABLE "QqBotConfig";
ALTER TABLE "new_QqBotConfig" RENAME TO "QqBotConfig";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
