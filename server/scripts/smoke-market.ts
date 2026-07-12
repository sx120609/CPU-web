import assert from "node:assert/strict";
import { prisma } from "../src/prisma";
import { signToken } from "../src/utils/jwt";

const baseUrl = String(process.env.MARKET_SMOKE_URL || "http://127.0.0.1:3010/api").replace(/\/$/, "");

async function main() {
  const user = await prisma.user.findFirst({ where: { role: "admin", status: "active" }, orderBy: { id: "asc" } });
  assert(user, "需要一个可用的管理员账号运行商城冒烟测试");
  const token = signToken({ userId: user.id, studentId: user.username, role: user.role, campus: "" });
  let itemId = 0;
  let topicId = 0;
  const call = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init.headers || {}) },
    });
    const body = await response.json();
    assert.equal(response.ok, true, `${path}: HTTP ${response.status} ${body?.message || ""}`);
    assert.equal(body.code, 0, `${path}: ${body?.message || "接口失败"}`);
    return body.data;
  };

  try {
    const meta = await call("/market/meta");
    assert(Array.isArray(meta.categories));
    const created = await call("/market/items", {
      method: "POST",
      body: JSON.stringify({
        listingType: "sell", title: "商城自动化冒烟测试（会自动清理）", description: "验证商品发布、详情、收藏、我的交易和后台接口。",
        category: "other", price: "1.23", negotiable: true, condition: "good", tradeMode: "meetup", campus: "SIP", location: "测试地点", images: [], draft: true,
      }),
    });
    itemId = created.id;
    topicId = created.topicId;
    assert.equal(created.status, "draft");
    assert.equal(created.price, "1.23");
    const detail = await call(`/market/items/${itemId}`);
    assert.equal(detail.id, itemId);
    const updated = await call(`/market/items/${itemId}`, { method: "PATCH", body: JSON.stringify({ title: "商城冒烟测试已更新" }) });
    assert.equal(updated.title, "商城冒烟测试已更新");
    const favorite = await call(`/market/items/${itemId}/favorite`, { method: "POST" });
    assert.equal(favorite.favorited, true);
    const mine = await call("/market/mine");
    assert(mine.selling.some((item: { id: number }) => item.id === itemId));
    assert(Array.isArray(mine.sellerOffers));
    const admin = await call("/market/admin/overview");
    assert(admin.counts && Array.isArray(admin.orders));
    await call(`/market/items/${itemId}`, { method: "DELETE" });
    console.log(JSON.stringify({ ok: true, checks: ["meta", "create", "detail", "update", "favorite", "mine", "admin", "withdraw"] }));
  } finally {
    if (itemId) await prisma.marketItem.delete({ where: { id: itemId } }).catch(() => null);
    if (topicId) await prisma.topic.delete({ where: { id: topicId } }).catch(() => null);
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

