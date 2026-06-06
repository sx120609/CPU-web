-- CreateTable
CREATE TABLE "WeiwallSyncConfig" (
    "id" SERIAL NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "baseUrl" TEXT NOT NULL DEFAULT 'https://s.weiwall.com',
    "schoolEn" TEXT NOT NULL DEFAULT 'cpu',
    "tenantId" INTEGER NOT NULL DEFAULT 7,
    "token" TEXT NOT NULL DEFAULT '',
    "intervalSeconds" INTEGER NOT NULL DEFAULT 120,
    "topicPages" INTEGER NOT NULL DEFAULT 3,
    "commentPageSize" INTEGER NOT NULL DEFAULT 20,
    "maxCommentPages" INTEGER NOT NULL DEFAULT 10,
    "maxReplyPages" INTEGER NOT NULL DEFAULT 10,
    "boardId" INTEGER,
    "lastRunAt" TIMESTAMP(3),
    "lastRunOk" BOOLEAN,
    "lastError" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeiwallSyncConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeiwallTopicMap" (
    "id" SERIAL NOT NULL,
    "externalTopicId" TEXT NOT NULL,
    "localTopicId" INTEGER NOT NULL,
    "externalAuthorKey" TEXT,
    "externalAuthorUuid" TEXT,
    "externalAuthorName" TEXT,
    "externalAuthorAvatar" TEXT,
    "externalCreatedAt" TIMESTAMP(3),
    "lastCommentCount" INTEGER NOT NULL DEFAULT 0,
    "lastLikeCount" INTEGER NOT NULL DEFAULT 0,
    "lastStatus" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeiwallTopicMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeiwallReplyMap" (
    "id" SERIAL NOT NULL,
    "externalReplyId" TEXT NOT NULL,
    "localReplyId" INTEGER NOT NULL,
    "externalTopicId" TEXT NOT NULL,
    "externalCommentId" TEXT,
    "parentExternalReplyId" TEXT,
    "externalAuthorUuid" TEXT,
    "externalAuthorName" TEXT,
    "externalAuthorAvatar" TEXT,
    "externalCreatedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeiwallReplyMap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeiwallSyncConfig_enabled_idx" ON "WeiwallSyncConfig"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "WeiwallTopicMap_externalTopicId_key" ON "WeiwallTopicMap"("externalTopicId");

-- CreateIndex
CREATE UNIQUE INDEX "WeiwallTopicMap_localTopicId_key" ON "WeiwallTopicMap"("localTopicId");

-- CreateIndex
CREATE INDEX "WeiwallTopicMap_lastSyncedAt_idx" ON "WeiwallTopicMap"("lastSyncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WeiwallReplyMap_externalReplyId_key" ON "WeiwallReplyMap"("externalReplyId");

-- CreateIndex
CREATE UNIQUE INDEX "WeiwallReplyMap_localReplyId_key" ON "WeiwallReplyMap"("localReplyId");

-- CreateIndex
CREATE INDEX "WeiwallReplyMap_externalTopicId_externalCreatedAt_idx" ON "WeiwallReplyMap"("externalTopicId", "externalCreatedAt");

-- AddForeignKey
ALTER TABLE "WeiwallSyncConfig" ADD CONSTRAINT "WeiwallSyncConfig_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeiwallTopicMap" ADD CONSTRAINT "WeiwallTopicMap_localTopicId_fkey" FOREIGN KEY ("localTopicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeiwallReplyMap" ADD CONSTRAINT "WeiwallReplyMap_localReplyId_fkey" FOREIGN KEY ("localReplyId") REFERENCES "Reply"("id") ON DELETE CASCADE ON UPDATE CASCADE;
