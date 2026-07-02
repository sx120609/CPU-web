export function buildScriptableWidgetScript(endpoint: string) {
  return `// 药大课表小组件
// 复制到 Scriptable 后，添加桌面小组件并选择本脚本。
const API_ENDPOINT = ${JSON.stringify(endpoint)};
const MINUTES_22_00 = 22 * 60;

async function loadSchedule() {
  const req = new Request(API_ENDPOINT);
  req.timeoutInterval = 20;
  const body = await req.loadJSON();
  if (!body || body.code !== 0) {
    throw new Error(body?.message || "课表读取失败");
  }
  return body.data;
}

function color(light, dark) {
  return Color.dynamic(new Color(light), new Color(dark));
}

function addLine(stack, text, font, colorValue) {
  const line = stack.addText(String(text || ""));
  line.font = font;
  line.textColor = colorValue;
  line.lineLimit = 1;
  return line;
}

function coursePrimaryText(course, withEnd) {
  const end = withEnd && course.endTime ? "-" + course.endTime : "";
  const time = course.startTime ? course.startTime + end + " " : "";
  return time + (course.name || "课程");
}

function courseMetaText(course) {
  const parts = [];
  if (course.location) parts.push("@" + course.location);
  if (course.teacher) parts.push(course.teacher);
  if (course.note) parts.push(course.note);
  return parts.join(" · ");
}

function shortDate(value) {
  const match = String(value || "").match(/-(\\d{2})-(\\d{2})$/);
  return match ? match[1] + "/" + match[2] : "";
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

function resolveDay(data, offset) {
  const target = deviceDate(offset);
  const days = data.days || [];
  const byDate = days.find((day) => String(day.date || "") === target);
  if (byDate) return byDate;
  const targetDay = deviceDayOfWeek(offset);
  return days.find((day) => Number(day.day) === targetDay) || (offset === 0 ? data.today : null);
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
    const start = parseMinutes(course?.startTime);
    return start >= now || (start < 0 && courseEndMinutes(course) >= now);
  }).slice(0, limit);
}

function dayTitle(day, fallback) {
  const date = shortDate(day?.date);
  return (day?.label || fallback) + (date ? " " + date : "");
}

function header(widget, data, day, modeText) {
  addLine(widget, "药大课表", Font.boldSystemFont(15), color("#172033", "#f8fafc"));
  const dateText = shortDate(day?.date);
  const sub = "第 " + (data.week || "--") + " 周 · " + modeText + (dateText ? " " + dateText : "");
  addLine(widget, sub, Font.systemFont(11), color("#64748b", "#cbd5e1"));
  widget.addSpacer(8);
}

function footer(widget, data) {
  widget.addSpacer();
  const updated = new Date(data.cachedAt || data.generatedAt || Date.now());
  const updatePrefix = data.stale ? "缓存 " : "更新 ";
  addLine(widget, updatePrefix + updated.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }), Font.systemFont(9), color("#98a2b3", "#94a3b8"));
}

function renderSmall(widget, data) {
  let preferTomorrow = shouldPreferTomorrow(data);
  let day = resolveDay(data, preferTomorrow ? 1 : 0);
  let courses = preferTomorrow ? firstCourses(day, 1) : nextCourses(day, 1);
  if (!courses.length && !preferTomorrow) {
    preferTomorrow = true;
    day = resolveDay(data, 1);
    courses = firstCourses(day, 1);
  }
  header(widget, data, day, preferTomorrow ? "明日课程" : "今日课程");
  if (!courses.length) {
    addLine(widget, preferTomorrow ? "明天没有课程" : "今日暂无课程", Font.mediumSystemFont(13), color("#475467", "#e2e8f0"));
  } else {
    const next = courses[0];
    const time = (next.startTime || "") + (next.endTime ? "-" + next.endTime : "");
    addLine(widget, (preferTomorrow ? "明日下节 " : "下节 ") + time, Font.systemFont(10), color("#168776", "#5eead4"));
    addLine(widget, next.name || "课程", Font.boldSystemFont(13), color("#172033", "#f8fafc"));
    addLine(widget, courseMetaText(next) || "地点待确认", Font.systemFont(10), color("#667085", "#cbd5e1"));
  }
  footer(widget, data);
}

function renderCourseList(stack, title, courses, emptyText) {
  addLine(stack, title, Font.boldSystemFont(12), color("#168776", "#5eead4"));
  stack.addSpacer(4);
  if (!courses.length) {
    addLine(stack, emptyText || "没有课程", Font.mediumSystemFont(11), color("#475467", "#e2e8f0"));
    return;
  }
  for (const course of courses) {
    addLine(stack, coursePrimaryText(course, true), Font.mediumSystemFont(11), color("#1f2937", "#f8fafc"));
    const meta = courseMetaText(course);
    if (meta) {
      addLine(stack, meta, Font.systemFont(8), color("#7a8496", "#94a3b8"));
    }
    stack.addSpacer(4);
  }
}

function renderSingleDay(widget, data, day, title, limit) {
  header(widget, data, day, title);
  renderCourseList(widget, dayTitle(day, title), firstCourses(day, limit), "没有课程");
  footer(widget, data);
}

function renderHorizontalSplit(widget, data, topDay, bottomDay, topTitle, bottomTitle) {
  header(widget, data, topDay, topTitle);
  renderCourseList(widget, dayTitle(topDay, topTitle), firstCourses(topDay, 6), "没有课程");
  widget.addSpacer(6);
  const divider = widget.addStack();
  divider.backgroundColor = color("#e2eaf4", "#334155");
  divider.size = new Size(320, 1);
  widget.addSpacer(6);
  renderCourseList(widget, dayTitle(bottomDay, bottomTitle), firstCourses(bottomDay, 5), "没有课程");
  footer(widget, data);
}

async function render() {
  const data = await loadSchedule();
  const widget = new ListWidget();
  widget.backgroundColor = color("#f8fbff", "#111827");
  widget.setPadding(12, 12, 12, 12);
  widget.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

  const preferTomorrow = shouldPreferTomorrow(data);
  const leftDay = resolveDay(data, preferTomorrow ? 1 : 0);
  const rightDay = resolveDay(data, preferTomorrow ? 2 : 1);

  if (config.widgetFamily === "small") {
    renderSmall(widget, data);
  } else if (config.widgetFamily === "large") {
    renderHorizontalSplit(widget, data, leftDay, rightDay, preferTomorrow ? "明日时间线" : "今日时间线", preferTomorrow ? "后天预览" : "明日预览");
  } else {
    renderSingleDay(widget, data, leftDay, preferTomorrow ? "明日课程" : "今日课程", 6);
  }
  return widget;
}

try {
  const widget = await render();
  if (config.runsInWidget) {
    Script.setWidget(widget);
  } else {
    await widget.presentMedium();
  }
} catch (error) {
  const widget = new ListWidget();
  widget.backgroundColor = color("#fff7ed", "#1f2937");
  widget.setPadding(12, 12, 12, 12);
  addLine(widget, "课表读取失败", Font.boldSystemFont(14), color("#9a3412", "#fed7aa"));
  widget.addSpacer(6);
  addLine(widget, String(error.message || error), Font.systemFont(11), color("#7c2d12", "#fdba74"));
  if (config.runsInWidget) Script.setWidget(widget);
  else await widget.presentMedium();
}

Script.complete();
`;
}
