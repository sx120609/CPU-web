import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { fileURLToPath } from "node:url";

config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const prisma = new PrismaClient();

// 已删除账号保留已支付订单仅用于对账，不再计入赞助 VIP。
async function readAudit(client = prisma) {
  const [row] = await client.$queryRaw`
    SELECT
      COUNT(DISTINCT sponsor."userId")::integer AS "paidSponsorUsers",
      COUNT(DISTINCT sponsor."userId") FILTER (WHERE account."isVip" = true)::integer AS "vipUsers",
      COUNT(DISTINCT sponsor."userId") FILTER (WHERE account."isVip" = false)::integer AS "missingVipUsers"
    FROM "SponsorOrder" sponsor
    INNER JOIN "User" account ON account."id" = sponsor."userId"
    WHERE sponsor."status" = 'paid'
      AND account."status" <> 'deleted'
  `;
  return row ?? { paidSponsorUsers: 0, vipUsers: 0, missingVipUsers: 0 };
}

try {
  // 每次执行都修复：已删除账号的 VIP 字段与账号删除流程的清理结果保持一致。
  const revokedDeletedUsers = await prisma.$executeRaw`
    UPDATE "User"
    SET "isVip" = false, "vipLevel" = 0, "vipExpiresAt" = NULL
    WHERE "status" = 'deleted'
      AND ("isVip" = true OR "vipLevel" <> 0 OR "vipExpiresAt" IS NOT NULL)
  `;
  const before = await readAudit();
  // 支付回调和后台补单都会直接授予 VIP；历史补发只执行一次，之后不再覆盖人工撤销。
  const { granted, updatedUsers } = await prisma.$transaction(async (tx) => {
    const marker = await tx.$queryRaw`
      INSERT INTO "SiteSetting" ("key", "value", "updatedAt")
      VALUES ('migration.vip.sponsor-backfill.v1', 'done', CURRENT_TIMESTAMP)
      ON CONFLICT ("key") DO NOTHING
      RETURNING 1
    `;
    if (!marker.length) return { granted: false, updatedUsers: 0 };
    const updatedUsers = await tx.$executeRaw`
      UPDATE "User" account
      SET "isVip" = true
      WHERE account."isVip" = false
        AND account."status" <> 'deleted'
        AND EXISTS (
          SELECT 1
          FROM "SponsorOrder" sponsor
          WHERE sponsor."userId" = account."id"
            AND sponsor."status" = 'paid'
        )
    `;
    const audit = await readAudit(tx);
    if (audit.missingVipUsers !== 0) {
      throw new Error(`Sponsor VIP backfill incomplete: ${audit.missingVipUsers} paid sponsor account(s) remain without VIP`);
    }
    return { granted: true, updatedUsers };
  }, { timeout: 60_000 });
  const after = await readAudit();
  console.log(JSON.stringify({ scope: "paid-sponsor-users", granted, before, updatedUsers, revokedDeletedUsers, after }));
} finally {
  await prisma.$disconnect();
}
