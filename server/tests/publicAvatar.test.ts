import assert from "node:assert/strict";
import test from "node:test";
import {
  compactTopicAuthors,
  decodeDataAvatar,
  publicAvatarValue,
} from "../src/utils/publicAvatar";

const DATA_AVATAR = "data:image/png;base64,aGVsbG8=";

test("inline avatars are replaced with immutable resource URLs", () => {
  const url = publicAvatarValue({ id: 7, avatar: DATA_AVATAR });
  assert.match(String(url), /^\/api\/user-avatars\/7\?v=[a-f0-9]{16}$/);
  assert.equal(publicAvatarValue({ id: 7, avatar: "https://example.com/avatar.png" }), "https://example.com/avatar.png");
});

test("data avatar decoder preserves mime type and bytes", () => {
  const decoded = decodeDataAvatar(DATA_AVATAR);
  assert.equal(decoded?.contentType, "image/png");
  assert.equal(decoded?.data.toString("utf8"), "hello");
});

test("topic cache compaction avoids storing repeated inline avatars", () => {
  const source = [{ id: 1, author: { id: 7, avatar: DATA_AVATAR, nickname: "测试" } }];
  const compacted = compactTopicAuthors(source);
  assert.match(compacted[0].author.avatar, /^\/api\/user-avatars\/7\?v=/);
  assert.equal(source[0].author.avatar, DATA_AVATAR);
});
