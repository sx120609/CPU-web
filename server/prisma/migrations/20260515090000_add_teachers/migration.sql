-- ============================================================
-- 引入"多老师"模型：
--   * 新增 Teacher 表（一个老师一条记录，name 唯一）
--   * 新增 CourseTeacher 关联表（多对多）
--   * CourseRating 增加 nullable courseTeacherId 外键
--   * 数据迁移：把现有 Course.teacher 字符串拆分到 Teacher / CourseTeacher
--
-- Course.teacher 字段暂时保留（兼容旧代码），后续单独 PR 移除。
-- ============================================================

-- CreateTable
CREATE TABLE "Teacher" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "college" TEXT,
    "createdById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Teacher_name_key" ON "Teacher"("name");

-- CreateTable
CREATE TABLE "CourseTeacher" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "courseId" INTEGER NOT NULL,
    "teacherId" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'user-add',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CourseTeacher_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CourseTeacher_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CourseTeacher_courseId_teacherId_key" ON "CourseTeacher"("courseId", "teacherId");

-- CreateIndex
CREATE INDEX "CourseTeacher_courseId_idx" ON "CourseTeacher"("courseId");

-- CreateIndex
CREATE INDEX "CourseTeacher_teacherId_idx" ON "CourseTeacher"("teacherId");

-- RedefineTables: 给 CourseRating 加 courseTeacherId 列并建外键
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CourseRating" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "topicId" INTEGER NOT NULL,
    "courseId" INTEGER NOT NULL,
    "courseTeacherId" INTEGER,
    "authorId" INTEGER NOT NULL,
    "difficulty" INTEGER NOT NULL,
    "reward" INTEGER NOT NULL,
    "recommend" INTEGER NOT NULL,
    "givingScore" INTEGER NOT NULL,
    "semester" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CourseRating_courseTeacherId_fkey" FOREIGN KEY ("courseTeacherId") REFERENCES "CourseTeacher" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_CourseRating" ("id", "topicId", "courseId", "authorId", "difficulty", "reward", "recommend", "givingScore", "semester", "createdAt")
  SELECT "id", "topicId", "courseId", "authorId", "difficulty", "reward", "recommend", "givingScore", "semester", "createdAt" FROM "CourseRating";
DROP TABLE "CourseRating";
ALTER TABLE "new_CourseRating" RENAME TO "CourseRating";
CREATE UNIQUE INDEX "CourseRating_topicId_key" ON "CourseRating"("topicId");
CREATE INDEX "CourseRating_courseId_idx" ON "CourseRating"("courseId");
CREATE INDEX "CourseRating_courseTeacherId_idx" ON "CourseRating"("courseTeacherId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- ============================================================
-- 数据迁移：把 Course.teacher 中的多老师字符串拆分到 Teacher + CourseTeacher
--
-- 分隔符：、 / ; ,  （不拆空格——避免把英文名 "Anna Lee" 错拆）
-- 处理顺序：
--   1) 用 replace 将所有分隔符统一成 ','
--   2) 递归 CTE 按 ',' 切分
--   3) 去 trim、去空，结果作为唯一 (courseId, name) 集合
--   4) INSERT OR IGNORE 进 Teacher（按 name 去重）
--   5) INSERT OR IGNORE 进 CourseTeacher（按 (courseId, teacherId) 去重）
-- ============================================================

-- 临时视图：拆分后的 (courseId, name)
-- 使用临时表存中间结果，避免 INSERT...SELECT 中 CTE 重复书写出错
CREATE TEMPORARY TABLE "_split_teachers" (
    "courseId" INTEGER NOT NULL,
    "name" TEXT NOT NULL
);

INSERT INTO "_split_teachers" ("courseId", "name")
WITH RECURSIVE
  norm AS (
    SELECT
      "id" AS courseId,
      replace(replace(replace("teacher", '、', ','), '/', ','), ';', ',') || ',' AS t
    FROM "Course"
    WHERE "teacher" IS NOT NULL AND trim("teacher") <> ''
  ),
  split(courseId, name, rest) AS (
    SELECT courseId, '', t FROM norm
    UNION ALL
    SELECT
      courseId,
      trim(substr(rest, 1, instr(rest, ',') - 1)),
      substr(rest, instr(rest, ',') + 1)
    FROM split
    WHERE rest <> '' AND instr(rest, ',') > 0
  )
SELECT courseId, name FROM split WHERE name <> '';

-- 4) 唯一老师写入 Teacher
INSERT OR IGNORE INTO "Teacher" ("name", "createdAt")
SELECT DISTINCT "name", CURRENT_TIMESTAMP FROM "_split_teachers";

-- 5) 建立 CourseTeacher 关联
INSERT OR IGNORE INTO "CourseTeacher" ("courseId", "teacherId", "source", "createdAt")
SELECT s."courseId", t."id", 'backfill', CURRENT_TIMESTAMP
FROM "_split_teachers" s
JOIN "Teacher" t ON t."name" = s."name";

DROP TABLE "_split_teachers";
