import assert from "node:assert/strict";
import test from "node:test";
import type { SchoolInfo } from "../src/api/site";
import { isSchoolPathEnabled, isSchoolToolEnabled, schoolModuleForPath } from "../src/utils/schoolModules";

const school: SchoolInfo = {
  id: "demo",
  name: "Demo",
  shortName: "Demo",
  brandName: "Demo",
  modules: ["forum", "campus3d"],
  pages: [
    { prefix: "/forum", module: "forum" },
    { prefix: "/forum/b/market", module: "market" },
    { prefix: "/services/tools/yaoda-can-fly", module: "games" },
    { prefix: "/services/tools/yaoda-can-fly/campus-3d", module: "campus3d" },
    { prefix: "/treehole", module: "treehole" },
  ],
  tools: [{ slug: "treehole", module: "treehole" }, { slug: "campus_3d", module: "campus3d" }],
};

test("the longest matching page prefix decides which feature owns a path", () => {
  assert.equal(schoolModuleForPath(school, "/forum/b/market"), "market");
  assert.equal(schoolModuleForPath(school, "/forum/b/general"), "forum");
  assert.equal(schoolModuleForPath(school, "/services/tools/yaoda-can-fly/campus-3d?view=1"), "campus3d");
  assert.equal(schoolModuleForPath(school, "/forumx"), null);
  assert.equal(schoolModuleForPath(school, "https://example.com/forum"), null);
});

test("pages and tool cards of switched-off features are hidden, everything else stays", () => {
  assert.equal(isSchoolPathEnabled(school, "/forum/topic/1"), true);
  assert.equal(isSchoolPathEnabled(school, "/forum/b/market"), false);
  assert.equal(isSchoolPathEnabled(school, "/services/tools/yaoda-can-fly"), false);
  assert.equal(isSchoolPathEnabled(school, "/services/tools/yaoda-can-fly/campus-3d"), true);
  assert.equal(isSchoolPathEnabled(school, "/treehole/new"), false);
  assert.equal(isSchoolPathEnabled(school, "/profile"), true);
  assert.equal(isSchoolPathEnabled(null, "/treehole"), true);
  assert.equal(isSchoolToolEnabled(school, "treehole"), false);
  assert.equal(isSchoolToolEnabled(school, "campus_3d"), true);
  assert.equal(isSchoolToolEnabled(school, "pdf_tools"), true);
});
