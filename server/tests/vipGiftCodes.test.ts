import assert from "node:assert/strict";
import test from "node:test";
import { generateVipGiftCode, hashVipGiftCode, normalizeVipGiftCode } from "../src/services/vipGiftCodes";

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
