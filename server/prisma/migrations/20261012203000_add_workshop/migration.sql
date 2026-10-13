-- CreateTable
CREATE TABLE "WorkshopWork" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "authorId" INTEGER NOT NULL,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "publishedVersionId" TEXT,
    "runtimeRevision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkshopWork_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkshopVersion" (
    "id" TEXT NOT NULL,
    "workId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "files" JSONB NOT NULL,
    "packageKey" TEXT NOT NULL,
    "totalBytes" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "runtimeRevision" INTEGER NOT NULL DEFAULT 0,
    "reviewReason" TEXT,
    "reviewerId" INTEGER,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkshopVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkshopFavorite" (
    "workId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkshopFavorite_pkey" PRIMARY KEY ("workId","userId")
);

-- CreateTable
CREATE TABLE "WorkshopReport" (
    "id" TEXT NOT NULL,
    "workId" TEXT NOT NULL,
    "reporterId" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkshopReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkshopSave" (
    "workId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "bytes" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkshopSave_pkey" PRIMARY KEY ("workId","userId")
);

-- CreateTable
CREATE TABLE "WorkshopAudit" (
    "id" TEXT NOT NULL,
    "workId" TEXT NOT NULL,
    "versionId" TEXT,
    "actorId" INTEGER,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkshopAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkshopWork_slug_key" ON "WorkshopWork"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "WorkshopWork_publishedVersionId_key" ON "WorkshopWork"("publishedVersionId");

-- CreateIndex
CREATE INDEX "WorkshopWork_authorId_updatedAt_idx" ON "WorkshopWork"("authorId", "updatedAt");

-- CreateIndex
CREATE INDEX "WorkshopWork_disabled_updatedAt_idx" ON "WorkshopWork"("disabled", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkshopVersion_packageKey_key" ON "WorkshopVersion"("packageKey");

-- CreateIndex
CREATE INDEX "WorkshopVersion_status_submittedAt_idx" ON "WorkshopVersion"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "WorkshopVersion_workId_createdAt_idx" ON "WorkshopVersion"("workId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkshopVersion_workId_version_key" ON "WorkshopVersion"("workId", "version");

-- CreateIndex
CREATE INDEX "WorkshopFavorite_userId_createdAt_idx" ON "WorkshopFavorite"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkshopReport_workId_createdAt_idx" ON "WorkshopReport"("workId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkshopReport_reporterId_createdAt_idx" ON "WorkshopReport"("reporterId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkshopSave_userId_updatedAt_idx" ON "WorkshopSave"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "WorkshopAudit_workId_createdAt_idx" ON "WorkshopAudit"("workId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkshopAudit_versionId_createdAt_idx" ON "WorkshopAudit"("versionId", "createdAt");

-- AddForeignKey
ALTER TABLE "WorkshopWork" ADD CONSTRAINT "WorkshopWork_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopWork" ADD CONSTRAINT "WorkshopWork_publishedVersionId_fkey" FOREIGN KEY ("publishedVersionId") REFERENCES "WorkshopVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopVersion" ADD CONSTRAINT "WorkshopVersion_workId_fkey" FOREIGN KEY ("workId") REFERENCES "WorkshopWork"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopVersion" ADD CONSTRAINT "WorkshopVersion_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopFavorite" ADD CONSTRAINT "WorkshopFavorite_workId_fkey" FOREIGN KEY ("workId") REFERENCES "WorkshopWork"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopFavorite" ADD CONSTRAINT "WorkshopFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopReport" ADD CONSTRAINT "WorkshopReport_workId_fkey" FOREIGN KEY ("workId") REFERENCES "WorkshopWork"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopReport" ADD CONSTRAINT "WorkshopReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopSave" ADD CONSTRAINT "WorkshopSave_workId_fkey" FOREIGN KEY ("workId") REFERENCES "WorkshopWork"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopSave" ADD CONSTRAINT "WorkshopSave_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopAudit" ADD CONSTRAINT "WorkshopAudit_workId_fkey" FOREIGN KEY ("workId") REFERENCES "WorkshopWork"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopAudit" ADD CONSTRAINT "WorkshopAudit_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "WorkshopVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopAudit" ADD CONSTRAINT "WorkshopAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
