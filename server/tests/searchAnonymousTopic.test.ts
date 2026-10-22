import assert from "node:assert/strict";
import test from "node:test";
import { decodeTopicsForViewerForList } from "../src/services/forumPresentation";

// 站内搜索把缓存里的原始行交给 decodeTopicsForViewerForList，按查看者解码匿名作者
function searchRows() {
  return [
    {
      id: 101,
      title: "捞人",
      content: "有没有人见过",
      authorId: 7,
      metadata: "{}",
      isAnonymous: true,
      anonymousAlias: "把咖啡续满的白大褂",
      board: { slug: "treehole", name: "树洞", type: "normal" },
      author: { id: 7, nickname: "真实昵称", avatar: "/uploads/real.png", role: "user" },
      tags: [{ tag: { id: 1, name: "校园生活" } }],
    },
    {
      id: 102,
      title: "捞人启事",
      content: "公开发帖",
      authorId: 8,
      metadata: "{}",
      isAnonymous: false,
      anonymousAlias: null,
      board: { slug: "life", name: "生活", type: "normal" },
      author: { id: 8, nickname: "公开作者", avatar: null, role: "user" },
      tags: [],
    },
  ];
}

test("普通用户在搜索结果里拿不到匿名帖的真实作者", async () => {
  const [anonymous, open] = await decodeTopicsForViewerForList(searchRows(), { userId: 99, role: "user" });

  assert.equal(anonymous.authorId, null);
  assert.equal(anonymous.isAnonymous, true);
  assert.equal(anonymous.anonymousAlias, "把咖啡续满的白大褂");
  assert.equal(anonymous.author.id, null);
  assert.equal(anonymous.author.nickname, "把咖啡续满的白大褂");
  assert.equal(anonymous.author.avatar, null);
  assert.equal(anonymous.realAuthor, undefined);
  assert.equal(JSON.stringify(anonymous).includes("真实昵称"), false);
  assert.equal(JSON.stringify(anonymous).includes("/uploads/real.png"), false);
  assert.deepEqual(anonymous.tags, [{ id: 1, name: "校园生活" }]);

  assert.equal(open.authorId, 8);
  assert.equal(open.author.nickname, "公开作者");
  assert.equal(open.isAnonymous, false);
});

test("未登录访客同样只看到匿名别名", async () => {
  const [anonymous] = await decodeTopicsForViewerForList(searchRows(), undefined);
  assert.equal(anonymous.authorId, null);
  assert.equal(anonymous.author.nickname, "把咖啡续满的白大褂");
});

test("作者本人、管理员和版主在搜索结果里仍能看到真实作者", async () => {
  for (const viewer of [{ userId: 7, role: "user" }, { userId: 1, role: "admin" }, { userId: 2, role: "mod" }]) {
    const [anonymous] = await decodeTopicsForViewerForList(searchRows(), viewer);
    assert.equal(anonymous.authorId, 7);
    assert.equal(anonymous.author.nickname, "把咖啡续满的白大褂");
    assert.equal(anonymous.realAuthor?.nickname, "真实昵称");
  }
});
