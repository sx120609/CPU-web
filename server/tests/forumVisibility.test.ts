import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../src/prisma";
import { getFeatures, loadFeatures } from "../src/services/siteSettings";
import { ensureCanReadBoardType, resolveForumAccess } from "../src/services/forumAccess";
import { forumContentVisibilityWhere, forumSelfVisibleContentWhere, resolveForumListViewerId } from "../src/services/forumSubmission";

test("forum lists share the public cache unless the viewer has self-visible pending content", async () => {
  const lookups: unknown[] = [];
  const finder = (found: boolean) => async (where: unknown) => {
    lookups.push(where);
    return found ? { id: 1 } : null;
  };

  assert.equal(await resolveForumListViewerId(null, finder(true)), null);
  assert.equal(await resolveForumListViewerId(undefined, finder(true)), null);
  assert.equal(lookups.length, 0);

  assert.equal(await resolveForumListViewerId(42, finder(false)), null);
  assert.equal(await resolveForumListViewerId(42, finder(true)), 42);
  // 探测条件必须与可见性查询里“本人可见”的分支完全一致。
  assert.deepEqual(lookups, [forumSelfVisibleContentWhere(42), forumSelfVisibleContentWhere(42)]);
  assert.deepEqual((forumContentVisibilityWhere(42) as { OR: unknown[] }).OR[1], forumSelfVisibleContentWhere(42));
  assert.deepEqual(forumContentVisibilityWhere(await resolveForumListViewerId(42, finder(false))), forumContentVisibilityWhere(null));
});

test("forum login visibility blocks guest content and keeps AI entry independent", async () => {
  const original = prisma.siteSetting.findMany;
  let loginRequired = false;
  let assistantEntry = true;
  prisma.siteSetting.findMany = (async () => [
    { key: "forum.anonymous.policyVersion", value: "new-user-weekly-v2" },
    { key: "feature.forumLoginRequired", value: loginRequired ? "on" : "off" },
    { key: "feature.assistantEntry", value: assistantEntry ? "on" : "off" },
  ]) as typeof original;
  try {
    await loadFeatures();
    assert.equal(await resolveForumAccess(null), true);
    await ensureCanReadBoardType("normal", null);
    loginRequired = true;
    assistantEntry = false;
    await loadFeatures();
    assert.equal(getFeatures().assistantEntry, false);
    assert.equal(await resolveForumAccess(null), false);
    for (const type of ["normal", "question", "market", "coursereview"]) {
      await assert.rejects(ensureCanReadBoardType(type, null));
      await ensureCanReadBoardType(type, 1, "user");
    }
    await ensureCanReadBoardType("announce", null);
    assert.equal(await resolveForumAccess(1, "user"), true);
    assistantEntry = true;
    await loadFeatures();
    assert.equal(await resolveForumAccess(null), false);
    loginRequired = false;
    await loadFeatures();
    assert.equal(await resolveForumAccess(null), true);
  } finally {
    loginRequired = false;
    assistantEntry = true;
    await loadFeatures();
    prisma.siteSetting.findMany = original;
  }
});
