-- CreateTable
CREATE TABLE "ToolPermission" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "toolCode" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'manager',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ToolPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Questionnaire" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "toolCode" TEXT NOT NULL DEFAULT 'questionnaire',
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "allowAnonymous" BOOLEAN NOT NULL DEFAULT true,
    "oneResponsePerUser" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "fields" TEXT NOT NULL DEFAULT '[]',
    "createdById" INTEGER,
    "publishedAt" DATETIME,
    "closedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Questionnaire_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuestionnaireResponse" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "questionnaireId" INTEGER NOT NULL,
    "respondentId" INTEGER,
    "answers" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuestionnaireResponse_questionnaireId_fkey" FOREIGN KEY ("questionnaireId") REFERENCES "Questionnaire" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuestionnaireResponse_respondentId_fkey" FOREIGN KEY ("respondentId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ToolPermission_toolCode_userId_key" ON "ToolPermission"("toolCode", "userId");

-- CreateIndex
CREATE INDEX "ToolPermission_toolCode_idx" ON "ToolPermission"("toolCode");

-- CreateIndex
CREATE INDEX "ToolPermission_userId_idx" ON "ToolPermission"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Questionnaire_slug_key" ON "Questionnaire"("slug");

-- CreateIndex
CREATE INDEX "Questionnaire_toolCode_status_idx" ON "Questionnaire"("toolCode", "status");

-- CreateIndex
CREATE INDEX "Questionnaire_createdById_idx" ON "Questionnaire"("createdById");

-- CreateIndex
CREATE INDEX "QuestionnaireResponse_questionnaireId_createdAt_idx" ON "QuestionnaireResponse"("questionnaireId", "createdAt");

-- CreateIndex
CREATE INDEX "QuestionnaireResponse_respondentId_idx" ON "QuestionnaireResponse"("respondentId");
