import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeCalendarWeekDays,
  parseCalendar,
  parseExams,
  parseGrades,
  parseProgress,
  parsePyfa,
  parseSchedule,
} from "../src/services/jwxtParser";

test("normalizeCalendarWeekDays fills a partial Sunday-first final week", () => {
  assert.deepEqual(
    normalizeCalendarWeekDays(["2026-07-12", "", "", "", "", "", ""]),
    [
      "2026-07-13",
      "2026-07-14",
      "2026-07-15",
      "2026-07-16",
      "2026-07-17",
      "2026-07-18",
      "2026-07-19",
    ],
  );
});

test("normalizeCalendarWeekDays fills a partial Sunday-first opening week", () => {
  assert.deepEqual(
    normalizeCalendarWeekDays(["", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06", "2026-03-07"]),
    [
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
      "2026-03-06",
      "2026-03-07",
      "2026-03-08",
    ],
  );
});

test("parseSchedule keeps supporting the legacy kbtable layout", () => {
  const result = parseSchedule(`
    <html>
      <head><title>学期理论课表</title></head>
      <body>
        <select id="xnxq01id">
          <option value="2025-2026-1">2025-2026-1</option>
          <option value="2025-2026-2" selected>2025-2026-2</option>
        </select>
        <select id="zc"><option value="1" selected>第1周</option></select>
        <table id="kbtable">
          <tr><th></th><th>星期一</th><th>星期二</th><th>星期三</th><th>星期四</th><th>星期五</th><th>星期六</th><th>星期日</th></tr>
          <tr>
            <th>第一大节</th>
            <td><div class="kbcontent">分析化学<br><font title="老师">张三</font><br><font title="周次(节次)">1-3(周)</font><br><font title="教室">A101</font><br><font title="节次备注">(01-02节)</font><br></div></td>
          </tr>
        </table>
      </body>
    </html>
  `);

  assert.equal(result.currentSemester, "2025-2026-2");
  assert.equal(result.currentWeek, "1");
  assert.deepEqual(result.cells, [{
    day: 1,
    bigSlot: 1,
    courses: [{
      name: "分析化学",
      teacher: "张三",
      weeks: "1-3(周)",
      weekList: [1, 2, 3],
      location: "A101",
      slotNote: "01-02节",
      startSlot: 1,
      endSlot: 2,
    }],
  }]);
});

test("parseSchedule parses the modern qz weekly table and restores rowspan columns", () => {
  const course = (name: string, detail: string) => `
    <ul class="courselists">
      <li class="courselists-item">
        <div class="qz-hasCourse-title">${name}</div>
        <p><span class="qz-hasCourse-abbrinfo">${detail}</span></p>
      </li>
    </ul>
  `;

  const result = parseSchedule(`
    <html>
      <head><title>个人课表信息</title></head>
      <body>
        <select id="xnxq01id">
          <option value="2026-2027-1">2026-2027-1</option>
          <option value="2025-2026-2" selected>2025-2026-2</option>
        </select>
        <select id="zc">
          <option value="">(全部)</option>
          <option value="2" selected>第2周</option>
        </select>
        <table class="qz-weeklyTable">
          <tr><th>周次</th><th>星期一</th><th>星期二</th><th>星期三</th><th>星期四</th><th>星期五</th><th>星期六</th><th>星期日</th></tr>
          <tr>
            <td name="timeTd"><div class="index-title">第一大节</div></td>
            <td name="kbDataTd">${course("分析化学", "老师:张三讲师;时间:1-3周[1-2节];地点:教学楼A楼(A101)")}</td>
            <td name="kbDataTd" rowspan="2" colsize="2">${course("药理学实验", "老师:李四副教授;时间:1-6双周[1-4节];地点:()")}</td>
            <td name="kbDataTd"></td><td name="kbDataTd"></td><td name="kbDataTd"></td><td name="kbDataTd"></td><td name="kbDataTd"></td>
          </tr>
          <tr>
            <td name="timeTd"><div class="index-title">第二大节</div></td>
            <td name="kbDataTd"></td>
            <td name="kbDataTd">${course("生物化学", "老师:王五教授;时间:4周[3-4节];地点:教学楼B楼(B201)")}</td>
            <td name="kbDataTd"></td><td name="kbDataTd"></td><td name="kbDataTd"></td><td name="kbDataTd"></td>
          </tr>
        </table>
      </body>
    </html>
  `);

  assert.equal(result.title, "个人课表信息");
  assert.equal(result.currentSemester, "2025-2026-2");
  assert.equal(result.currentWeek, "2");
  assert.equal(result.cells.length, 3);

  const monday = result.cells.find((cell) => cell.day === 1 && cell.bigSlot === 1);
  assert.deepEqual(monday?.courses[0], {
    name: "分析化学",
    teacher: "张三",
    weeks: "1-3周",
    weekList: [1, 2, 3],
    location: "A101",
    slotNote: "01-02节",
    startSlot: 1,
    endSlot: 2,
  });

  const rowspanCourse = result.cells.find((cell) => cell.day === 2 && cell.bigSlot === 1);
  assert.deepEqual(rowspanCourse?.courses[0], {
    name: "药理学实验",
    teacher: "李四",
    weeks: "1-6双周",
    weekList: [2, 4, 6],
    location: undefined,
    slotNote: "01-04节",
    startSlot: 1,
    endSlot: 4,
  });

  const afterRowspan = result.cells.find((cell) => cell.day === 3 && cell.bigSlot === 2);
  assert.equal(afterRowspan?.courses[0].name, "生物化学");
  assert.equal(afterRowspan?.courses[0].teacher, "王五");
  assert.equal(afterRowspan?.courses[0].location, "B201");
});

test("parseGrades maps the modern paged JSON response", () => {
  const result = parseGrades(JSON.stringify({
    code: 0,
    count: 1,
    data: [{
      xnxqid: "2025-2026-2",
      kch: "C1001",
      kc_mc: "药理学",
      zcj: 88,
      zcjstr: "88",
      xf: 3,
      zxs: 48,
      jd: 3.8,
      kcsx: "必修",
      ksxz: "正常考试",
    }],
  }));

  assert.deepEqual(result.semesters.map((item) => item.value), ["2025-2026-2"]);
  assert.deepEqual(result.list[0], {
    semester: "2025-2026-2",
    courseCode: "C1001",
    courseName: "药理学",
    score: "88",
    scoreNum: 88,
    credits: 3,
    hours: 48,
    gpa: 3.8,
    courseAttr: "必修",
    examType: "正常考试",
    remark: undefined,
  });
});

test("parseExams maps the modern paged JSON response", () => {
  const result = parseExams(JSON.stringify({
    code: 0,
    count: 1,
    data: [{
      xnxqid: "2025-2026-2",
      kch: "C1001",
      kskcmc: "药理学",
      kssj: "2026-06-20 09:00-11:00",
      js_mc: "教学楼A101",
      zwh: "18",
      ksccmc: "第一场",
    }],
  }));

  assert.equal(result.list[0].courseName, "药理学");
  assert.equal(result.list[0].location, "教学楼A101");
  assert.equal(result.list[0].seat, "18");
});

test("parseCalendar accepts the modern 第N周 row label", () => {
  const result = parseCalendar(`
    <select id="xnxq01id"><option value="2025-2026-2" selected>2025-2026-2</option></select>
    <table><tr><th>周次</th><th>星期一</th><th>星期二</th><th>星期三</th><th>星期四</th><th>星期五</th><th>星期六</th><th>星期日</th><th>备注</th></tr>
      <tr><td>第1周</td><td>02</td><td>03</td><td>04</td><td>05</td><td>06</td><td>03月07日</td><td>03月08日</td><td>开学</td></tr>
    </table>
  `);
  assert.equal(result.weeks[0].week, 1);
  assert.equal(result.weeks[0].monday, "2026-03-02");
  assert.equal(result.weeks[0].sunday, "2026-03-08");
});

test("parseProgress maps the modern card-and-div layout", () => {
  const result = parseProgress(`
    <div class="mod-total-area"><div class="total-list">
      <div class="list-header-tr"><div class="header-th"><span class="header-th-cell">课程性质</span></div></div>
      <div class="list-tr"><div class="list-td"><span class="list-td-cell">专业选修课</span></div><div class="list-td"><span class="list-td-cell">10</span></div><div class="list-td"><span class="list-td-cell">6</span></div><div class="list-td"><span class="list-td-cell">4</span></div></div>
    </div></div>
    <div class="mod-item-detail"><div class="sub-table">
      <div class="sub-table-header-tr">${["学年学期", "课程编号", "课程名称", "学分", "课程属性", "课程性质", "修读情况", "总成绩", "备注"].map((header) => `<div class="header-th"><span class="header-th-cell">${header}</span></div>`).join("")}</div>
      <div class="list-tr">${["2025-2026-2", "C1001", "药理学", "3", "必修", "专业基础课", "已修读", "88", "通过"].map((cell) => `<div class="list-td"><span class="list-td-cell">${cell}</span></div>`).join("")}</div>
      <div class="list-tr">${["2026-2027-1", "C1002", "药物分析", "2", "必修", "专业核心课", "修读中", "", ""].map((cell) => `<div class="list-td"><span class="list-td-cell">${cell}</span></div>`).join("")}</div>
    </div></div>
  `);

  assert.equal(result.summary[0].requiredOpt, 10);
  assert.equal(result.completed[0].courseName, "药理学");
  assert.equal(result.completed[0].passed, true);
  assert.equal(result.uncompleted[0].courseName, "药物分析");
});

test("parsePyfa maps the modern paged JSON response", () => {
  const result = parsePyfa(JSON.stringify({
    code: 0,
    count: 1,
    data: [{
      rownum_: 1,
      kkxq: "2026-2027-1",
      kch: "C1002",
      kc_mc: "药物分析",
      yx_mc: "药学院",
      xf: 2,
      zxs: 32,
      khlb_mc: "考试",
      kclb_mc: "必修",
      sfks: "是",
    }],
  }));
  assert.equal(result.list[0].courseName, "药物分析");
  assert.deepEqual(result.bySemester, [{ semester: "2026-2027-1", courses: 1, credits: 2 }]);
});
