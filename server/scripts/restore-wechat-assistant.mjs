import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { fileURLToPath } from "node:url";

config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const prisma = new PrismaClient();

try {
  const updated = await prisma.$executeRaw`
    WITH marker AS (
      INSERT INTO "SiteSetting" ("key", "value", "updatedAt")
      VALUES ('migration.wechat.assistant-image-reply.v1', 'done', CURRENT_TIMESTAMP)
      ON CONFLICT ("key") DO NOTHING
      RETURNING 1
    )
    UPDATE "WechatServiceConfig"
    SET "assistantEnabled" = true,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "assistantEnabled" = false
      AND EXISTS (SELECT 1 FROM marker)
  `;
  console.log(`[wechat] assistant image reply restore updated ${updated} configuration(s)`);
} finally {
  await prisma.$disconnect();
}
