ALTER TABLE "QqBotConfig" ADD COLUMN "superAdminQqIds" TEXT NOT NULL DEFAULT '[]';

ALTER TABLE "QqBotGroup" ADD COLUMN "adFilterEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "QqBotGroup" ADD COLUMN "joinReviewEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "QqBotGroup" ADD COLUMN "allowMute" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "QqBotGroup" ADD COLUMN "allowKick" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "QqBotGroup" ADD COLUMN "allowKickAndBlock" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "QqBotGroup" ADD COLUMN "commandUserQqIds" TEXT NOT NULL DEFAULT '[]';

CREATE TABLE "QqBotGroupJoinRequest" (
  "id" SERIAL NOT NULL,
  "groupId" TEXT NOT NULL,
  "qqId" TEXT NOT NULL,
  "nickname" TEXT,
  "comment" TEXT,
  "flag" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "handledAction" TEXT,
  "handledByQqId" TEXT,
  "rawPayload" TEXT NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "handledAt" TIMESTAMP(3),

  CONSTRAINT "QqBotGroupJoinRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QqBotGroupJoinRequest_flag_key" ON "QqBotGroupJoinRequest"("flag");
CREATE INDEX "QqBotGroupJoinRequest_groupId_status_createdAt_idx" ON "QqBotGroupJoinRequest"("groupId", "status", "createdAt");
CREATE INDEX "QqBotGroupJoinRequest_qqId_status_createdAt_idx" ON "QqBotGroupJoinRequest"("qqId", "status", "createdAt");
