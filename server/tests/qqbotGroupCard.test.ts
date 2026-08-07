import test from "node:test";
import assert from "node:assert/strict";
import { containsQqGroupCard } from "../src/services/qqbot/groupCard";

test("detects OneBot contact group cards", () => {
  assert.equal(containsQqGroupCard({ type: "contact", data: { type: "group", id: "160469167" } }), true);
  assert.equal(containsQqGroupCard({ type: "contact", data: { type: "qq", id: "10001" } }), false);
});

test("detects explicit raw card payloads without blocking normal shares", () => {
  assert.equal(containsQqGroupCard("[CQ:json,data={group_card:true,group_id:160469167}]"), true);
  assert.equal(containsQqGroupCard({ type: "json", data: { title: "课程通知", group_id: "160469167" } }), false);
});

test("walks nested message payloads", () => {
  assert.equal(containsQqGroupCard({ data: { content: [{ type: "contact", data: { scene: "group", id: "1" } }] } }), true);
  assert.equal(containsQqGroupCard("普通文字"), false);
});
