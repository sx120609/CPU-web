-- CreateTable
CREATE TABLE "FileCollectTemplate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "fields" TEXT NOT NULL DEFAULT '[]',
    "fileRules" TEXT NOT NULL DEFAULT '{}',
    "renameTemplate" TEXT NOT NULL DEFAULT '{name}-{student_id}',
    "expectedEntries" TEXT NOT NULL DEFAULT '',
    "createdById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FileCollectTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "FileCollectTemplate_createdById_idx" ON "FileCollectTemplate"("createdById");
