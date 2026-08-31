import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { fileURLToPath } from "node:url";

config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const prisma = new PrismaClient();

async function readAudit() {
  const [row] = await prisma.$queryRaw`
    SELECT
      COUNT(DISTINCT sponsor."userId")::integer AS "paidSponsorUsers",
      COUNT(DISTINCT sponsor."userId") FILTER (WHERE account."isVip" = true)::integer AS "vipUsers",
      COUNT(DISTINCT sponsor."userId") FILTER (WHERE account."isVip" = false)::integer AS "missingVipUsers"
    FROM "SponsorOrder" sponsor
    INNER JOIN "User" account ON account."id" = sponsor."userId"
    WHERE sponsor."status" = 'paid'
  `;
  return row ?? { paidSponsorUsers: 0, vipUsers: 0, missingVipUsers: 0 };
}

try {
  const before = await readAudit();
  const updatedUsers = await prisma.$executeRaw`
    UPDATE "User" account
    SET "isVip" = true
    WHERE account."isVip" = false
      AND EXISTS (
        SELECT 1
        FROM "SponsorOrder" sponsor
        WHERE sponsor."userId" = account."id"
          AND sponsor."status" = 'paid'
      )
  `;
  const after = await readAudit();
  if (after.missingVipUsers !== 0) {
    throw new Error(`Sponsor VIP backfill incomplete: ${after.missingVipUsers} paid sponsor account(s) remain without VIP`);
  }
  console.log(JSON.stringify({ scope: "paid-sponsor-users", before, updatedUsers, after }));
} finally {
  await prisma.$disconnect();
}
