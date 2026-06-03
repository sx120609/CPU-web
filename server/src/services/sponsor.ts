import { prisma } from "../prisma";
import { runWithDistributedLock } from "./cache";
import { amountCentsToMoney, moneyToAmountCents } from "./epay";

const SPONSOR_CONFIG_KEY = "sponsor.config";
const SPONSOR_ORDER_EXPIRE_MS = 3 * 60 * 60 * 1000;
const SPONSOR_ORDER_EXPIRE_SWEEP_MS = 5 * 60 * 1000;
let sponsorOrderExpiryPollerStarted = false;

export type SponsorConfig = {
  title: string;
  description: string;
  presetAmounts: number[];
  minAmount: string;
  maxAmount: string;
  wallEnabled: boolean;
  allowMessage: boolean;
};

const DEFAULT_CONFIG: SponsorConfig = {
  title: "赞助本站",
  description: "赞助会通过易支付完成，成功后金额会展示在你的个人资料里。",
  presetAmounts: [5, 10, 20, 50],
  minAmount: "1.00",
  maxAmount: "9999.00",
  wallEnabled: true,
  allowMessage: true,
};

function clampCents(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizePresetAmounts(input: unknown, minCents: number, maxCents: number) {
  const raw = Array.isArray(input) ? input : DEFAULT_CONFIG.presetAmounts;
  const cents = Array.from(new Set(
    raw
      .map((item) => {
        try {
          return clampCents(moneyToAmountCents(item), minCents, maxCents);
        } catch {
          return 0;
        }
      })
      .filter((item) => item >= minCents && item <= maxCents)
  )).sort((a, b) => a - b);
  return (cents.length ? cents : DEFAULT_CONFIG.presetAmounts.map(moneyToAmountCents)).map((item) => Number(amountCentsToMoney(item)));
}

function normalizeConfig(input: Partial<SponsorConfig> | null | undefined): SponsorConfig {
  const raw = input ?? {};
  const minCents = clampCents(moneyToAmountCents(raw.minAmount ?? DEFAULT_CONFIG.minAmount), 1, 99999900);
  const maxCents = Math.max(
    minCents,
    clampCents(moneyToAmountCents(raw.maxAmount ?? DEFAULT_CONFIG.maxAmount), minCents, 99999900)
  );
  return {
    title: String(raw.title ?? DEFAULT_CONFIG.title).trim().slice(0, 40) || DEFAULT_CONFIG.title,
    description: String(raw.description ?? DEFAULT_CONFIG.description).trim().slice(0, 300) || DEFAULT_CONFIG.description,
    presetAmounts: normalizePresetAmounts(raw.presetAmounts, minCents, maxCents),
    minAmount: amountCentsToMoney(minCents),
    maxAmount: amountCentsToMoney(maxCents),
    wallEnabled: raw.wallEnabled ?? DEFAULT_CONFIG.wallEnabled,
    allowMessage: raw.allowMessage ?? DEFAULT_CONFIG.allowMessage,
  };
}

export async function getSponsorConfig() {
  const row = await prisma.siteSetting.findUnique({ where: { key: SPONSOR_CONFIG_KEY } });
  if (!row?.value) return { ...DEFAULT_CONFIG };
  try {
    return normalizeConfig(JSON.parse(row.value));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function updateSponsorConfig(input: Partial<SponsorConfig>) {
  const current = await getSponsorConfig();
  const next = normalizeConfig({ ...current, ...input });
  await prisma.siteSetting.upsert({
    where: { key: SPONSOR_CONFIG_KEY },
    update: { value: JSON.stringify(next) },
    create: { key: SPONSOR_CONFIG_KEY, value: JSON.stringify(next) },
  });
  return next;
}

export function sponsorConfigToCents(config: SponsorConfig) {
  return {
    minAmountCents: moneyToAmountCents(config.minAmount),
    maxAmountCents: moneyToAmountCents(config.maxAmount),
  };
}

export function calcSponsorOrderExpiresAt(base = new Date()) {
  return new Date(base.getTime() + SPONSOR_ORDER_EXPIRE_MS);
}

export function isSponsorOrderExpired(order: {
  status?: string | null;
  createdAt?: Date | null;
  expiresAt?: Date | null;
}, now = new Date()) {
  if (order.status !== "pending") return false;
  const expiresAt = order.expiresAt ?? (order.createdAt ? calcSponsorOrderExpiresAt(order.createdAt) : null);
  return Boolean(expiresAt && expiresAt.getTime() <= now.getTime());
}

export async function closeExpiredSponsorOrders(now = new Date()) {
  const fallbackCutoff = new Date(now.getTime() - SPONSOR_ORDER_EXPIRE_MS);
  const result = await prisma.sponsorOrder.updateMany({
    where: {
      status: "pending",
      OR: [
        { expiresAt: { lte: now } },
        {
          expiresAt: null,
          createdAt: { lte: fallbackCutoff },
        },
      ],
    },
    data: {
      status: "closed",
      closedAt: now,
    },
  });
  return result.count;
}

export async function closeExpiredSponsorOrderIfNeeded<T extends {
  id: number;
  status?: string | null;
  createdAt?: Date | null;
  expiresAt?: Date | null;
}>(order: T | null | undefined, now = new Date()) {
  if (!order || !isSponsorOrderExpired(order, now)) return order ?? null;
  return prisma.sponsorOrder.update({
    where: { id: order.id },
    data: {
      status: "closed",
      closedAt: now,
    },
  });
}

export function startSponsorOrderExpiryPoller() {
  if (sponsorOrderExpiryPollerStarted) return;
  sponsorOrderExpiryPollerStarted = true;
  const tick = () => {
    runWithDistributedLock("sponsor-order-expiry:tick", 4 * 60_000, async () => closeExpiredSponsorOrders()).catch((error) => {
      console.warn("[sponsor] close expired orders failed", error);
    });
  };
  setTimeout(tick, 5_000);
  setInterval(tick, SPONSOR_ORDER_EXPIRE_SWEEP_MS);
}

export function formatSponsorOrder(order: any) {
  return {
    id: order.id,
    outTradeNo: order.outTradeNo,
    tradeNo: order.tradeNo,
    payType: order.payType,
    amount: amountCentsToMoney(order.amountCents),
    amountCents: order.amountCents,
    message: order.message ?? "",
    displayMode: order.displayMode ?? "public",
    status: order.status,
    expiresAt: order.expiresAt,
    paidAt: order.paidAt,
    closedAt: order.closedAt,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    user: order.user ? {
      id: order.user.id,
      nickname: order.user.nickname,
      username: order.user.username,
      avatar: order.user.avatar,
    } : undefined,
  };
}

export function formatSponsorWallOrder(order: any) {
  const anonymous = order.displayMode === "anonymous";
  return {
    id: order.id,
    amount: amountCentsToMoney(order.amountCents),
    message: order.message ?? "",
    paidAt: order.paidAt,
    user: anonymous ? null : {
      id: order.user.id,
      nickname: order.user.nickname,
      avatar: order.user.avatar,
    },
    anonymous,
  };
}
