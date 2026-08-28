import { createHash, randomInt } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";

const GIFT_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const GIFT_CODE_BODY_LENGTH = 16;

export function normalizeVipGiftCode(value: unknown) {
  const normalized = String(value ?? "").trim().toUpperCase().replace(/[\s-]/g, "");
  if (!normalized || normalized.length < 12 || normalized.length > 32 || !/^[A-Z0-9]+$/.test(normalized)) {
    return null;
  }
  return normalized;
}

export function hashVipGiftCode(normalized: string) {
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

function formatGiftCode(normalized: string) {
  const chunks = normalized.match(/.{1,4}/g) ?? [normalized];
  return chunks.join("-");
}

export function generateVipGiftCode() {
  const body = Array.from({ length: GIFT_CODE_BODY_LENGTH }, () => GIFT_CODE_ALPHABET[randomInt(GIFT_CODE_ALPHABET.length)]).join("");
  const normalized = `CPUVIP${body}`;
  const code = formatGiftCode(normalized);
  return {
    code,
    normalized,
    codeHash: hashVipGiftCode(normalized),
    codePreview: `${code.slice(0, 13)}…${code.slice(-4)}`,
  };
}

export function buildVipRedemptionPath(code: string) {
  return `/vip#redeem=${encodeURIComponent(code)}`;
}

export async function redeemVipGiftCode(userId: number, rawCode: unknown) {
  const normalized = normalizeVipGiftCode(rawCode);
  if (!normalized) throw Errors.badRequest("礼品码格式不正确");
  const codeHash = hashVipGiftCode(normalized);

  try {
    return await prisma.$transaction(async (tx) => {
      const giftCode = await tx.vipGiftCode.findUnique({ where: { codeHash } });
      if (!giftCode || !giftCode.enabled) throw Errors.badRequest("礼品码无效或已停用");
      if (giftCode.usedCount >= giftCode.maxUses) throw Errors.conflict("礼品码已达到使用次数上限");

      const currentRedemption = await tx.vipGiftCodeRedemption.findUnique({
        where: { giftCodeId_userId: { giftCodeId: giftCode.id, userId } },
      });
      if (currentRedemption) throw Errors.conflict("你已经兑换过该礼品码");

      const activated = await tx.user.updateMany({
        where: { id: userId, isVip: false },
        // Keep the old boolean-like columns synchronized during the rolling
        // migration window; new code reads only isVip.
        data: { isVip: true, vipLevel: 1, vipExpiresAt: null },
      });
      if (activated.count !== 1) {
        const current = await tx.user.findUnique({ where: { id: userId }, select: { isVip: true } });
        if (!current) throw Errors.notFound("用户不存在");
        throw Errors.conflict("你的 VIP 已经永久生效，无需重复兑换");
      }

      const claimed = await tx.vipGiftCode.updateMany({
        where: { id: giftCode.id, enabled: true, usedCount: { lt: giftCode.maxUses } },
        data: { usedCount: { increment: 1 } },
      });
      if (claimed.count !== 1) throw Errors.conflict("礼品码刚刚被兑换完，请更换其他礼品码");

      await tx.vipGiftCodeRedemption.create({
        data: {
          giftCodeId: giftCode.id,
          userId,
        },
      });

      return {
        codePreview: giftCode.codePreview,
        vipActive: true,
        permanent: true,
      };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw Errors.conflict("你已经兑换过该礼品码");
    }
    throw error;
  }
}
