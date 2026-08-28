import assert from "node:assert/strict";
import test from "node:test";
import { buildVipRedemptionPath, generateVipGiftCode, hashVipGiftCode, normalizeVipGiftCode } from "../src/services/vipGiftCodes";
import { isVipActive } from "../src/services/vip";

test("VIP 礼品码生成结果可被规范化并稳定哈希", () => {
  const generated = generateVipGiftCode();
  assert.match(generated.code, /^CPUV-IP[A-Z0-9-]+$/);
  assert.equal(normalizeVipGiftCode(generated.code), generated.normalized);
  assert.equal(hashVipGiftCode(generated.normalized), generated.codeHash);
});

test("VIP 礼品码规范化会忽略大小写、空格和连接符", () => {
  assert.equal(normalizeVipGiftCode(" cpuv-ipab-cd23-ef45 "), "CPUVIPABCD23EF45");
  assert.equal(normalizeVipGiftCode("not valid!"), null);
});

test("VIP 兑换链接把完整礼品码保存在 URL 片段中", () => {
  const code = "CPUV-IPAB-CD23-EF45";
  const path = buildVipRedemptionPath(code);
  assert.equal(path, "/vip#redeem=CPUV-IPAB-CD23-EF45");
  const url = new URL(path, "https://example.test");
  assert.equal(new URLSearchParams(url.hash.slice(1)).get("redeem"), code);
  assert.equal(url.search, "");
});

test("VIP 身份只有永久开通和未开通两种状态", () => {
  assert.equal(isVipActive({ isVip: true }), true);
  assert.equal(isVipActive({ isVip: false }), false);
  assert.equal(isVipActive(null), false);
});
