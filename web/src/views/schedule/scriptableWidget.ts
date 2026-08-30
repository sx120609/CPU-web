export function buildScriptableWidgetScript(endpoint: string) {
  return `// 药大课表小组件
// 小组件参数：upcoming（临近课程）、split（当前/接下来）、today（今日课程）、twoday（两日课表）。
const API_ENDPOINT = ${JSON.stringify(endpoint)};
const MINUTES_22_00 = 22 * 60;
const FAMILY = config.widgetFamily || "medium";
const STYLE_PARAMETER = String(args.widgetParameter || "").trim().toLowerCase();
const ACCENTS = ["#e85b4b", "#4a78f2", "#8b5cf6", "#17a69a", "#e0a224", "#ec70a1"];
const TINTS = ["#fdece9", "#eaf0ff", "#f2ecff", "#e5f8f5", "#fff7e0", "#fdebf4"];
const DARK_TINTS = ["#42221f", "#1e2d52", "#32244f", "#153c38", "#403418", "#48243a"];

async function loadSchedule() {
  const req = new Request(API_ENDPOINT);
  req.timeoutInterval = 20;
  const body = await req.loadJSON();
  if (!body || body.code !== 0) throw new Error(body?.message || "课表读取失败");
  return body.data;
}

function color(light, dark) {
  return Color.dynamic(new Color(light), new Color(dark || light));
}

function addLine(stack, text, font, colorValue, limit) {
  const line = stack.addText(String(text || ""));
  line.font = font;
  line.textColor = colorValue;
  line.lineLimit = limit || 1;
  line.minimumScaleFactor = 0.72;
  return line;
}

function shortDate(value) {
  const match = String(value || "").match(/-(\\d{2})-(\\d{2})$/);
  return match ? match[1] + "/" + match[2] : "";
}

function compactDate(value) {
  const match = String(value || "").match(/-(\\d{2})-(\\d{2})$/);
  return match ? Number(match[1]) + "." + Number(match[2]) : "";
}

function deviceDate(offset) {
  const date = new Date(Date.now() + offset * 24 * 60 * 60 * 1000);
  const formatter = new DateFormatter();
  formatter.locale = "zh-CN";
  formatter.dateFormat = "yyyy-MM-dd";
  return formatter.string(date);
}

function deviceMinutes() {
  const date = new Date();
  return date.getHours() * 60 + date.getMinutes();
}

function deviceDayOfWeek(offset) {
  const date = new Date(Date.now() + offset * 24 * 60 * 60 * 1000);
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

function dayLabel(day) {
  return ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][day - 1] || "";
}

function parseMinutes(value) {
  const match = String(value || "").match(/^(\\d{2}):(\\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : -1;
}

function courseEndMinutes(course) {
  const end = parseMinutes(course?.endTime);
  if (end >= 0) return end;
  const start = parseMinutes(course?.startTime);
  return start >= 0 ? start + 45 : 0;
}

function allDays(data) {
  return [...(data.weekDays || []), ...(data.days || [])];
}

function resolveDay(data, offset) {
  const target = deviceDate(offset);
  const candidates = allDays(data);
  const byDate = candidates.find((day) => String(day.date || "") === target);
  if (byDate) return byDate;
  const targetDay = deviceDayOfWeek(offset);
  if (data.strictDate === true) {
    return { day: targetDay, label: dayLabel(targetDay), date: target, week: "", courses: [] };
  }
  return candidates.find((day) => Number(day.day) === targetDay) || (offset === 0 ? data.today : null);
}

function shouldPreferTomorrow(data) {
  const now = deviceMinutes();
  if (now >= MINUTES_22_00) return true;
  const courses = resolveDay(data, 0)?.courses || [];
  if (!courses.length) return false;
  return courses.every((course) => courseEndMinutes(course) < now);
}

function firstCourses(day, limit) {
  return (day?.courses || []).slice(0, limit);
}

function nextCourses(day, limit) {
  const now = deviceMinutes();
  return (day?.courses || []).filter((course) => {
    const end = courseEndMinutes(course);
    return end >= now || (parseMinutes(course?.startTime) < 0 && end <= 0);
  }).slice(0, limit);
}

function courseMetaText(course) {
  const parts = [];
  if (course?.location) parts.push(course.location);
  if (course?.teacher) parts.push(course.teacher);
  return parts.join("  ") || "地点待确认";
}

function timeRange(course) {
  const start = course?.startTime || "";
  const end = course?.endTime || "";
  return !start ? "时间待确认" : end ? start + " - " + end : start;
}

function paletteIndex(course) {
  const value = String(course?.name || "课程");
  let hash = 0;
  for (let index = 0; index < value.length; index++) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  return Math.abs(hash) % ACCENTS.length;
}

function accentColor(course) {
  return color(ACCENTS[paletteIndex(course)]);
}

function tintColor(course) {
  const index = paletteIndex(course);
  return color(TINTS[index], DARK_TINTS[index]);
}

function addDateHeader(widget, day, large) {
  const row = widget.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  const date = compactDate(day?.date) || "课表";
  addLine(row, date, Font.boldSystemFont(large ? 17 : 15), color("#172033", "#f8fafc"));
  row.addSpacer(6);
  const weekend = day?.label === "周六" || day?.label === "周日";
  addLine(row, day?.label || "", Font.boldSystemFont(large ? 17 : 15), weekend ? color("#f43f5e") : color("#0f8f7f", "#5eead4"));
}

function addAccentBar(parent, course, height) {
  const bar = parent.addStack();
  bar.backgroundColor = accentColor(course);
  bar.cornerRadius = 3;
  bar.size = new Size(5, height);
}

function addCourseDetails(parent, course, roomy) {
  const details = parent.addStack();
  details.layoutVertically();
  addLine(details, course?.name || "课程", Font.boldSystemFont(roomy ? 16 : 14), color("#172033", "#f8fafc"), 2);
  details.addSpacer(2);
  addLine(details, courseMetaText(course), Font.systemFont(roomy ? 11 : 10), color("#526078", "#cbd5e1"));
  details.addSpacer(2);
  addLine(details, timeRange(course), Font.semiboldSystemFont(roomy ? 12 : 11), color("#172033", "#f8fafc"));
}

function upcomingSelection(data) {
  const preferTomorrow = shouldPreferTomorrow(data);
  let day = resolveDay(data, preferTomorrow ? 1 : 0);
  let courses = preferTomorrow ? firstCourses(day, 2) : nextCourses(day, 2);
  if (!courses.length && !preferTomorrow) {
    day = resolveDay(data, 1);
    courses = firstCourses(day, 2);
  }
  return { day, courses };
}

function renderUpcoming(widget, data) {
  const selected = upcomingSelection(data);
  addDateHeader(widget, selected.day, false);
  widget.addSpacer(10);
  if (!selected.courses.length) {
    addLine(widget, "今天没有课程", Font.semiboldSystemFont(13), color("#98a2b3", "#94a3b8"));
    return;
  }
  const current = widget.addStack();
  current.layoutHorizontally();
  addAccentBar(current, selected.courses[0], 54);
  current.addSpacer(9);
  addCourseDetails(current, selected.courses[0], true);
  if (selected.courses.length > 1) {
    widget.addSpacer();
    addLine(widget, "接下来", Font.semiboldSystemFont(10), color("#98a2b3", "#94a3b8"));
    widget.addSpacer(4);
    const next = widget.addStack();
    next.layoutHorizontally();
    addAccentBar(next, selected.courses[1], 28);
    next.addSpacer(9);
    const content = next.addStack();
    content.layoutVertically();
    addLine(content, selected.courses[1].name || "课程", Font.boldSystemFont(13), color("#172033", "#f8fafc"));
    addLine(content, timeRange(selected.courses[1]), Font.systemFont(9), color("#526078", "#cbd5e1"));
  }
}

function renderSplit(widget, data) {
  const selected = upcomingSelection(data);
  addDateHeader(widget, selected.day, false);
  widget.addSpacer(10);
  const row = widget.addStack();
  row.layoutHorizontally();
  const labels = ["当前", "接下来"];
  for (let index = 0; index < 2; index++) {
    if (index > 0) {
      row.addSpacer(12);
      const divider = row.addStack();
      divider.backgroundColor = color("#dfe6ef", "#334155");
      divider.size = new Size(1, 88);
      row.addSpacer(12);
    }
    const column = row.addStack();
    column.layoutVertically();
    column.size = new Size(132, 0);
    addLine(column, labels[index], Font.semiboldSystemFont(11), color("#475467", "#cbd5e1"));
    column.addSpacer(7);
    const course = selected.courses[index];
    if (!course) {
      addLine(column, "暂无课程", Font.systemFont(11), color("#98a2b3", "#94a3b8"));
      continue;
    }
    const courseRow = column.addStack();
    courseRow.layoutHorizontally();
    addAccentBar(courseRow, course, 62);
    courseRow.addSpacer(7);
    addCourseDetails(courseRow, course, false);
  }
}

function addTodayRow(widget, course, large) {
  const row = widget.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  row.backgroundColor = tintColor(course);
  row.cornerRadius = large ? 12 : 7;
  row.setPadding(large ? 8 : 2, large ? 0 : 4, large ? 8 : 2, large ? 8 : 4);
  addAccentBar(row, course, large ? 42 : 16);
  row.addSpacer(large ? 8 : 5);
  if (!large) {
    const summary = [course?.name || "课程", course?.location].filter(Boolean).join(" · ");
    addLine(row, summary, Font.boldSystemFont(10), color("#172033", "#f8fafc"));
    row.addSpacer(6);
    addLine(row, timeRange(course), Font.semiboldSystemFont(9), color("#475467", "#cbd5e1"));
    return;
  }
  const content = row.addStack();
  content.layoutVertically();
  addLine(content, course?.name || "课程", Font.boldSystemFont(13), color("#172033", "#f8fafc"));
  addLine(content, courseMetaText(course), Font.systemFont(9), color("#526078", "#cbd5e1"));
  row.addSpacer();
  const times = row.addStack();
  times.layoutVertically();
  addLine(times, course?.startTime || "--:--", Font.semiboldSystemFont(11), color("#172033", "#f8fafc"));
  addLine(times, course?.endTime || "--:--", Font.semiboldSystemFont(11), color("#172033", "#f8fafc"));
}

function renderToday(widget, data, large) {
  const day = resolveDay(data, 0);
  const courses = firstCourses(day, large ? 6 : 5);
  addDateHeader(widget, day, large);
  widget.addSpacer(large ? 10 : 4);
  if (!courses.length) {
    addLine(widget, "今日暂无课程", Font.semiboldSystemFont(13), color("#98a2b3", "#94a3b8"));
    return;
  }
  courses.forEach((course, index) => {
    if (index > 0) widget.addSpacer(large ? 7 : 2);
    addTodayRow(widget, course, large);
  });
}

function addTwoDayCourse(column, course) {
  const row = column.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  row.backgroundColor = tintColor(course);
  row.cornerRadius = 9;
  row.setPadding(6, 6, 6, 6);
  addAccentBar(row, course, 34);
  row.addSpacer(7);
  const details = row.addStack();
  details.layoutVertically();
  addLine(details, course?.name || "课程", Font.boldSystemFont(11), color("#172033", "#f8fafc"));
  addLine(details, courseMetaText(course), Font.systemFont(8), color("#526078", "#cbd5e1"));
  addLine(details, timeRange(course), Font.semiboldSystemFont(9), color("#172033", "#f8fafc"));
}

function addTwoDayColumn(parent, day) {
  const column = parent.addStack();
  column.layoutVertically();
  column.size = new Size(145, 0);
  addDateHeader(column, day, false);
  column.addSpacer(7);
  const courses = firstCourses(day, 5);
  if (!courses.length) {
    addLine(column, "没有课程", Font.semiboldSystemFont(11), color("#98a2b3", "#94a3b8"));
    return;
  }
  courses.forEach((course, index) => {
    if (index > 0) column.addSpacer(5);
    addTwoDayCourse(column, course);
  });
  if ((day?.courses || []).length > courses.length) {
    column.addSpacer(5);
    addLine(column, "还有 " + (day.courses.length - courses.length) + " 门", Font.systemFont(9), color("#667085", "#cbd5e1"));
  }
}

function renderTwoDay(widget, data) {
  const today = resolveDay(data, 0);
  const tomorrow = resolveDay(data, 1);
  const heading = widget.addStack();
  heading.layoutHorizontally();
  addLine(heading, "两日课表", Font.boldSystemFont(16), color("#172033", "#f8fafc"));
  heading.addSpacer();
  addLine(heading, shortDate(today?.date) + " - " + shortDate(tomorrow?.date), Font.systemFont(10), color("#667085", "#cbd5e1"));
  widget.addSpacer(10);
  const content = widget.addStack();
  content.layoutHorizontally();
  addTwoDayColumn(content, today);
  content.addSpacer(10);
  const divider = content.addStack();
  divider.backgroundColor = color("#dfe6ef", "#334155");
  divider.size = new Size(1, 250);
  content.addSpacer(10);
  addTwoDayColumn(content, tomorrow);
}

function normalizedStyle() {
  if (["upcoming", "near", "临近", "临近课程"].includes(STYLE_PARAMETER)) return "upcoming";
  if (["split", "next", "当前接下来", "当前/接下来"].includes(STYLE_PARAMETER)) return "split";
  if (["today", "今日", "今日课程"].includes(STYLE_PARAMETER)) return "today";
  if (["twoday", "two-day", "两日", "两日课表"].includes(STYLE_PARAMETER)) return "twoday";
  if (FAMILY === "small") return "upcoming";
  if (FAMILY === "large") return "twoday";
  return "today";
}

async function render() {
  const data = await loadSchedule();
  const widget = new ListWidget();
  widget.backgroundColor = color("#f8fbff", "#111827");
  widget.setPadding(12, 12, 12, 12);
  widget.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  const style = normalizedStyle();
  if (style === "twoday" && FAMILY === "large") {
    renderTwoDay(widget, data);
  } else if (style === "today") {
    renderToday(widget, data, FAMILY === "large");
  } else if (style === "split" && FAMILY !== "small") {
    renderSplit(widget, data);
  } else {
    renderUpcoming(widget, data);
  }
  return widget;
}

try {
  const widget = await render();
  if (config.runsInWidget) {
    Script.setWidget(widget);
  } else if (FAMILY === "small") {
    await widget.presentSmall();
  } else if (FAMILY === "large") {
    await widget.presentLarge();
  } else {
    await widget.presentMedium();
  }
} catch (error) {
  const widget = new ListWidget();
  widget.backgroundColor = color("#fff7ed", "#1f2937");
  widget.setPadding(12, 12, 12, 12);
  addLine(widget, "课表读取失败", Font.boldSystemFont(14), color("#9a3412", "#fed7aa"));
  widget.addSpacer(6);
  addLine(widget, String(error.message || error), Font.systemFont(11), color("#7c2d12", "#fdba74"), 3);
  if (config.runsInWidget) Script.setWidget(widget);
  else await widget.presentMedium();
}

Script.complete();
`;
}
