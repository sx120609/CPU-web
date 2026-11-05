import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEamsCalendar,
  mergeEamsFreeRooms,
  parseEamsExams,
  parseEamsGradeDetail,
  parseEamsGrades,
  parseEamsLevelExams,
  parseEamsPeriods,
  parseEamsProgramCompletion,
  parseEamsSchedule,
  parseEamsSemesterSpan,
  parseEamsSemesters,
  semesterOfDate,
} from "../src/schools/njucm/parser";
import { encryptIdsPassword, isNjucmToken, parseIdsError, parseIdsLoginForm } from "../src/schools/njucm/client";
import { isNjmuToken } from "../src/schools/njmu/client";

// 以下样本按 2026-11 南中医树维教务（jwgl.njucm.edu.cn/student）的真实响应结构手写，姓名学号等都是虚构的。

test("统一认证的密码加密与页面 RSAUtils.encryptedString 结果一致", () => {
  // 期望值由认证平台自己的 security.js 对同一公钥、同一明文算出。
  assert.equal(
    encryptIdsPassword("abc123"),
    "1b0a72785eff9a13fffcae7fb8a80be1651d9b075703ed791cc1bc8bc09725160e7573125ea7e7fc3b77a1af23d0cc360ca574fd3d9f3815b584fb279453252add00f4920ce7314041873d3255f25d0b00a30186713a3d09907c074bcd436364248a780d16a0e3dcdca9c1383e9e26dff379e9fb50037595bcb94e8b3633bb90",
  );
  // 明文超过一个分块（126 字节）时分块加密、空格隔开。
  assert.equal(encryptIdsPassword("x".repeat(130)).split(" ").length, 2);
});

test("统一认证登录页：取账号密码表单的 execution，认出验证码和错误提示", () => {
  const html = `
    <form id="fm1" action="/login" method="post">
      <div class="form-error"><span id="msg1" name="error_fm1" class="form-tab-nav">账号或密码错误。</span></div>
      <input name="username" id="username" />
      <input type="hidden" name="execution" value="abc_DEF&amp;1" />
      <input type="hidden" id="encrypted" name="encrypted" value="true" />
    </form>
    <form id="fm2" action="/login"><input type="hidden" name="execution" value="sms" /></form>`;
  assert.deepEqual(parseIdsLoginForm(html), { execution: "abc_DEF&1", captcha: false, modulus: "" });
  assert.equal(parseIdsError(html), "账号或密码错误。");
  const withCaptcha = html.replace('<input name="username"', '<input id="authcode" name="authcode" /><input name="username"');
  assert.equal(parseIdsLoginForm(withCaptcha)?.captcha, true);
  assert.equal(parseIdsLoginForm("<html></html>"), null);
});

test("令牌前缀区分学校：njucm_ 不会被当成南医的 njmu_", () => {
  assert.equal(isNjucmToken("njucm_abc"), true);
  assert.equal(isNjmuToken("njucm_abc"), false);
  assert.equal(isNjucmToken("njmu_abc"), false);
});

test("学期下拉：内部编号、学期名和当前学期", () => {
  const html = `<select class="form-control selectize" name="allSemesters" id="allSemesters">
    <option value="181">2026-2027-2</option>
    <option selected="selected" value="161">2026-2027-1</option>
    <option value="141">2025-2026-2</option>
    <option value="x">全部</option>
  </select>`;
  assert.deepEqual(parseEamsSemesters(html), [
    { id: "181", name: "2026-2027-2", selected: false },
    { id: "161", name: "2026-2027-1", selected: true },
    { id: "141", name: "2025-2026-2", selected: false },
  ]);
});

const layout = {
  id: 1,
  nameZh: "仙林课表布局",
  courseUnitList: [
    { indexNo: 1, startTime: 820, endTime: 900, nameZh: "第一节" },
    { indexNo: 2, startTime: 910, endTime: 950, nameZh: "第二节" },
    { indexNo: 6, startTime: 1400, endTime: 1440, nameZh: "第六节" },
    { indexNo: 8, startTime: 1540, endTime: 1620, nameZh: "第八节" },
    { indexNo: 10, startTime: 1830, endTime: 1910, nameZh: "第十节" },
  ],
};

test("作息：startTime 820 → 08:20", () => {
  assert.deepEqual(parseEamsPeriods(layout).slice(0, 2), [
    { id: 1, name: "第1节", start: "08:20", end: "09:00" },
    { id: 2, name: "第2节", start: "09:10", end: "09:50" },
  ]);
});

const printData = {
  studentTableVm: {
    id: 1,
    name: "张三",
    code: "000000000",
    grade: "2024",
    timeTableLayout: layout,
    activities: [
      { lessonId: 1, lessonCode: "030846—002", courseName: "诊断学", weekIndexes: [1, 2, 3], room: "B4-503", building: "B4", campus: "仙林校区", weekday: 2, startUnit: 6, endUnit: 8, teachers: ["李老师"] },
      { lessonId: 1, lessonCode: "030846—002", courseName: "诊断学", weekIndexes: [5, 17], room: "B4-503", building: "B4", campus: "仙林校区", weekday: 2, startUnit: 6, endUnit: 8, teachers: ["王老师"] },
      { lessonId: 2, lessonCode: "280125—063", courseName: "体育", weekIndexes: [2, 4, 6], room: "体育馆", weekday: 3, startUnit: 1, endUnit: 2, teachers: [] },
      { lessonId: 3, courseName: "", weekIndexes: [1], weekday: 1, startUnit: 1, endUnit: 2 },
    ],
  },
};

test("课表：同一门课同一时段的多条合并周次和老师，学期下拉列出给定学期", () => {
  const result = parseEamsSchedule(printData, { semester: "2026-2027-1", week: "3", knownSemesters: ["2026-2027-2", "2025-2026-2", "2026-2027-1"] });
  assert.equal(result.pageRecognized, true);
  assert.equal(result.currentSemester, "2026-2027-1");
  assert.deepEqual(result.semesters.map((item) => item.value), ["2026-2027-2", "2026-2027-1", "2025-2026-2"]);
  assert.equal(result.semesters.find((item) => item.current)?.value, "2026-2027-1");
  assert.equal(result.currentWeek, "3");
  assert.equal(result.cells.length, 2);
  const diagnosis = result.cells.find((cell) => cell.day === 2)!;
  assert.equal(diagnosis.bigSlot, 3);
  assert.deepEqual(diagnosis.courses[0], {
    name: "诊断学",
    weeks: "1-3周,5周,17周",
    weekList: [1, 2, 3, 5, 17],
    location: "B4-503",
    slotNote: "06-08节",
    startSlot: 6,
    endSlot: 8,
    sourceKey: "030846—002",
    teacher: "李老师、王老师",
  });
  assert.equal(result.cells.find((cell) => cell.day === 3)!.courses[0].teacher, undefined);
  assert.equal(JSON.stringify(result).includes("张三"), false);
});

test("课表：响应里没有 activities 时标记为未识别", () => {
  assert.equal(parseEamsSchedule({}, { semester: "2026-2027-1" }).pageRecognized, false);
});

test("成绩：按学期展开，平时/期末拆进对应字段，其他分项进备注，未发布的不显示", () => {
  const raw = {
    semesterId2studentGrades: {
      141: [
        {
          id: 1,
          semester: { id: 141, nameZh: "2025-2026-2" },
          course: { id: 7, nameZh: "体育Ⅳ", code: "280125", credits: 1 },
          lessonNameZh: "健美健身",
          examModeNameZh: "考试",
          gaGrade: "89",
          passed: true,
          gp: 3.9,
          published: true,
          gradeDetail: "<span class=\"subGradeProcess\" data-typeid=3>期末成绩:85.65(专项技术考核:95;体质健康测试:76.3)</span>\n<span class=\"subGradeProcess\" data-typeid=21>课外锻炼（仅体育课需设置）:100</span>\n<span class=\"subGradeProcess\" data-typeid=1>平时成绩:100</span>",
          courseType: { nameZh: "非校公选课（必修、限选）" },
          courseProperty: { nameZh: "必修" },
        },
        { id: 2, semester: { nameZh: "2025-2026-2" }, course: { nameZh: "未发布课" }, gaGrade: "70", published: false },
      ],
      121: [
        { id: 3, semester: { nameZh: "2025-2026-1" }, course: { nameZh: "中医基础理论", code: "010001", credits: 4.5 }, gaGrade: "良好", gp: 3, passed: true, published: true, gradeDetail: "" },
        { id: 4, semester: { nameZh: "2025-2026-1" }, course: { nameZh: "高等数学", code: "010002", credits: 3 }, gaGrade: "52", gp: 0, passed: false, published: true, gradeDetail: "" },
      ],
    },
  };
  const result = parseEamsGrades(raw);
  assert.deepEqual(result.semesters.map((item) => [item.value, item.current]), [["2025-2026-2", true], ["2025-2026-1", false]]);
  assert.equal(result.list.length, 3);
  assert.deepEqual(result.list[0], {
    semester: "2025-2026-2",
    courseCode: "280125",
    courseName: "体育Ⅳ",
    score: "89",
    scoreNum: 89,
    credits: 1,
    gpa: 3.9,
    courseAttr: "必修",
    examType: "考试",
    usual: "100",
    final: "85.65(专项技术考核:95;体质健康测试:76.3)",
    remark: "课外锻炼 100",
  });
  const words = result.list.find((row) => row.courseName === "中医基础理论")!;
  assert.equal(words.scoreNum, 85);
  assert.equal(result.list.find((row) => row.courseName === "高等数学")!.remark, "未通过");
});

test("成绩分项：没有分项时为空", () => {
  assert.deepEqual(parseEamsGradeDetail(""), { other: [] });
});

const spans = [
  { name: "2026-2027-1", startDate: "2026-08-31", endDate: "2027-01-10" },
  { name: "2025-2026-2", startDate: "2026-03-02", endDate: "2026-07-05" },
];

test("考试：未结束和已结束的都取，按考试日期归学期，楼名不和教室重复", () => {
  const html = `<table id="exams" class="table table-hover table-condensed exam-table"><thead><tr><th>考试时间</th><th>考试地点</th><th>考试科目</th><th>状态</th></tr></thead><tbody>
    <tr class="tr-empty"><td colspan="4"><div class="no-data-text">暂无"未结束"的考试安排</div></td></tr>
    <tr data-finished="false" class="unfinished">
      <td><div class="time">2027-01-05 09:30~11:30</div></td>
      <td><div><span>仙林校区</span> <span>B11</span> <span>B11-209</span></div></td>
      <td><div><span>方剂学 </span></div><div><span class="tag-span type2">期末</span></div></td>
      <td class="text-center">座位号：12</td>
    </tr>
    <tr data-finished="true" class="finished hide">
      <td><div class="time ">2026-07-02 09:30~11:30</div></td>
      <td><div><span>仙林校区</span> <span>国教楼</span> <span>301</span></div></td>
      <td><div><span>刺法灸法学 </span></div><div><span class="tag-span type2">期末</span></div></td>
      <td class="text-center">已结束</td>
    </tr>
  </tbody></table>`;
  const result = parseEamsExams(html, spans);
  assert.equal(result.finished, 1);
  assert.deepEqual(result.list, [
    { semester: "2026-2027-1", courseName: "方剂学", examTime: "2027-01-05 09:30~11:30", location: "仙林校区 B11-209", seat: "12", examType: "期末", examName: "期末" },
    { semester: "2025-2026-2", courseName: "刺法灸法学", examTime: "2026-07-02 09:30~11:30", location: "仙林校区 国教楼 301", seat: undefined, examType: "期末", examName: "期末" },
  ]);
  assert.deepEqual(result.semesters.map((item) => item.value), ["2026-2027-1", "2025-2026-2"]);
});

test("考试归学期：没有学期起止时按月份推算学年学期", () => {
  assert.equal(semesterOfDate("2026-12-30"), "2026-2027-1");
  assert.equal(semesterOfDate("2027-01-08"), "2026-2027-1");
  assert.equal(semesterOfDate("2026-06-20"), "2025-2026-2");
  assert.equal(semesterOfDate("2026-09-10", spans), "2026-2027-1");
  assert.equal(semesterOfDate("bad"), undefined);
});

test("校历：从学期起始日所在周一数周次，今天落在第几周", () => {
  const span = parseEamsSemesterSpan({ id: 161, nameZh: "2026-2027-1", startDate: "2026-08-31", endDate: "2027-01-10", weekStartOnSunday: false });
  assert.deepEqual(span, spans[0]);
  assert.equal(parseEamsSemesterSpan({ nameZh: "2026-2027-1", startDate: "2027-01-10", endDate: "2026-08-31" }), null);
  const calendar = buildEamsCalendar(span!, { semesters: ["2025-2026-2"], periods: parseEamsPeriods(layout), now: new Date("2026-11-05T04:00:00Z") });
  assert.equal(calendar.semesterStart, "2026-08-31");
  assert.equal(calendar.weeks.length, 19);
  assert.equal(calendar.semesterEnd, "2027-01-10");
  assert.equal(calendar.today, "2026-11-05");
  assert.equal(calendar.currentWeek, 10);
  assert.deepEqual(calendar.semesters.map((item) => [item.value, item.current]), [["2026-2027-1", true], ["2025-2026-2", false]]);
  assert.equal(calendar.periods?.[0].start, "08:20");
});

test("等级考试：只取成绩表，证书编号不外传", () => {
  const html = `
    <table><thead><tr><th>考试批次</th><th>考试科目</th><th>考试地点</th><th>考试安排</th><th>报名时间</th><th>考试费用</th><th>缴费状态</th></tr></thead>
      <tbody><tr><td colspan="7">暂无数据</td></tr></tbody></table>
    <table><thead><tr><th>考试种类</th><th>考试科目</th><th>成绩</th><th>等级</th><th>学分</th><th>是否通过</th><th>证书编号</th></tr></thead>
      <tbody>
        <tr><td>外语类</td><td>英语四级</td><td>495</td><td></td><td></td><td>否</td><td>242132015000000</td></tr>
        <tr><td>计算机类</td><td>计算机二级</td><td></td><td>合格</td><td>2</td><td>是</td><td>X</td></tr>
        <tr><td colspan="7">暂无数据</td></tr>
      </tbody></table>`;
  const result = parseEamsLevelExams(html);
  assert.deepEqual(result, {
    kind: "level-exams",
    list: [
      { name: "英语四级", subject: "外语类", score: 495, grade: undefined, note: undefined },
      { name: "计算机二级", subject: "计算机类", score: undefined, grade: "合格", note: "2 学分" },
    ],
  });
  assert.equal(JSON.stringify(result).includes("242132015000000"), false);
});

test("学业：培养方案模块的要求学分和已修学分，必修课程按通过与否分开", () => {
  const module = (nameZh: string, credits: number, passed: number, extra: Record<string, unknown> = {}) => ({
    nameZh,
    requireInfo: { subModuleNum: 0, credits },
    completionSummary: { passedCredits: passed, takingCredits: 0 },
    children: [],
    courseList: [],
    ...extra,
  });
  const raw = {
    student: { code: "000000000" },
    moduleList: [
      module("选修", 22, 21, {
        children: [
          module("专业选修课程", 16, 16, { courseList: [{ code: "r021405", nameZh: "穴位解剖学", credits: 2, score: 91, gradeStr: "91", resultType: "PASSED", finalResultType: "PASSED" }] }),
          module("通识教育选修课", 6, 5, {
            children: [module("人文艺术类", 2, 1, { courseList: [{ code: "w10041", nameZh: "艺术鉴赏", credits: 2, score: null, gradeStr: null, resultType: "TAKING", finalResultType: "TAKING" }] })],
          }),
        ],
      }),
      module("必修", 199.5, 84, {
        courseList: [
          { code: "010001", nameZh: "中医基础理论", credits: 4.5, gradeStr: "85", resultType: "PASSED", finalResultType: "PASSED" },
          { code: "010009", nameZh: "针灸学", credits: 6, gradeStr: null, resultType: "UNREPAIRED", finalResultType: "UNREPAIRED" },
        ],
      }),
    ],
  };
  const result = parseEamsProgramCompletion(raw);
  assert.deepEqual(result.summary.map((row) => row.name), ["选修", "选修 · 专业选修课程", "选修 · 通识教育选修课", "必修"]);
  assert.deepEqual(result.summary[3], { name: "必修", requiredMust: 199.5, requiredOpt: 0, earnedMust: 84, earnedOpt: 0, leftMust: 115.5, leftOpt: 0 });
  assert.deepEqual(result.summary[0], { name: "选修", requiredMust: 0, requiredOpt: 22, earnedMust: 0, earnedOpt: 21, leftMust: 0, leftOpt: 1 });
  assert.deepEqual(result.totals, { requiredMust: 199.5, requiredOpt: 22, earnedMust: 84, earnedOpt: 21, leftMust: 115.5, leftOpt: 1 });
  // 选修模块的课程不进已修、未修两栏，免得学业页把它们当必修再算一遍。
  assert.deepEqual(result.completed.map((row) => row.courseName), ["中医基础理论"]);
  assert.deepEqual(result.uncompleted.map((row) => [row.courseName, row.attr, row.score]), [["针灸学", "必修", undefined]]);
  assert.equal(JSON.stringify(result).includes("000000000"), false);
});

test("空教室：各时段的空闲名单拼成每间教室的占用，排除操场等场地", () => {
  const room = (nameZh: string, building: string, type = "多媒体教室", seats = 80) => ({ id: 1, nameZh, building: { nameZh: building }, roomType: { nameZh: type }, seatsForLesson: seats, seats: 45, virtual: false });
  const results = [
    { slot: { from: 1, to: 2 }, rows: { roomList: [room("B11-108", "B11"), room("B2-201", "B2"), room("田径场", "操场", "室外场地")] } },
    { slot: { from: 10, to: 12 }, rows: { roomList: [room("B11-108", "B11")] } },
  ];
  const { slots, rooms } = mergeEamsFreeRooms(results, parseEamsPeriods(layout));
  assert.deepEqual(slots, [
    { name: "1-2节", periods: "1-2", start: "08:20", end: "09:50" },
    { name: "10-12节", periods: "10-12", start: "18:30", end: "" },
  ]);
  assert.deepEqual(rooms, [
    { name: "B2-201", building: "B2", type: "多媒体教室", seats: 80, states: ["", "class"] },
    { name: "B11-108", building: "B11", type: "多媒体教室", seats: 80, states: ["", ""] },
  ]);
});
