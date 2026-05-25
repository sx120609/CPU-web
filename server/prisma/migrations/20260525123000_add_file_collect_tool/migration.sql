-- CreateTable
CREATE TABLE "FileCollectTask" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "fields" TEXT NOT NULL DEFAULT '[]',
    "fileRules" TEXT NOT NULL DEFAULT '{}',
    "renameTemplate" TEXT NOT NULL DEFAULT '{name}-{student_id}',
    "expectedEntries" TEXT NOT NULL DEFAULT '',
    "submissionCount" INTEGER NOT NULL DEFAULT 0,
    "fileCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" INTEGER,
    "publishedAt" DATETIME,
    "closedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FileCollectTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FileCollectSubmission" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "taskId" INTEGER NOT NULL,
    "submitterId" INTEGER,
    "identity" TEXT NOT NULL DEFAULT '',
    "data" TEXT NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FileCollectSubmission_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "FileCollectTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FileCollectSubmission_submitterId_fkey" FOREIGN KEY ("submitterId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FileCollectFile" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "submissionId" INTEGER NOT NULL,
    "originalName" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FileCollectFile_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "FileCollectSubmission" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "FileCollectTask_slug_key" ON "FileCollectTask"("slug");

-- CreateIndex
CREATE INDEX "FileCollectTask_status_idx" ON "FileCollectTask"("status");

-- CreateIndex
CREATE INDEX "FileCollectTask_createdById_idx" ON "FileCollectTask"("createdById");

-- CreateIndex
CREATE INDEX "FileCollectSubmission_taskId_createdAt_idx" ON "FileCollectSubmission"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "FileCollectSubmission_submitterId_idx" ON "FileCollectSubmission"("submitterId");

-- CreateIndex
CREATE INDEX "FileCollectSubmission_identity_idx" ON "FileCollectSubmission"("identity");

-- CreateIndex
CREATE INDEX "FileCollectFile_submissionId_idx" ON "FileCollectFile"("submissionId");
