import assert from "node:assert/strict";
import test from "node:test";
import {
  buildQqAddFriendLandingUrl,
  buildQqAddFriendUrl,
  normalizeQqId,
} from "../src/utils/qqContact";

test("QQ 号只保留数字", () => {
  assert.equal(normalizeQqId("QQ：123 456 789"), "123456789");
  assert.equal(normalizeQqId(undefined), "");
});

test("直接打开按钮继续生成 QQ 客户端协议", () => {
  assert.equal(
    buildQqAddFriendUrl("123456789"),
    "mqqapi://card/show_pslcard?src_type=internal&version=1&uin=123456789&card_type=person&source=sharecard",
  );
});

test("二维码编码同源 HTTPS 添加页而不是私有协议", () => {
  assert.equal(
    buildQqAddFriendLandingUrl("123456789", "https://cputime.cn"),
    "https://cputime.cn/qqbot-add-friend.html?uin=123456789",
  );
  assert.equal(buildQqAddFriendLandingUrl("", "https://cputime.cn"), "");
});
