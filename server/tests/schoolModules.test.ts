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
import { DEFAULT_SCHOOL_ID, getSchool, resolveSchoolId, type SchoolProfile } from "../src/schools/registry";
import { signToken } from "../src/utils/jwt";

const otherSchool: SchoolProfile = { ...getSchool(DEFAULT_SCHOOL_ID), id: "njmu", defaultModules: SCHOOL_MODULE_KEYS };

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
