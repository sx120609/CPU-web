import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import type { Request } from "express";
import { SCHOOL_MODULES, SCHOOL_MODULE_KEYS } from "../src/schools/catalog";
import {
  getEnabledSchoolModules,
  isSchoolModuleAvailable,
  requestSchoolId,
  requireSchoolModule,
  schoolModuleForRoute,
} from "../src/schools/modules";
import { DEFAULT_SCHOOL_ID, applySchoolRows, findSchool, getSchool, resolveSchoolId, type SchoolProfile } from "../src/schools/registry";
import { ensureCanManageSchool, isPlatformAdmin } from "../src/schools/store";
import { signToken } from "../src/utils/jwt";

const otherSchool: SchoolProfile = { ...getSchool(DEFAULT_SCHOOL_ID), id: "example", defaultModules: SCHOOL_MODULE_KEYS };

function request(init: { user?: Record<string, unknown>; bearer?: string; siteToken?: string }) {
  return {
    user: init.user,
    headers: init.bearer ? { authorization: `Bearer ${init.bearer}` } : {},
    browserSession: init.siteToken ? { siteToken: init.siteToken } : undefined,
  } as unknown as Request;
}

function token(schoolId?: string) {
  return signToken({ userId: 1, studentId: "2020240444", role: "user", campus: "", ...(schoolId ? { schoolId } : {}) });
}

test("the default school keeps every existing feature switched on", () => {
  assert.deepEqual(getEnabledSchoolModules(DEFAULT_SCHOOL_ID), [...SCHOOL_MODULE_KEYS]);
  assert.deepEqual(getEnabledSchoolModules("unknown-school"), [...SCHOOL_MODULE_KEYS]);
});

test("another school cannot open features that are not yet split by school or not built for it", () => {
  const byKey = new Map(SCHOOL_MODULES.map((module) => [module.key, module]));
  assert.equal(isSchoolModuleAvailable(otherSchool, byKey.get("forum")!), true);
  assert.equal(isSchoolModuleAvailable(otherSchool, byKey.get("announcements")!), false);
  assert.equal(isSchoolModuleAvailable(otherSchool, byKey.get("treehole")!), true);
  assert.equal(isSchoolModuleAvailable(otherSchool, byKey.get("games")!), true);
  assert.equal(isSchoolModuleAvailable(otherSchool, byKey.get("assistant")!), false);
  assert.equal(isSchoolModuleAvailable(otherSchool, byKey.get("dormElectric")!), false);
  assert.equal(isSchoolModuleAvailable(otherSchool, byKey.get("academic")!), false);
  assert.equal(isSchoolModuleAvailable(otherSchool, byKey.get("vip")!), true);
});

test("requests resolve their school from the hydrated user, then the token, then the default", () => {
  assert.equal(requestSchoolId(request({})), DEFAULT_SCHOOL_ID);
  assert.equal(requestSchoolId(request({ bearer: token() })), DEFAULT_SCHOOL_ID);
  assert.equal(requestSchoolId(request({ bearer: token("cpu") })), "cpu");
  assert.equal(requestSchoolId(request({ siteToken: token("not-registered") })), DEFAULT_SCHOOL_ID);
  assert.equal(requestSchoolId(request({ bearer: "not-a-token" })), DEFAULT_SCHOOL_ID);
  assert.equal(requestSchoolId(request({ user: { schoolId: "cpu" }, bearer: token("not-registered") })), "cpu");
  assert.equal(resolveSchoolId(undefined), DEFAULT_SCHOOL_ID);
  // 访客在登录页选的学校只在没有令牌时生效，未登记的学校按默认学校。
  const guestWithChoice = { headers: { "x-cpu-school": "cpu" } } as unknown as Request;
  assert.equal(requestSchoolId(guestWithChoice), "cpu");
  assert.equal(requestSchoolId({ headers: { "x-cpu-school": "nowhere" } } as unknown as Request), DEFAULT_SCHOOL_ID);
});

test("module guards let the default school through and reject unknown module keys", async () => {
  const guard = requireSchoolModule("forum");
  const error = await new Promise((resolve) => guard(request({ bearer: token() }), {} as never, resolve));
  assert.equal(error, undefined);
  assert.throws(() => requireSchoolModule("no-such-module"));
});

test("every guarded route prefix is mounted exactly as listed", () => {
  const source = readFileSync(path.join(__dirname, "../src/routes/index.ts"), "utf8");
  const mounted = new Set([...source.matchAll(/^mount\("([^"]+)"/gmu)].map((match) => match[1]));
  for (const module of SCHOOL_MODULES) {
    for (const route of module.routes) {
      assert.ok(mounted.has(route), `${module.key} lists ${route}, which routes/index.ts does not mount`);
      assert.equal(schoolModuleForRoute(route), module.key);
    }
  }
});

test("schools created in the admin are local-account schools with every isolated feature on", () => {
  applySchoolRows([
    { id: "cpu", name: "中国药科大学", shortName: "药大", brandName: "药大拾间", tagline: "", enabled: true },
    { id: "example", name: "示例大学", shortName: "示例", brandName: "示例拾间", tagline: "", enabled: false },
  ], SCHOOL_MODULE_KEYS);
  try {
    const example = findSchool("example")!;
    assert.equal(example.brandName, "示例拾间");
    assert.equal(example.ssoLogin, false);
    assert.equal(example.academicSystem, null);
    assert.equal(resolveSchoolId("example"), "example");
    assert.equal(getSchool("cpu").ssoLogin, true);
    assert.ok(getEnabledSchoolModules("example").includes("forum"));
    assert.ok(!getEnabledSchoolModules("example").includes("academic"));
  } finally {
    applySchoolRows([], SCHOOL_MODULE_KEYS);
  }
  assert.equal(findSchool("example"), null);
  assert.equal(getSchool("cpu").brandName, "药大拾间");
});

test("only default-school admins manage every school; other admins manage their own", () => {
  assert.equal(isPlatformAdmin({ role: "admin", schoolId: "cpu" }), true);
  assert.equal(isPlatformAdmin({ role: "admin" }), false);
  assert.equal(isPlatformAdmin({ role: "admin", schoolId: "njmu" }), false);
  assert.equal(isPlatformAdmin({ role: "mod", schoolId: "cpu" }), false);
  assert.doesNotThrow(() => ensureCanManageSchool({ role: "admin", schoolId: "njmu" }, "njmu"));
  assert.throws(() => ensureCanManageSchool({ role: "admin", schoolId: "njmu" }, "cpu"));
  assert.throws(() => ensureCanManageSchool({ role: "mod", schoolId: "njmu" }, "njmu"));
});

test("南医是带教务驱动的内置学校：统一认证登录、教务可开，名称以 School 表为准", () => {
  const byKey = new Map(SCHOOL_MODULES.map((module) => [module.key, module]));
  const njmu = getSchool("njmu");
  assert.equal(njmu.id, "njmu");
  assert.equal(njmu.ssoLogin, true);
  assert.equal(njmu.academicSystem, "zhengfang-v9");
  assert.equal(njmu.enabled, false);
  assert.equal(njmu.defaultPeriods.length, 15);
  assert.equal(isSchoolModuleAvailable(njmu, byKey.get("academic")!), true);
  assert.equal(isSchoolModuleAvailable(njmu, byKey.get("announcements")!), true);
  assert.equal(isSchoolModuleAvailable(njmu, byKey.get("dormElectric")!), false);
  assert.ok(getEnabledSchoolModules("njmu").includes("academic"));
  applySchoolRows([{ id: "njmu", name: "南京医科大学", shortName: "南医", brandName: "南医拾间", tagline: "南医校园互助", enabled: true }], SCHOOL_MODULE_KEYS);
  try {
    assert.equal(getSchool("njmu").tagline, "南医校园互助");
    assert.equal(getSchool("njmu").enabled, true);
    assert.equal(getSchool("njmu").ssoLogin, true);
  } finally {
    applySchoolRows([], SCHOOL_MODULE_KEYS);
  }
});
