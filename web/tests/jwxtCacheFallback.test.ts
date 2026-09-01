import assert from "node:assert/strict";
import test from "node:test";
import {
  buildScheduleCacheKey,
  readLatestScheduleCache,
  scheduleLastCacheKey,
} from "../src/views/schedule/cache";
import { jwxtTabCacheKey, readLatestJwxtTabCache } from "../src/utils/jwxtTabCache";
import { resolveDetectedAcademicIdentity } from "../src/utils/academicIdentity";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => { values.clear(); },
    key: (index: number) => [...values.keys()][index] ?? null,
  };
}

test("课表当前身份分区为空时选择最近一次成功缓存", () => {
  const storage = memoryStorage();
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  storage.setItem("cpu-authenticated", "1");

  const undergraduateKey = buildScheduleCacheKey({
    scope: "undergraduate",
    semester: "2026-2027-1",
    week: "1",
  });
  storage.setItem(undergraduateKey, JSON.stringify({ savedAt: 200, data: { currentSemester: "2026-2027-1" } }));
  storage.setItem(scheduleLastCacheKey("undergraduate"), undergraduateKey);

  const latest = readLatestScheduleCache<any>(["graduate", "undergraduate"], storage);
  assert.equal(latest?.scope, "undergraduate");
  assert.equal(latest?.envelope.data.currentSemester, "2026-2027-1");
});

test("教务标签缓存可跨临时误判的身份分区回退", () => {
  const storage = memoryStorage();
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  storage.setItem("cpu-authenticated", "1");

  storage.setItem(jwxtTabCacheKey("grades", "undergraduate"), JSON.stringify({
    savedAt: 300,
    data: { parsed: { list: [{ name: "药理学" }] } },
  }));

  const latest = readLatestJwxtTabCache("grades", ["graduate", "undergraduate"]);
  assert.equal(latest?.identity, "undergraduate");
  assert.equal(latest?.envelope.data.parsed.list[0].name, "药理学");
});

test("两个入口临时不可读时保留上次成功身份", () => {
  assert.deepEqual(resolveDetectedAcademicIdentity({
    detected: "graduate",
    fallback: "undergraduate",
    capabilities: { undergraduate: false, graduate: false },
  }), {
    identity: "undergraduate",
    unavailable: true,
  });
});
