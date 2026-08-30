import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../src/utils/response";
import { detectAcademicIdentityFromProbes } from "../src/services/academicIdentityDetection";
import { parseGraduateSchedulePayload } from "../src/services/graduateScheduleParser";

test("研究生入口成功后不会再触发可能清理共享会话的本科探测", async () => {
  let undergraduateProbeCount = 0;
  const result = await detectAcademicIdentityFromProbes({
    probeGraduate: async () => ({
      parsed: {
        currentSemester: "2026-2027学年第一学期",
        semesters: [{ value: "2026-2027学年第一学期" }],
        cells: [],
      },
    }),
    probeUndergraduate: async () => {
      undergraduateProbeCount += 1;
      throw new HttpError(401, 4001, "本科入口不可用");
    },
    isGraduateUsable: (value) => Boolean(value.parsed.currentSemester),
    isUndergraduateUsable: () => false,
  });

  assert.equal(result.identity, "graduate");
  assert.equal(result.capabilities.graduate, true);
  assert.equal(undergraduateProbeCount, 0);
});

test("研究生上游错误不会被本科 401 覆盖成整套统一认证过期", async () => {
  const graduateError = new HttpError(400, 4000, "研究生入口返回了无法解析的数据");

  await assert.rejects(
    () => detectAcademicIdentityFromProbes({
      probeGraduate: async () => { throw graduateError; },
      probeUndergraduate: async () => {
        throw new HttpError(401, 4001, "本科入口不可用");
      },
      isGraduateUsable: () => false,
      isUndergraduateUsable: () => false,
    }),
    (error: unknown) => error === graduateError,
  );
});

test("研究生入口不可用时仍可正确识别本科教务", async () => {
  const result = await detectAcademicIdentityFromProbes({
    probeGraduate: async () => {
      throw new HttpError(400, 4000, "没有研究生入口权限");
    },
    probeUndergraduate: async () => ({
      currentSemester: "2026-2027-1",
      semesters: [{ value: "2026-2027-1" }],
      cells: [],
    }),
    isGraduateUsable: () => false,
    isUndergraduateUsable: (value) => Boolean(value.currentSemester),
  });

  assert.equal(result.identity, "undergraduate");
  assert.deepEqual(result.capabilities, {
    undergraduate: true,
    graduate: false,
  });
});

test("研究生入口返回空数据时继续探测并识别本科教务", async () => {
  let undergraduateProbeCount = 0;
  const result = await detectAcademicIdentityFromProbes({
    probeGraduate: async () => ({
      parsed: {
        currentSemester: "",
        semesters: [],
        cells: [],
      },
    }),
    probeUndergraduate: async () => {
      undergraduateProbeCount += 1;
      return {
        currentSemester: "2026-2027-1",
        semesters: [{ value: "2026-2027-1" }],
        cells: [],
      };
    },
    isGraduateUsable: (value) => Boolean(value.parsed.currentSemester),
    isUndergraduateUsable: (value) => Boolean(value.currentSemester),
  });

  assert.equal(undergraduateProbeCount, 1);
  assert.equal(result.identity, "undergraduate");
  assert.deepEqual(result.capabilities, {
    undergraduate: true,
    graduate: false,
  });
});

test("两个入口都没有数据时保留已认证的研究生空状态", async () => {
  const result = await detectAcademicIdentityFromProbes({
    probeGraduate: async () => ({ parsed: { currentSemester: "", semesters: [], cells: [] } }),
    probeUndergraduate: async () => ({ currentSemester: "", semesters: [], cells: [] }),
    isGraduateUsable: () => false,
    isUndergraduateUsable: () => false,
  });

  assert.deepEqual(result, {
    identity: "graduate",
    source: "fallback",
    capabilities: {
      undergraduate: false,
      graduate: false,
    },
  });
});

test("研究生课表 JSON 能解析为统一课表结构", () => {
  const parsed = parseGraduateSchedulePayload(
    {
      rows: [
        {
          mc: "第1节",
          z1: "药物分析进展[1-8周] 张老师[教学楼101]",
        },
      ],
    },
    [{ termcode: "2026-1", termname: "2026-2027学年第一学期", selected: true }],
    "2026-1",
  );

  assert.equal(parsed.currentSemester, "2026-2027学年第一学期");
  assert.equal(parsed.cells.length, 1);
  assert.equal(parsed.cells[0]?.day, 1);
  assert.equal(parsed.cells[0]?.courses[0]?.name, "药物分析进展");
  assert.equal(parsed.cells[0]?.courses[0]?.teacher, "张老师");
  assert.equal(parsed.cells[0]?.courses[0]?.location, "教学楼101");
  assert.deepEqual(parsed.cells[0]?.courses[0]?.weekList, [1, 2, 3, 4, 5, 6, 7, 8]);
});
