ALTER TABLE "QqBotGroup" ADD COLUMN "notifyCategories" TEXT NOT NULL DEFAULT '["system","school-feed"]';
ALTER TABLE "QqBotGroup" ADD COLUMN "notifyAudiences" TEXT NOT NULL DEFAULT '["public"]';
