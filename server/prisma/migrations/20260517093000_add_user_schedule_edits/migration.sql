-- CreateTable
CREATE TABLE "UserScheduleEdit" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "semester" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserScheduleEdit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "UserScheduleEdit_userId_semester_key" ON "UserScheduleEdit"("userId", "semester");

-- CreateIndex
CREATE INDEX "UserScheduleEdit_userId_updatedAt_idx" ON "UserScheduleEdit"("userId", "updatedAt");
