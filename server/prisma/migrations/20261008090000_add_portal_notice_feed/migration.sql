-- 融合门户资讯聚合：部门板块、需要登录态的同步源、用户的公告部门选择
ALTER TABLE "Board" ADD COLUMN "feedDepartment" TEXT;
ALTER TABLE "Board" ADD COLUMN "announceDefault" BOOLEAN NOT NULL DEFAULT true;
CREATE UNIQUE INDEX "Board_feedDepartment_key" ON "Board"("feedDepartment");

ALTER TABLE "SchoolFeedSource" ADD COLUMN "sessionUserId" INTEGER;
ALTER TABLE "SchoolFeedSource" ADD COLUMN "sessionToken" TEXT;
ALTER TABLE "SchoolFeedSource" ADD COLUMN "sessionBoundAt" TIMESTAMP(3);

CREATE TABLE "AnnouncementPreference" (
    "userId" INTEGER NOT NULL,
    "include" TEXT NOT NULL DEFAULT '[]',
    "exclude" TEXT NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnnouncementPreference_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "AnnouncementPreference" ADD CONSTRAINT "AnnouncementPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
