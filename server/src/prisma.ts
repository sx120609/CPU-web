import { PrismaClient } from "@prisma/client";
import { isDev } from "./config";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isDev ? ["warn", "error"] : ["error"],
  });

if (isDev) globalForPrisma.prisma = prisma;
