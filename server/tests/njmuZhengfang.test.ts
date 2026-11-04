import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  parseZfCalendar,
  parseZfExams,
  parseZfGrades,
  parseZfPeriods,
  parseZfSchedule,
  parseZfUnscheduledCourses,
  parseZfWeeks,
  semesterValue,
  zfTerm,
} from "../src/schools/njmu/parser";
import { encryptCasPassword, isNjmuToken, parseCasError, parseCasLoginForm } from "../src/schools/njmu/client";
import { njmuCalendarHtml, njmuExams, njmuGrades, njmuPeriods, njmuSchedule } from "./fixtures/njmu/zhengfang";

test("正方学期代码和站内学期互转", () => {
  assert.equal(semesterValue("2026", "3"), "2026-2027-1");
  assert.equal(semesterValue("2025", "12"), "2025-2026-2");
  assert.equal(semesterValue("2025", "16"), "2025-2026-3");
  assert.equal(semesterValue("2025", "9"), "");
  assert.deepEqual(zfTerm("2026-2027-1"), { xnm: "2026", xqm: "3" });
  assert.deepEqual(zfTerm("2025-2026-2"), { xnm: "2025", xqm: "12" });
  assert.equal(zfTerm("2025-2027-1"), null);
  assert.equal(zfTerm("2025-2026"), null);
});

test("周次写法：区间、逗号、第几周、单双周", () => {
  assert.deepEqual(parseZfWeeks("1-2周"), [1, 2]);
  assert.deepEqual(parseZfWeeks("3-4周,6周,11-12周,14周"), [3, 4, 6, 11, 12, 14]);
  assert.deepEqual(parseZfWeeks("第7周"), [7]);
  assert.deepEqual(parseZfWeeks("4-6周(双)"), [4, 6]);
  assert.deepEqual(parseZfWeeks("1-5周(单),8周"), [1, 3, 5, 8]);
  assert.deepEqual(parseZfWeeks(""), []);
});

test("课表按整学期给出，节次保留原始小节（含 13 节以后的晚课）", () => {
  const parsed = parseZfSchedule(njmuSchedule, { week: "7" });
  assert.equal(parsed.pageRecognized, true);
  assert.equal(parsed.scope, "semester");
  assert.equal(parsed.currentSemester, "2026-2027-1");
  assert.equal(parsed.currentWeek, "7");
  assert.equal(parsed.semesters[0].value, "2026-2027-1");
  assert.equal(parsed.semesters[0].label, "2026-2027学年第一学期");

  const courses = parsed.cells.flatMap((cell) => cell.courses.map((course) => ({ ...course, day: cell.day, bigSlot: cell.bigSlot })));
  // 同一门课同一时段同一地点按老师、周次拆成的几条合成一门。
  assert.equal(courses.length, 6);
  const diagnosis = courses.find((course) => course.name === "诊断学（B）")!;
  assert.deepEqual(diagnosis.weekList, [1, 2, 4, 6, 14]);
  assert.equal(diagnosis.weeks, "1-2周,4周,6周,14周");
  assert.equal(diagnosis.teacher, "教师D、教师E、教师F");
  assert.equal(diagnosis.startSlot, 3);
  assert.equal(diagnosis.endSlot, 5);
  assert.equal(diagnosis.bigSlot, 2);
  assert.equal(diagnosis.slotNote, "03-05节");
  assert.equal(diagnosis.location, "明达楼413");

  const evening = courses.filter((course) => course.name === "人工智能与脑机接口");
  assert.deepEqual(evening.map((course) => [course.startSlot, course.endSlot, course.bigSlot]), [[13, 15, 7], [13, 14, 7]]);
  assert.ok(parsed.cells.every((cell) => cell.day === 1));
  assert.ok(parsed.weeks.length >= 15);
});

test("课表：请求的学期优先，已知学期并入下拉并按新到旧排列", () => {
  const parsed = parseZfSchedule(njmuSchedule, { semester: "2026-2027-1", knownSemesters: ["2024-2025-1", "2025-2026-2"] });
  assert.deepEqual(parsed.semesters.map((item) => item.value), ["2026-2027-1", "2025-2026-2", "2024-2025-1"]);
  assert.equal(parsed.semesters.filter((item) => item.current).length, 1);
  assert.equal(parsed.currentWeek, "");
});

test("没有 kbList 的响应不算识别成功", () => {
  assert.equal(parseZfSchedule({ xsxx: {} }).pageRecognized, false);
  assert.equal(parseZfSchedule({ kbList: [] }).pageRecognized, true);
});

test("未排时间的课单独列出", () => {
  assert.deepEqual(parseZfUnscheduledCourses(njmuSchedule).map((item) => [item.name, item.weeks, item.credits]), [
    ["大国兵器", "1-7周", 2],
    ["脑洞大开背后的创新思维", "1-7周", 2],
  ]);
});

test("成绩：等级制取百分制分数，绩点和学分取正方给的值", () => {
  const parsed = parseZfGrades(njmuGrades);
  assert.equal(parsed.list.length, 5);
  assert.deepEqual(parsed.semesters.map((item) => item.value), ["2025-2026-1", "2024-2025-2", "2024-2025-1"]);
  const pass = parsed.list.find((row) => row.courseName === "基础医学导论")!;
  assert.equal(pass.score, "合格");
  assert.equal(pass.scoreNum, 60);
  assert.equal(pass.gpa, 1);
  assert.equal(pass.credits, 2);
  assert.equal(pass.semester, "2024-2025-1");
  assert.equal(pass.courseAttr, "非核心课程");
  assert.equal(pass.remark, "主修");
  const math = parsed.list.find((row) => row.courseCode === "16-jc13751103")!;
  assert.equal(math.courseName, "医学高等数学");
  assert.equal(math.scoreNum, 82.4);
  assert.equal(parseZfGrades({ items: [{ kcmc: "x", cj: "优秀" }] }).list[0].scoreNum, 95);
  assert.deepEqual(parseZfGrades({}).list, []);
});

test("考试：时间原样保留，地点带校区", () => {
  const parsed = parseZfExams(njmuExams);
  assert.equal(parsed.list.length, 2);
  assert.deepEqual(parsed.list[1], {
    semester: "2025-2026-2",
    examName: "2025-2026学年第二学期期末考试",
    courseCode: "16-jc33900704",
    courseName: "医学机能学实验",
    examTime: "2026-07-08(09:00-12:00)",
    location: "江宁校区 机考（博学楼三、四楼）",
    seat: undefined,
    examType: "2025-2026学年第二学期期末考试",
  });
});

test("作息：丢掉格式不对的节次并按节次排序", () => {
  assert.deepEqual(parseZfPeriods(njmuPeriods), [
    { id: 1, name: "第1节", start: "08:00", end: "08:40" },
    { id: 2, name: "第2节", start: "08:50", end: "09:30" },
    { id: 13, name: "第13节", start: "19:00", end: "19:40" },
  ]);
  assert.deepEqual(parseZfPeriods(null), []);
});

test("校历：从首页学期起止日推出教学周", () => {
  const calendar = parseZfCalendar(njmuCalendarHtml, [], new Date("2026-10-14T04:00:00Z"))!;
  assert.equal(calendar.currentSemester, "2026-2027-1");
  assert.equal(calendar.semesterStart, "2026-09-07");
  assert.equal(calendar.weeks[0].monday, "2026-09-07");
  assert.equal(calendar.weeks[0].sunday, "2026-09-13");
  assert.equal(calendar.weeks.at(-1)!.sunday, "2027-02-21");
  assert.equal(calendar.weeks.length, 24);
  assert.equal(calendar.currentWeek, 6);
  assert.equal(calendar.today, "2026-10-14");
  assert.equal(parseZfCalendar("<div>没有校历</div>"), null);
});

test("统一认证登录页：取账号密码表单的盐和 execution", () => {
  const html = `<form id="qrLoginForm"><input type="hidden" name="execution" value="qr-exec"/></form>
<form class="loginFromClass" method="post" id="pwdFromId" action="/authserver/login">
<input type="hidden" id="pwdEncryptSalt" value="abcdEFGHijklMNOP"/>
<input type="hidden" name="lt" id="lt" value=""/>
<input type="hidden" id="execution" name="execution" value="e1s1&amp;x"/></form>
<script>var captchaSwitch = "1";</script>`;
  assert.deepEqual(parseCasLoginForm(html), { salt: "abcdEFGHijklMNOP", execution: "e1s1&x", lt: "", captchaSwitch: true });
  assert.equal(parseCasLoginForm("<html></html>"), null);
  assert.equal(parseCasError(`<span id="showErrorTip"><span>您提供的用户名或者密码有误</span></span>`), "您提供的用户名或者密码有误");
});

test("统一认证密码加密和网页脚本一致：AES-CBC，盐为密钥，明文前拼 64 位随机串", () => {
  const salt = "abcdEFGHijklMNOP";
  let call = 0;
  const fixed = (length: number) => (call++ === 0 ? "I".repeat(length) : "R".repeat(length));
  const encrypted = encryptCasPassword("secret-pass", salt, fixed);
  const decipher = crypto.createDecipheriv("aes-128-cbc", Buffer.from(salt), Buffer.from("I".repeat(16)));
  const plain = Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]).toString("utf8");
  assert.equal(plain, `${"R".repeat(64)}secret-pass`);
  assert.equal(encryptCasPassword("x", "short"), "x");
});

test("南医令牌靠前缀区分", () => {
  assert.equal(isNjmuToken("njmu_abc"), true);
  assert.equal(isNjmuToken("abcdef"), false);
  assert.equal(isNjmuToken(undefined), false);
});

test("cookie 按路径区分：/sso 和 /jwglxt 的 JSESSIONID 不会互相覆盖", async () => {
  const { PathCookieJar } = await import("../src/schools/njmu/cookies");
  const jar = new PathCookieJar();
  jar.ingest(["JSESSIONID=sso1; Path=/sso", "route=r1; Path=/"], "jwpt.njmu.edu.cn", "/sso/jzlogin");
  jar.ingest(["JSESSIONID=jw1; Path=/jwglxt; HttpOnly"], "jwpt.njmu.edu.cn", "/jwglxt/ticketlogin");
  jar.ingest(["MOD_AUTH_CAS=m1"], "jwpt.njmu.edu.cn", "/jwglxt/ticketlogin");
  assert.equal(jar.serializeFor(new URL("https://jwpt.njmu.edu.cn/jwglxt/xtgl/index_initMenu.html")), "JSESSIONID=jw1; MOD_AUTH_CAS=m1; route=r1");
  assert.equal(jar.serializeFor(new URL("https://jwpt.njmu.edu.cn/sso/jzlogin")), "JSESSIONID=sso1; route=r1");
  assert.equal(jar.serializeFor(new URL("https://jwpt.njmu.edu.cn/jwglxtx")), "route=r1");
  jar.ingest(["JSESSIONID=; Path=/jwglxt; Max-Age=0"], "jwpt.njmu.edu.cn", "/jwglxt/");
  assert.equal(jar.serializeFor(new URL("https://jwpt.njmu.edu.cn/jwglxt/a")), "MOD_AUTH_CAS=m1; route=r1");
  const restored = PathCookieJar.fromJson(jar.toJson());
  assert.equal(restored.serializeFor(new URL("https://jwpt.njmu.edu.cn/sso/x")), "JSESSIONID=sso1; route=r1");
});

test("第 15 节以后挂的未排时间学时不进课表", () => {
  const parsed = parseZfSchedule({
    xsxx: { XNM: "2026", XQM: "3" },
    kbList: [
      { kcmc: "诊断学（B）", xqj: "1", jcs: "18-19", zcd: "第2周", cdmc: "未排地点" },
      { kcmc: "人工智能与脑机接口", xqj: "1", jcs: "13-15", zcd: "7周,14周", cdmc: "学海楼D216" },
    ],
  });
  assert.deepEqual(parsed.cells.flatMap((cell) => cell.courses.map((course) => course.name)), ["人工智能与脑机接口"]);
});

test("考级成绩：只留有成绩的项目，新学期在前", async () => {
  const { parseZfLevelExams } = await import("../src/schools/njmu/records");
  const parsed = parseZfLevelExams({ items: [
    { xmmc: "CET4", xmlbmc: "CET", xmcj: "456.00", xnmc: "2024-2025", xqmmc: "1" },
    { xmmc: "火车票优惠卡购买", xmlbmc: "火车票优惠卡", xmcj: null, xnmc: "2024-2025", xqmmc: "1" },
    { xmmc: "全国计算机三级", xmlbmc: "全国计算机", xmcj: "合格", xnmc: "2024-2025", xqmmc: "1" },
    { xmmc: "CET6", xmlbmc: "CET", xmcj: "368.00", xnmc: "2025-2026", xqmmc: "2", sjhm: "13800000000", zjh: "x" },
  ] });
  assert.deepEqual(parsed.list.map((row) => [row.name, row.score ?? row.grade]), [["CET6", 368], ["CET4", 456], ["全国计算机三级", "合格"]]);
  assert.ok(!JSON.stringify(parsed).includes("13800000000"));
});

test("学业：按课程性质的通过学分", async () => {
  const { parseZfCreditStats } = await import("../src/schools/njmu/records");
  const parsed = parseZfCreditStats([
    { kcxzmc: "非核心课程", tgxf: "75" },
    { kcxzmc: "核心课程", tgxf: "29" },
    { kcxzmc: "任选课", tgxf: "23" },
  ]);
  assert.deepEqual(parsed.totals, { requiredMust: 0, requiredOpt: 0, earnedMust: 104, earnedOpt: 23, leftMust: 0, leftOpt: 0 });
  assert.equal(parsed.summary.length, 3);
});

test("学业体检单：取数字和条件，不取姓名学号", async () => {
  const { parseZfCheckup } = await import("../src/schools/njmu/records");
  const html = `<h4>某某 同学（学号 20240000 ）: 你好！</h4>
<p>一、毕业基本要求 （一）必修课程无不合格 （二）选修课学分需修满 1.2023级开始，四年制本科生需修满18学分。</p>
<p>二、学位授予基本条件 1.达到毕业要求 2.核心课程平均学分绩点≥2.00 3.通过CET4</p>
<p>三、你的学业情况 截至 <u>2026</u> 年 <u>11</u> 月，你所学的必修课程中不及格课程 <u>1</u> 门（详见下表）；已获得任选课学分共 <u>23</u> 分。
当前核心课程 平均学分绩点 （GPA）为 <u>3.69</u> ；必修课程平均学分绩点为 <u>3.65</u> ；学业总评成绩为 <u>86.72</u> ；CET4成绩为 <u>456.00</u> 分。在校期间有 <u>0</u> 次处分记录。</p>
<span>不及格课程统计表</span><table><thead><tr><td>序号</td></tr></thead><tbody>
<tr><td>1</td><td>2024-2025-1</td><td>16-x</td><td>医用化学</td><td>核心课程</td><td>3.0</td><td>55</td></tr>
<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr></tbody></table>`;
  const checkup = parseZfCheckup(html)!;
  assert.equal(checkup.coreGpa, 3.69);
  assert.equal(checkup.requiredGpa, 3.65);
  assert.equal(checkup.overallScore, 86.72);
  assert.equal(checkup.cet4, 456);
  assert.equal(checkup.failedCount, 1);
  assert.equal(checkup.electiveCredits, 23);
  assert.equal(checkup.punishments, 0);
  assert.equal(checkup.asOf, "2026 年 11 月");
  assert.deepEqual(checkup.graduationRules, ["（一）必修课程无不合格", "（二）选修课学分需修满", "1.2023级开始，四年制本科生需修满18学分。"]);
  assert.equal(checkup.degreeRules.length, 3);
  assert.deepEqual(checkup.failed, [{ semester: "2024-2025-1", courseCode: "16-x", courseName: "医用化学", attr: "核心课程", credits: 3, bestScore: "55" }]);
  assert.ok(!JSON.stringify(checkup).includes("20240000"));
  assert.equal(parseZfCheckup("<p>无</p>"), null);
});

test("空教室：每段各查一次，拼出每间教室的占用，只列自习能用的教室", async () => {
  const { mergeZfFreeRooms, periodMask } = await import("../src/schools/njmu/records");
  assert.equal(periodMask(1, 2), 3);
  assert.equal(periodMask(3, 5), 28);
  const room = (cdmc: string, cdlbmc = "多媒体教室") => ({ cdmc, cdlbmc, zws: "120" });
  const merged = mergeZfFreeRooms([
    { slot: { from: 1, to: 2 }, rows: { items: [room("博学楼A101"), room("博学楼A102"), room("体育馆", "体育馆")] } },
    { slot: { from: 3, to: 5 }, rows: { items: [room("博学楼A102")] } },
  ], [{ id: 1, start: "08:00", end: "08:40" }, { id: 2, start: "08:50", end: "09:30" }, { id: 5, start: "11:20", end: "12:00" }]);
  assert.deepEqual(merged.slots.map((slot) => [slot.name, slot.start, slot.end]), [["1-2节", "08:00", "09:30"], ["3-5节", "", "12:00"]]);
  assert.deepEqual(merged.rooms.map((item) => [item.name, item.seats, item.states]), [["博学楼A101", 120, ["", "class"]], ["博学楼A102", 120, ["", ""]]]);
});

test("同时段的 PBL 多条记录合成一门，老师多时只列前三个", () => {
  const rows = ["2周,5周,12-14周", "2周,5-14周", "6-11周", "9-14周"].map((zcd, index) => ({ kcmc: "基础医学整合案例（PBL）04", xqj: "5", jcs: "4-5", zcd, cdmc: "未排地点", xm: `老师${index + 1}` }));
  const parsed = parseZfSchedule({ xsxx: { XNM: "2026", XQM: "3" }, kbList: rows });
  const courses = parsed.cells.flatMap((cell) => cell.courses);
  assert.equal(courses.length, 1);
  assert.equal(courses[0].weeks, "2周,5-14周");
  assert.equal(courses[0].teacher, "老师1、老师2、老师3等4人");
});

test("图书馆：在借按到期日排序、算剩余续借次数，额度和信封都能解", async () => {
  const { parseLibraryLoans, parseLibraryHistory, parseLibraryFines, parseLibraryQuota, unwrapLibrary } = await import("../src/schools/njmu/library");
  const loans = parseLibraryLoans({ items: [
    { barCode: "B2", title: "人体解剖学", dueDate: "2026-12-01 23:59:59", renewTimes: 1, callNo: "R322", location: "江宁书库", bibAttrs: { author: "某作者" } },
    { barCode: "B1", item: { title: "医学统计学" }, dueDate: "2026-11-10", renewTimes: 0 },
  ] }, [{ barCode: "B2", maxRenewTimes: 2 }]);
  assert.deepEqual(loans.map((loan) => [loan.title, loan.dueDate, loan.renewLeft]), [["医学统计学", "2026-11-10", undefined], ["人体解剖学", "2026-12-01", 1]]);
  assert.equal(loans[1].author, "某作者");
  assert.deepEqual(parseLibraryHistory({ total: 5, items: [{ title: "大学计算机", loanDate: "2024-09-08 10:00", returnDate: "2024-09-11" }] }), { list: [{ title: "大学计算机", author: undefined, callNo: undefined, loanDate: "2024-09-08", returnDate: "2024-09-11" }], total: 5 });
  assert.deepEqual(parseLibraryFines({ items: [{ title: "逾期", fineSum: "1.50元", reason: "逾期 15 天" }] }), [{ title: "逾期", amount: 1.5, reason: "逾期 15 天" }]);
  assert.deepEqual(parseLibraryQuota("3 / 20"), { borrowed: 3, limit: 20 });
  assert.equal(parseLibraryQuota(null), null);
  assert.deepEqual(unwrapLibrary('{"code":0,"msg":"ok","data":{"items":[]}}'), { items: [] });
  assert.deepEqual(unwrapLibrary('{"borrowCount":3}'), { borrowCount: 3 });
  assert.throws(() => unwrapLibrary('{"code":1,"msg":"失败","data":null}'));
});

test("图书馆开放时间：两列表格转成地点和时间", async () => {
  const { parseLibraryOpenHours } = await import("../src/schools/njmu/library");
  const html = `<table><tr><td>开放时间</td><td>每学期正常开放</td></tr><tr><td>自习空间（201）</td><td>7:00-22:00（考试期间6:30-22:40）</td></tr><tr><td colspan="2">&nbsp;</td></tr></table>`;
  assert.deepEqual(parseLibraryOpenHours(html), [
    { place: "开放时间", hours: "每学期正常开放" },
    { place: "自习空间（201）", hours: "7:00-22:00（考试期间6:30-22:40）" },
  ]);
});
