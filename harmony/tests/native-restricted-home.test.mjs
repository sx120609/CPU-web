import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => readFileSync(`${repoRoot}${path}`, "utf8");

test("restricted native home remains useful without exposing forum content", () => {
  const mobileHome = read("web/src/views/HomeMobile.vue");
  assert.match(mobileHome, /:scope="showForumContent \? 'all' : 'services'"/u);
  assert.match(mobileHome, /label: "公告"[\s\S]*label: "失物"[\s\S]*label: "教务"[\s\S]*label: "服务"/u);
  assert.match(mobileHome, /v-if="!showForumContent" class="campus-services"/u);
  assert.match(mobileHome, /论坛仅限连接内网后使用/u);
  assert.match(mobileHome, /shouldHideNativeYaodaCanFly/u);
});

test("restricted native search requests and renders services only", () => {
  const searchPage = read("web/src/views/search/SiteSearch.vue");
  const searchRoute = read("server/src/routes/search.ts");
  assert.match(searchPage, /isNativeForumIntranetOnlyAccount\(auth\.user\?\.username\)/u);
  assert.match(searchPage, /!servicesOnly && result\?\.topics\.length/u);
  assert.match(searchPage, /!servicesOnly && result\?\.courses\.length/u);
  assert.match(searchRoute, /const servicesOnly = req\.query\.scope === "services"/u);
  assert.match(searchRoute, /servicesOnly \? Promise\.resolve\(\[\]\) : prisma\.topic\.findMany/u);
});

test("the installed iOS shell receives a non-compose home path", () => {
  const router = read("web/src/router/index.ts");
  const nativeChrome = read("ios_next/CpuTime/CpuTime/ShellTab.swift");
  assert.match(router, /path: "home\/services", name: "native-restricted-home"/u);
  assert.match(router, /to\.name === "home" && nativeForumRestricted/u);
  assert.match(nativeChrome, /return pathname == "\/home" \|\| pathname == "\/"/u);
  assert.doesNotMatch(nativeChrome, /pathname == "\/home\/services"/u);
});
