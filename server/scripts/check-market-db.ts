import { prisma } from "../src/prisma";

async function main() {
  const [items, active, reserved, sold, orders, payments, users, epay] = await Promise.all([
    prisma.marketItem.count(),
    prisma.marketItem.count({ where: { status: "active" } }),
    prisma.marketItem.count({ where: { status: "reserved" } }),
    prisma.marketItem.count({ where: { status: "sold" } }),
    prisma.marketOrder.count(),
    prisma.marketPaymentLog.count(),
    prisma.user.count(),
    prisma.epayConfig.findUnique({ where: { id: 1 }, select: { enabled: true, gatewayUrl: true, pid: true, merchantKey: true, enabledTypes: true } }),
  ]);
  console.log(JSON.stringify({
    items, active, reserved, sold, orders, payments, users,
    epay: {
      exists: Boolean(epay),
      enabled: Boolean(epay?.enabled),
      gatewayConfigured: Boolean(epay?.gatewayUrl),
      pidConfigured: Boolean(epay?.pid),
      keyConfigured: Boolean(epay?.merchantKey),
      enabledTypes: epay?.enabledTypes || "[]",
    },
  }));
}

main().finally(() => prisma.$disconnect());

