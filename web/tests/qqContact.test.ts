import assert from "node:assert/strict";
import test from "node:test";
import {
  buildQqAddFriendUrl,
  normalizeQqId,
} from "../src/utils/qqContact";

test("QQ 号只保留数字", () => {
  assert.equal(normalizeQqId("QQ：123 456 789"), "123456789");
  assert.equal(normalizeQqId(undefined), "");
});

test("二维码与按钮使用 QQ 官方添加联系人页面", () => {
  assert.equal(
    buildQqAddFriendUrl("123456789"),
    "https://qm.qq.com/cgi-bin/qm/qr?uin=123456789&Site=cputime.cn&Menu=yes",
  );
  assert.equal(buildQqAddFriendUrl(""), "");
});
