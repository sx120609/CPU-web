-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "email" TEXT,
    "avatar" TEXT,
    "bio" TEXT,
    "college" TEXT,
    "enrollYear" INTEGER,
    "role" TEXT NOT NULL DEFAULT 'user',
    "status" TEXT NOT NULL DEFAULT 'active',
    "postCount" INTEGER NOT NULL DEFAULT 0,
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "reputation" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Board" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "color" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "type" TEXT NOT NULL DEFAULT 'normal',
    "readOnly" BOOLEAN NOT NULL DEFAULT false,
    "topicCount" INTEGER NOT NULL DEFAULT 0,
    "feedSourceId" INTEGER,
    CONSTRAINT "Board_feedSourceId_fkey" FOREIGN KEY ("feedSourceId") REFERENCES "SchoolFeedSource" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "boardId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "lastReplyAt" DATETIME,
    "lastReplyById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Topic_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Topic_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Reply" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "topicId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "parentReplyId" INTEGER,
    "floor" INTEGER NOT NULL DEFAULT 0,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Reply_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Reply_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Reply_parentReplyId_fkey" FOREIGN KEY ("parentReplyId") REFERENCES "Reply" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Like" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "topicId" INTEGER,
    "replyId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Like_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Like_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Like_replyId_fkey" FOREIGN KEY ("replyId") REFERENCES "Reply" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "TopicTag" (
    "topicId" INTEGER NOT NULL,
    "tagId" INTEGER NOT NULL,

    PRIMARY KEY ("topicId", "tagId"),
    CONSTRAINT "TopicTag_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TopicTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Course" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "teacher" TEXT NOT NULL,
    "credits" REAL,
    "category" TEXT,
    "college" TEXT,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "avgDifficulty" REAL NOT NULL DEFAULT 0,
    "avgReward" REAL NOT NULL DEFAULT 0,
    "avgRecommend" REAL NOT NULL DEFAULT 0,
    "avgScore" REAL NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "CourseRating" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "topicId" INTEGER NOT NULL,
    "courseId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "difficulty" INTEGER NOT NULL,
    "reward" INTEGER NOT NULL,
    "recommend" INTEGER NOT NULL,
    "givingScore" INTEGER NOT NULL,
    "semester" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SchoolFeedSource" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "homepage" TEXT NOT NULL,
    "listUrl" TEXT NOT NULL,
    "pageSize" INTEGER NOT NULL DEFAULT 14,
    "maxPages" INTEGER NOT NULL DEFAULT 2,
    "parser" TEXT NOT NULL DEFAULT 'school-cms-v1',
    "cronMinutes" INTEGER NOT NULL DEFAULT 15,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "botUserId" INTEGER NOT NULL,
    "lastRunAt" DATETIME,
    "lastRunOk" BOOLEAN,
    "lastError" TEXT,
    CONSTRAINT "SchoolFeedSource_botUserId_fkey" FOREIGN KEY ("botUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SchoolFeedItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sourceId" INTEGER NOT NULL,
    "externalId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "publishedAt" DATETIME NOT NULL,
    "topicId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ServiceCard" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "icon" TEXT,
    "description" TEXT,
    "url" TEXT NOT NULL,
    "materials" TEXT,
    "duration" TEXT,
    "contact" TEXT,
    "needSso" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER,
    "category" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'normal',
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "link" TEXT,
    "source" TEXT,
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotificationRead" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "notificationId" INTEGER NOT NULL,
    "readAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NotificationRead_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MessageSetting" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "quietStart" TEXT NOT NULL DEFAULT '23:00',
    "quietEnd" TEXT NOT NULL DEFAULT '07:00',
    "subscribeReply" BOOLEAN NOT NULL DEFAULT true,
    "subscribeLike" BOOLEAN NOT NULL DEFAULT true,
    "subscribeSchool" BOOLEAN NOT NULL DEFAULT true,
    "subscribeSystem" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "MessageSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Board_slug_key" ON "Board"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Board_feedSourceId_key" ON "Board"("feedSourceId");

-- CreateIndex
CREATE INDEX "Board_order_idx" ON "Board"("order");

-- CreateIndex
CREATE INDEX "Topic_boardId_lastReplyAt_idx" ON "Topic"("boardId", "lastReplyAt");

-- CreateIndex
CREATE INDEX "Topic_authorId_idx" ON "Topic"("authorId");

-- CreateIndex
CREATE INDEX "Reply_topicId_floor_idx" ON "Reply"("topicId", "floor");

-- CreateIndex
CREATE UNIQUE INDEX "Like_userId_topicId_replyId_key" ON "Like"("userId", "topicId", "replyId");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Course_code_key" ON "Course"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CourseRating_topicId_key" ON "CourseRating"("topicId");

-- CreateIndex
CREATE INDEX "CourseRating_courseId_idx" ON "CourseRating"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolFeedSource_slug_key" ON "SchoolFeedSource"("slug");

-- CreateIndex
CREATE INDEX "SchoolFeedItem_sourceId_idx" ON "SchoolFeedItem"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolFeedItem_sourceId_externalId_key" ON "SchoolFeedItem"("sourceId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCard_code_key" ON "ServiceCard"("code");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationRead_userId_notificationId_key" ON "NotificationRead"("userId", "notificationId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageSetting_userId_key" ON "MessageSetting"("userId");
