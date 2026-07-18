import assert from "node:assert/strict";
import test from "node:test";
import { parseSchedule } from "../src/services/jwxtParser";

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
