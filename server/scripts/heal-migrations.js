#!/usr/bin/env node
/**
 * Prisma migration 自愈脚本
 *
 * 触发场景：旧部署机用过 `prisma db push` 或 `prisma migrate dev`
 * 自己生成过 init migration，之后从 git 拉到标准化的 migrations，
 * 于是出现：
 *   - P3009：上次 migration 失败的记录卡住后续
 *   - P3018：CREATE TABLE 撞到已存在的表
 *   - "N migrations found"：磁盘上比 git 多/少
 *
 * 用法（在 server/ 目录下）：
 *   node scripts/heal-migrations.js
 *
 * 它会：
 *   1. 删除磁盘上遗留的、git 不维护的 migration 目录及其 DB 记录
 *   2. 对每条 git 来的 migration，按"DB 现状是否已生效"决定 resolve --applied / --rolled-back
 *   3. 跑 npx prisma migrate deploy 完成剩余 migration
 *
 * 新增 migration 时：把目录名 + 判断函数加进 KNOWN_MIGRATIONS 数组。
 */
const { PrismaClient } = require("@prisma/client");
const { readdirSync, existsSync, rmSync } = require("fs");
const { execSync } = require("child_process");
const path = require("path");

const MIG_DIR = "prisma/migrations";

// 已纳入 git 的 migration 列表 + 每条对应"是否在 DB 中实际生效"的判断
// 判断函数签名：(tables: Set<string>, userCols: Set<string>) => boolean
const KNOWN_MIGRATIONS = [
  {
    name: "20260514142818_forum_init",
    test: (tables) => tables.has("User") && tables.has("Topic"),
  },
  {
    name: "20260514182016_add_student_sso",
    test: (_tables, userCols) => userCols.has("studentSso"),
  },
  {
    name: "20260514190351_add_user_course",
    test: (tables) => tables.has("UserCourse"),
  },
  {
    name: "20260515090000_add_teachers",
    test: (tables) => tables.has("Teacher") && tables.has("CourseTeacher"),
  },
];
const KNOWN_NAMES = new Set(KNOWN_MIGRATIONS.map((m) => m.name));

function sh(cmd) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

async function inspect() {
  const p = new PrismaClient();
  try {
    const tableRows = await p.$queryRawUnsafe(
      "SELECT name FROM sqlite_master WHERE type='table'"
    );
    const tables = new Set(tableRows.map((r) => r.name));
    const userCols = tables.has("User")
      ? new Set(
          (await p.$queryRawUnsafe("PRAGMA table_info(User)")).map(
            (c) => c.name
          )
        )
      : new Set();
    const records = tables.has("_prisma_migrations")
      ? await p.$queryRawUnsafe(
          "SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations"
        )
      : [];
    return { tables, userCols, records };
  } finally {
    await p.$disconnect();
  }
}

async function deleteStaleRecord(name) {
  const p = new PrismaClient();
  try {
    // migration_name 来自我们自己枚举的目录名，含义已知；为防御性仍做单引号转义
    const safe = name.replace(/'/g, "''");
    await p.$executeRawUnsafe(
      `DELETE FROM _prisma_migrations WHERE migration_name = '${safe}'`
    );
  } finally {
    await p.$disconnect();
  }
}

(async () => {
  if (!existsSync(MIG_DIR)) {
    console.error(`[heal] 未找到 ${MIG_DIR}，请在 server/ 目录下运行此脚本`);
    process.exit(1);
  }

  const { tables, userCols, records } = await inspect();
  const recordsByName = new Map(records.map((r) => [r.migration_name, r]));

  console.log(`[heal] DB 中已存在 ${tables.size} 张表`);
  console.log(
    `[heal] User 表列: ${[...userCols].join(", ") || "(不存在)"}`
  );
  console.log(`[heal] _prisma_migrations 记录: ${records.length} 条`);

  // 1) 清理遗留目录（git 不维护的）
  const onDisk = readdirSync(MIG_DIR).filter((n) =>
    existsSync(path.join(MIG_DIR, n, "migration.sql"))
  );
  for (const name of onDisk) {
    if (!KNOWN_NAMES.has(name)) {
      console.log(`[heal] 删除遗留 migration 目录: ${name}`);
      rmSync(path.join(MIG_DIR, name), { recursive: true, force: true });
      if (recordsByName.has(name)) {
        await deleteStaleRecord(name);
        console.log(`        及其 _prisma_migrations 记录`);
      }
    }
  }

  // 2) 逐条处理 known migrations
  for (const m of KNOWN_MIGRATIONS) {
    const rec = recordsByName.get(m.name);
    const applied = m.test(tables, userCols);

    if (rec && rec.finished_at && !rec.rolled_back_at) {
      console.log(`[heal] ${m.name}: 已正常 applied，跳过`);
      continue;
    }
    if (applied) {
      console.log(`[heal] ${m.name}: DB 现状显示已生效，标记 applied`);
      sh(`npx prisma migrate resolve --applied ${m.name}`);
    } else if (rec && !rec.finished_at) {
      console.log(
        `[heal] ${m.name}: 记录失败但 DB 未生效，标记 rolled-back（后续 deploy 重试）`
      );
      sh(`npx prisma migrate resolve --rolled-back ${m.name}`);
    } else {
      console.log(`[heal] ${m.name}: 未应用，留给 migrate deploy 执行`);
    }
  }

  // 3) 应用剩余 migration
  console.log("\n[heal] 应用剩余 migration ...");
  sh("npx prisma migrate deploy");

  console.log("\n[heal] ✅ 完成");
})().catch((e) => {
  console.error("\n[heal] ❌ 失败:", e?.message || e);
  process.exit(1);
});
