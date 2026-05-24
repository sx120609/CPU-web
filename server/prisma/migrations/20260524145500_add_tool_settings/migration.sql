-- CreateTable
CREATE TABLE "ToolSetting" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "toolCode" TEXT NOT NULL,
    "requireLogin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ToolSetting_toolCode_key" ON "ToolSetting"("toolCode");

-- CreateIndex
CREATE INDEX "ToolSetting_requireLogin_idx" ON "ToolSetting"("requireLogin");
