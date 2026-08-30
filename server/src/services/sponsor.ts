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
  assistantPointsPerYuan: number;
  categories: SponsorCategoryConfig[];
};

export type SponsorCategoryConfig = {
  id: string;
  title: string;
  description: string;
  goalAmount: string | null;
  deadline: string | null;
  enabled: boolean;
  featured: boolean;
};

export type SponsorCategory = SponsorCategoryConfig & {
  raisedAmount: string;
  raisedAmountCents: number;
  paidOrderCount: number;
  supporterCount: number;
  progressPercent: number | null;
  goalReached: boolean;
  accepting: boolean;
};

const DEFAULT_CATEGORIES: SponsorCategoryConfig[] = [
  {
    id: "app-store-2026",
    title: "App Store 首年上架计划",
    description: "用于 2026 年 Apple Developer Program 与 App Store 首年上架相关费用。",
    goalAmount: "750.00",
    deadline: "2026-09-30",
    enabled: true,
    featured: true,
  },
  {
    id: "general",
    title: "支持药大拾间",
    description: "用于服务器、校园服务与长期维护。",
    goalAmount: null,
    deadline: null,
    enabled: true,
    featured: false,
  },
];

const DEFAULT_CONFIG: SponsorConfig = {
  title: "赞助本站",
  description: "赞助会通过易支付完成，成功后金额会展示在你的个人资料里。",
  presetAmounts: [5, 10, 20, 50],
  minAmount: "1.00",
  maxAmount: "9999.00",
  wallEnabled: true,
  allowMessage: true,
  assistantPointsPerYuan: 1,
  categories: DEFAULT_CATEGORIES,
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

function normalizeGoalAmount(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  try {
    const cents = moneyToAmountCents(value as string | number);
    return cents > 0 ? amountCentsToMoney(cents) : null;
  } catch {
    return null;
  }
}

function normalizeDeadline(value: unknown) {
  const deadline = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return null;
  const parsed = new Date(`${deadline}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === deadline ? deadline : null;
}

export function normalizeSponsorCategories(input: unknown): SponsorCategoryConfig[] {
  const source = Array.isArray(input) && input.length ? input : DEFAULT_CATEGORIES;
  const seen = new Set<string>();
  const categories: SponsorCategoryConfig[] = [];
  let featuredAssigned = false;

  for (const item of source.slice(0, 12)) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Partial<SponsorCategoryConfig>;
    const id = String(raw.id ?? "").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id) || seen.has(id)) continue;
    const title = String(raw.title ?? "").trim().slice(0, 40);
    if (!title) continue;
    const featured = Boolean(raw.featured) && !featuredAssigned;
    if (featured) featuredAssigned = true;
    seen.add(id);
    categories.push({
      id,
      title,
      description: String(raw.description ?? "").trim().slice(0, 200),
      goalAmount: normalizeGoalAmount(raw.goalAmount),
      deadline: normalizeDeadline(raw.deadline),
      enabled: raw.enabled !== false,
      featured,
    });
  }

  return categories.length ? categories : DEFAULT_CATEGORIES.map((item) => ({ ...item }));
}

export function normalizeSponsorConfig(input: Partial<SponsorConfig> | null | undefined): SponsorConfig {
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
    assistantPointsPerYuan: Math.max(
      0,
      Math.min(10000, Math.floor(Number(raw.assistantPointsPerYuan ?? DEFAULT_CONFIG.assistantPointsPerYuan) || 0)),
    ),
    categories: normalizeSponsorCategories(raw.categories),
  };
}

export async function getSponsorConfig() {
  const row = await prisma.siteSetting.findUnique({ where: { key: SPONSOR_CONFIG_KEY } });
  if (!row?.value) return normalizeSponsorConfig(DEFAULT_CONFIG);
  try {
    return normalizeSponsorConfig(JSON.parse(row.value));
  } catch {
    return normalizeSponsorConfig(DEFAULT_CONFIG);
  }
}

export async function updateSponsorConfig(input: Partial<SponsorConfig>) {
  const current = await getSponsorConfig();
  const next = normalizeSponsorConfig({ ...current, ...input });
  await prisma.siteSetting.upsert({
    where: { key: SPONSOR_CONFIG_KEY },
    update: { value: JSON.stringify(next) },
    create: { key: SPONSOR_CONFIG_KEY, value: JSON.stringify(next) },
  });
  return next;
}

export function isSponsorCategoryAccepting(category: SponsorCategoryConfig, now = new Date()) {
  if (!category.enabled) return false;
  if (!category.deadline) return true;
  const deadline = new Date(`${category.deadline}T23:59:59.999+08:00`);
  return !Number.isNaN(deadline.getTime()) && now.getTime() <= deadline.getTime();
}

export function buildSponsorCategoryStats(
  category: SponsorCategoryConfig,
  raisedAmountCents: number,
  paidOrderCount: number,
  supporterCount: number,
  now = new Date(),
): SponsorCategory {
  const goalAmountCents = category.goalAmount ? moneyToAmountCents(category.goalAmount) : 0;
  return {
    ...category,
    raisedAmount: amountCentsToMoney(raisedAmountCents),
    raisedAmountCents,
    paidOrderCount,
    supporterCount,
    progressPercent: goalAmountCents > 0 ? Math.min(100, Math.round((raisedAmountCents / goalAmountCents) * 1000) / 10) : null,
    goalReached: goalAmountCents > 0 && raisedAmountCents >= goalAmountCents,
    accepting: isSponsorCategoryAccepting(category, now),
  };
}

export async function getSponsorCategoriesWithStats(config?: SponsorConfig, now = new Date()): Promise<SponsorCategory[]> {
  const sponsorConfig = config ?? await getSponsorConfig();
  const [totals, supporters] = await Promise.all([
    prisma.sponsorOrder.groupBy({
      by: ["categoryId"],
      where: { status: "paid" },
      _sum: { amountCents: true },
      _count: { _all: true },
    }),
    prisma.sponsorOrder.findMany({
      where: { status: "paid" },
      distinct: ["categoryId", "userId"],
      select: { categoryId: true, userId: true },
    }),
  ]);
  const supporterCounts = new Map<string, number>();
  for (const row of supporters) {
    supporterCounts.set(row.categoryId, (supporterCounts.get(row.categoryId) ?? 0) + 1);
  }
  const totalByCategory = new Map(totals.map((row) => [row.categoryId, row]));

  return sponsorConfig.categories.map((category) => {
    const total = totalByCategory.get(category.id);
    const raisedAmountCents = total?._sum.amountCents ?? 0;
    return buildSponsorCategoryStats(
      category,
      raisedAmountCents,
      total?._count._all ?? 0,
      supporterCounts.get(category.id) ?? 0,
      now,
    );
  });
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
    categoryId: order.categoryId ?? "general",
    categoryTitle: order.categoryTitle ?? "支持药大拾间",
    assistantPointsAwarded: order.assistantPointsAwarded ?? 0,
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
    categoryId: order.categoryId ?? "general",
    categoryTitle: order.categoryTitle ?? "支持药大拾间",
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
