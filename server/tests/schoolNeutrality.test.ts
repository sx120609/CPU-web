import assert from "node:assert/strict";
import test from "node:test";
import { schoolManifest } from "../src/services/schoolManifest";
import { assistantSchoolOf, campusAssistantGroundingText, listCampusAssistantKnowledgeEntries } from "../src/services/campusAssistant";
import { getSchool } from "../src/schools/registry";

test("添加到主屏幕的 manifest 换成所选学校的品牌，其余字段不动", () => {
  const template = { name: "药大拾间", short_name: "药大拾间", description: "x", start_url: "/schedule", icons: [{ src: "/icon.png" }] };
  const manifest = schoolManifest(template, getSchool("njucm"));
  assert.equal(manifest.name, "南中医拾间");
  assert.equal(manifest.short_name, "南中医拾间");
  assert.match(manifest.description, /南京中医药大学/u);
  assert.equal(manifest.start_url, "/schedule");
  assert.deepEqual(manifest.icons, template.icons);
});

test("拾间AI 的站内资料：讲药大校区、电话、系统入口的条目不给别的学校", () => {
  const actions = ["home", "services", "jwxt", "profile", "schedule", "school-calendar", "unified-auth"];
  const cpu = listCampusAssistantKnowledgeEntries(actions, assistantSchoolOf({ schoolId: "cpu" }));
  const njucm = listCampusAssistantKnowledgeEntries(actions, assistantSchoolOf({ schoolId: "njucm" }));
  assert.ok(cpu.some((item) => item.id === "cpu-campus-addresses-2026"));
  assert.ok(!njucm.some((item) => item.id === "cpu-campus-addresses-2026"));
  assert.ok(!njucm.some((item) => /cpu\.edu\.cn|童家巷|龙眠大道|中国药科大学/u.test(item.fact)), "外校拿到了药大的资料");
  // 通用的站内说明照常给。
  assert.ok(njucm.some((item) => item.id === "schedule-overview-2026-10"));
  // 核对电话、邮箱时也不拿药大的资料当依据。
  assert.match(campusAssistantGroundingText([], assistantSchoolOf({ schoolId: "cpu" })), /龙眠大道/u);
  assert.doesNotMatch(campusAssistantGroundingText([], assistantSchoolOf({ schoolId: "njucm" })), /龙眠大道/u);
});
