-- CreateTable
CREATE TABLE "GradeCheckTable" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "studentIdColumn" TEXT NOT NULL DEFAULT '学号',
    "columns" TEXT NOT NULL DEFAULT '[]',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" INTEGER,
    "publishedAt" DATETIME,
    "closedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GradeCheckTable_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GradeCheckRow" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tableId" INTEGER NOT NULL,
    "studentId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GradeCheckRow_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "GradeCheckTable" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "GradeCheckTable_slug_key" ON "GradeCheckTable"("slug");

-- CreateIndex
CREATE INDEX "GradeCheckTable_status_idx" ON "GradeCheckTable"("status");

-- CreateIndex
CREATE INDEX "GradeCheckTable_createdById_idx" ON "GradeCheckTable"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "GradeCheckRow_tableId_studentId_key" ON "GradeCheckRow"("tableId", "studentId");

-- CreateIndex
CREATE INDEX "GradeCheckRow_studentId_idx" ON "GradeCheckRow"("studentId");
