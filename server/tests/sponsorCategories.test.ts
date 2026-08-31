import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSponsorPaidUserUpdate,
  buildSponsorCategoryStats,
  formatSponsorOrder,
  isSponsorCategoryAccepting,
  normalizeSponsorCategories,
  normalizeSponsorConfig,
} from "../src/services/sponsor";

test("paid sponsorship permanently enables VIP while adding its amount", () => {
  assert.deepEqual(buildSponsorPaidUserUpdate(1250), {
    isVip: true,
    sponsorTotalCents: { increment: 1250 },
  });
});

test("default sponsor config includes the featured App Store campaign", () => {
  const config = normalizeSponsorConfig({});
  const campaign = config.categories.find((category) => category.id === "app-store-2026");

  assert.ok(campaign);
  assert.equal(campaign.title, "App Store 首年上架计划");
  assert.equal(campaign.goalAmount, "750.00");
  assert.equal(campaign.deadline, "2026-09-30");
  assert.equal(campaign.featured, true);
});

test("sponsor categories normalize stable ids and keep one featured category", () => {
  const categories = normalizeSponsorCategories([
    {
      id: "APP-STORE-2026",
      title: " App Store 计划 ",
      description: " 首年费用 ",
      goalAmount: 750,
      deadline: "2026-09-30",
      enabled: true,
      featured: true,
    },
    {
      id: "general",
      title: "长期支持",
      description: "",
      goalAmount: null,
      deadline: null,
      enabled: true,
      featured: true,
    },
  ]);

  assert.deepEqual(categories.map((category) => category.id), ["app-store-2026", "general"]);
  assert.equal(categories[0].goalAmount, "750.00");
  assert.equal(categories[0].featured, true);
  assert.equal(categories[1].featured, false);
});

test("sponsor category closes after its configured deadline", () => {
  const category = normalizeSponsorCategories([{
    id: "campaign",
    title: "限时计划",
    description: "",
    goalAmount: "100.00",
    deadline: "2026-09-30",
    enabled: true,
    featured: false,
  }])[0];

  assert.equal(isSponsorCategoryAccepting(category, new Date("2026-09-30T15:59:59.999Z")), true);
  assert.equal(isSponsorCategoryAccepting(category, new Date("2026-09-30T16:00:00.000Z")), false);
});

test("sponsor category stats calculate the public fundraising progress", () => {
  const category = normalizeSponsorCategories([{
    id: "app-store-2026",
    title: "App Store 首年上架计划",
    description: "",
    goalAmount: "750.00",
    deadline: "2026-09-30",
    enabled: true,
    featured: true,
  }])[0];
  const stats = buildSponsorCategoryStats(category, 37500, 8, 6, new Date("2026-08-30T00:00:00.000Z"));

  assert.equal(stats.raisedAmount, "375.00");
  assert.equal(stats.progressPercent, 50);
  assert.equal(stats.paidOrderCount, 8);
  assert.equal(stats.supporterCount, 6);
  assert.equal(stats.goalReached, false);
  assert.equal(stats.accepting, true);
});

test("formatted sponsor orders preserve category snapshots and legacy fallback", () => {
  const current = formatSponsorOrder({
    id: 1,
    outTradeNo: "SP1",
    payType: "alipay",
    amountCents: 1000,
    categoryId: "app-store-2026",
    categoryTitle: "App Store 首年上架计划",
    status: "paid",
  });
  const legacy = formatSponsorOrder({
    id: 2,
    outTradeNo: "SP2",
    payType: "wxpay",
    amountCents: 500,
    status: "paid",
  });

  assert.equal(current.categoryId, "app-store-2026");
  assert.equal(current.categoryTitle, "App Store 首年上架计划");
  assert.equal(legacy.categoryId, "general");
  assert.equal(legacy.categoryTitle, "支持药大拾间");
});
