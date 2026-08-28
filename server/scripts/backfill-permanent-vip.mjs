import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { fileURLToPath } from "node:url";

config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const prisma = new PrismaClient();

try {
  const updated = await prisma.$executeRaw`
    WITH marker AS (
      INSERT INTO "SiteSetting" ("key", "value", "updatedAt")
      VALUES ('migration.vip.permanent-backfill.v1', 'done', CURRENT_TIMESTAMP)
      ON CONFLICT ("key") DO NOTHING
      RETURNING 1
    )
    UPDATE "User"
    SET "isVip" = true
    WHERE "vipLevel" > 0
      AND "isVip" = false
      AND EXISTS (SELECT 1 FROM marker)
  `;
  console.log(`[vip] permanent membership backfill updated ${updated} account(s)`);
} finally {
  await prisma.$disconnect();
}
