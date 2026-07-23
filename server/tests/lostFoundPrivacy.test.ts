import test from "node:test";
import assert from "node:assert/strict";
import {
  canViewLostFoundRaw,
  maskLostFoundSensitiveText,
  sanitizeLostFoundItemFields,
  sanitizeLostFoundTopicFields,
} from "../src/services/lostFoundPrivacy";

test("lost-found masking covers common identifiers without changing dates and rooms", () => {
  const source = [
    "姓名：王小明",
    "学号 2020250892",
    "手机 13812345678",
    "身份证 320102200001011234",
    "邮箱 student@example.com",
    "时间 2026-07-23，地点 B311",
  ].join("；");

  assert.equal(
    maskLostFoundSensitiveText(source),
    "姓名：王*明；学号 2020****92；手机 138****5678；身份证 320***********1234；邮箱 s***@example.com；时间 2026-07-23，地点 B311",
  );
});

test("lost-found masking is idempotent for values that already contain stars", () => {
  const masked = "姓名：王*明；学号 2020****92；手机 138****5678；身份证 320***********1234";
  assert.equal(maskLostFoundSensitiveText(masked), masked);
});

test("lost-found public item fields are masked while authorized viewers keep raw values", () => {
  const item = {
    itemName: "校园卡 2020250892",
    description: "联系人：王小明，电话 13812345678",
    location: "B311",
    storageLocation: "江宁校区学生事务大厅",
    publisherDepartment: "校学生会",
    remark: "身份证 320102200001011234",
  };

  assert.match(sanitizeLostFoundItemFields(item, false).description, /王\*明.*138\*{4}5678/);
  assert.equal(sanitizeLostFoundItemFields(item, true).description, item.description);
  assert.equal(canViewLostFoundRaw({ userId: 7 }, 7), true);
  assert.equal(canViewLostFoundRaw({ lostFoundRole: "admin" }, 7), true);
  assert.equal(canViewLostFoundRaw({ lostFoundRole: "super_admin" }, 7), true);
  assert.equal(canViewLostFoundRaw({ userId: 8, role: "user" }, 7), false);
});

test("lost-found forum topics expose raw data only to publisher or administrators", () => {
  const topic = {
    id: 10,
    authorId: 7,
    title: "捡到｜校园卡 2020250892",
    content: "联系人：王小明，手机 13812345678",
    metadata: JSON.stringify({
      lostFoundItem: true,
      location: "B311",
      remark: "身份证 320102200001011234",
    }),
  };

  const publicTopic = sanitizeLostFoundTopicFields(topic);
  assert.equal(publicTopic.title, "捡到｜校园卡 2020****92");
  assert.match(publicTopic.content, /王\*明.*138\*{4}5678/);
  assert.match(String(publicTopic.metadata), /320\*{11}1234/);

  assert.equal(sanitizeLostFoundTopicFields(topic, { userId: 7 }).content, topic.content);
  assert.equal(sanitizeLostFoundTopicFields(topic, { lostFoundRole: "admin" }).content, topic.content);
  assert.equal(sanitizeLostFoundTopicFields(topic, { role: "admin" }).content, topic.content);
});
