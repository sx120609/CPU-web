import assert from "node:assert/strict";
import test from "node:test";
import { normalizeInboundCommandText, parseQqGroupAdminCommand } from "../src/services/qqbot/commands";
import { parseMessageBindToken } from "../src/services/bindToken";

test("群管理员可通过 @成员命令移出广告过滤白名单", () => {
  assert.deepEqual(parseQqGroupAdminCommand("移出白名单 [CQ:at,qq=123456789]"), {
    type: "remove-ad-whitelist-user",
    argText: "[CQ:at,qq=123456789]",
  });
});

test("移除白名单命令兼容斜杠和常用别名", () => {
  assert.deepEqual(parseQqGroupAdminCommand("/取消白名单 123456789"), {
    type: "remove-ad-whitelist-user",
    argText: "123456789",
  });
});

test("结构化 @目标被省略出文本时仍识别无参数命令", () => {
  assert.deepEqual(parseQqGroupAdminCommand("移出白名单"), {
    type: "remove-ad-whitelist-user",
    argText: "",
  });
});

test("命令前带拾间 BOT 昵称时会先去掉前缀", () => {
  assert.deepEqual(parseQqGroupAdminCommand(normalizeInboundCommandText("@拾间BOT 移出白名单 123456789")), {
    type: "remove-ad-whitelist-user",
    argText: "123456789",
  });
});

test("QQ 绑定兼容完整命令、漏空格和只发绑定码", () => {
  assert.equal(parseMessageBindToken("绑定 A1b2C3d4"), "A1B2C3D4");
  assert.equal(parseMessageBindToken("绑定A1b2C3d4"), "A1B2C3D4");
  assert.equal(parseMessageBindToken("绑定码：A1b2C3d4"), "A1B2C3D4");
  assert.equal(parseMessageBindToken("A1b2C3d4"), "A1B2C3D4");
  assert.equal(parseMessageBindToken("绑定"), "");
  assert.equal(parseMessageBindToken("发帖 A1B2C3D4"), "");
});
