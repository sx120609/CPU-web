CREATE TABLE "RadioSemester" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RadioSemester_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RadioPlayTime" (
    "id" SERIAL NOT NULL,
    "semesterId" INTEGER,
    "name" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "location" TEXT,
    "note" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RadioPlayTime_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RadioScheduleItem" (
    "id" SERIAL NOT NULL,
    "semesterId" INTEGER,
    "playTimeId" INTEGER,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "hostNames" TEXT,
    "summary" TEXT,
    "coverImage" TEXT,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "requestEnabled" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RadioScheduleItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RadioSongRequest" (
    "id" SERIAL NOT NULL,
    "scheduleItemId" INTEGER,
    "requesterId" INTEGER,
    "nickname" TEXT NOT NULL,
    "contact" TEXT,
    "songTitle" TEXT NOT NULL,
    "artist" TEXT,
    "dedication" TEXT,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "adminNote" TEXT,
    "reviewedById" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RadioSongRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RadioSemester_code_key" ON "RadioSemester"("code");
CREATE INDEX "RadioSemester_status_isCurrent_idx" ON "RadioSemester"("status", "isCurrent");
CREATE INDEX "RadioSemester_createdById_idx" ON "RadioSemester"("createdById");

CREATE INDEX "RadioPlayTime_semesterId_weekday_sortOrder_idx" ON "RadioPlayTime"("semesterId", "weekday", "sortOrder");
CREATE INDEX "RadioPlayTime_enabled_weekday_sortOrder_idx" ON "RadioPlayTime"("enabled", "weekday", "sortOrder");
CREATE INDEX "RadioPlayTime_createdById_idx" ON "RadioPlayTime"("createdById");

CREATE INDEX "RadioScheduleItem_semesterId_status_sortOrder_idx" ON "RadioScheduleItem"("semesterId", "status", "sortOrder");
CREATE INDEX "RadioScheduleItem_playTimeId_status_sortOrder_idx" ON "RadioScheduleItem"("playTimeId", "status", "sortOrder");
CREATE INDEX "RadioScheduleItem_createdById_idx" ON "RadioScheduleItem"("createdById");

CREATE INDEX "RadioSongRequest_status_createdAt_idx" ON "RadioSongRequest"("status", "createdAt");
CREATE INDEX "RadioSongRequest_scheduleItemId_createdAt_idx" ON "RadioSongRequest"("scheduleItemId", "createdAt");
CREATE INDEX "RadioSongRequest_requesterId_createdAt_idx" ON "RadioSongRequest"("requesterId", "createdAt");

ALTER TABLE "RadioSemester" ADD CONSTRAINT "RadioSemester_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RadioPlayTime" ADD CONSTRAINT "RadioPlayTime_semesterId_fkey" FOREIGN KEY ("semesterId") REFERENCES "RadioSemester"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RadioPlayTime" ADD CONSTRAINT "RadioPlayTime_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RadioScheduleItem" ADD CONSTRAINT "RadioScheduleItem_semesterId_fkey" FOREIGN KEY ("semesterId") REFERENCES "RadioSemester"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RadioScheduleItem" ADD CONSTRAINT "RadioScheduleItem_playTimeId_fkey" FOREIGN KEY ("playTimeId") REFERENCES "RadioPlayTime"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RadioScheduleItem" ADD CONSTRAINT "RadioScheduleItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RadioSongRequest" ADD CONSTRAINT "RadioSongRequest_scheduleItemId_fkey" FOREIGN KEY ("scheduleItemId") REFERENCES "RadioScheduleItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RadioSongRequest" ADD CONSTRAINT "RadioSongRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RadioSongRequest" ADD CONSTRAINT "RadioSongRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
