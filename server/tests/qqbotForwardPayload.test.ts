import assert from "node:assert/strict";
import test from "node:test";
import {
  extractForwardNodeId,
  extractReplyMessageId,
  readQqForwardMessagesFromActionPayload,
} from "../src/services/qqbot/messageRendering";

const nodes = [
  {
    sender: { user_id: 10001, nickname: "测试用户" },
    message: [{ type: "text", data: { text: "合并转发正文" } }],
  },
];

test("reads standard OneBot data.messages forward responses", () => {
  assert.deepEqual(readQqForwardMessagesFromActionPayload({ data: { messages: nodes } }), nodes);
});

test("reads NapCat data.message and data.content forward responses", () => {
  assert.deepEqual(readQqForwardMessagesFromActionPayload({ data: { message: nodes } }), nodes);
  assert.deepEqual(readQqForwardMessagesFromActionPayload({ data: { content: nodes } }), nodes);
});

test("reads adapters that return the forward node list directly in data", () => {
  assert.deepEqual(readQqForwardMessagesFromActionPayload({ data: nodes }), nodes);
});

test("recognizes raw CQ forward and reply references", () => {
  assert.equal(extractForwardNodeId("[CQ:forward,id=forward-123]"), "forward-123");
  assert.equal(extractReplyMessageId("[CQ:reply,id=456] [CQ:at,qq=789] 我要投稿"), "456");
});
