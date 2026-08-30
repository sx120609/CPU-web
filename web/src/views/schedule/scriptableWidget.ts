export function buildScriptableWidgetScript(endpoint: string) {
  return `// 药大课表小组件
// 小组件参数：upcoming（临近课程）、split（当前/接下来）、today（今日课程）、week（整周课表）。
const API_ENDPOINT = ${JSON.stringify(endpoint)};
const MINUTES_22_00 = 22 * 60;
const FAMILY = config.widgetFamily || "medium";
const STYLE_PARAMETER = String(args.widgetParameter || "").trim().toLowerCase();
const ACCENTS = ["#e85b4b", "#4a78f2", "#8b5cf6", "#17a69a", "#e0a224", "#ec70a1"];
const TINTS = ["#fdece9", "#eaf0ff", "#f2ecff", "#e5f8f5", "#fff7e0", "#fdebf4"];
const DARK_TINTS = ["#42221f", "#1e2d52", "#32244f", "#153c38", "#403418", "#48243a"];
const SLOT_STARTS = ["08:00", "08:55", "09:55", "10:50", "13:30", "14:25", "15:25", "16:20", "18:30", "19:25", "20:20"];
const SLOT_ENDS = ["08:45", "09:40", "10:40", "11:35", "14:15", "15:10", "16:10", "17:05", "19:15", "20:10", "21:05"];

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
  row.cornerRadius = large ? 12 : 10;
  row.setPadding(large ? 8 : 7, 0, large ? 8 : 7, large ? 8 : 7);
  addAccentBar(row, course, large ? 42 : 38);
  row.addSpacer(8);
  const content = row.addStack();
  content.layoutVertically();
  addLine(content, course?.name || "课程", Font.boldSystemFont(large ? 13 : 12), color("#172033", "#f8fafc"));
  addLine(content, courseMetaText(course), Font.systemFont(large ? 9 : 8), color("#526078", "#cbd5e1"));
  row.addSpacer();
  const times = row.addStack();
  times.layoutVertically();
  addLine(times, course?.startTime || "--:--", Font.semiboldSystemFont(large ? 11 : 10), color("#172033", "#f8fafc"));
  addLine(times, course?.endTime || "--:--", Font.semiboldSystemFont(large ? 11 : 10), color("#172033", "#f8fafc"));
}

function renderToday(widget, data, large) {
  const day = resolveDay(data, 0);
  const courses = firstCourses(day, large ? 6 : 2);
  addDateHeader(widget, day, large);
  widget.addSpacer(large ? 10 : 8);
  if (!courses.length) {
    addLine(widget, "今日暂无课程", Font.semiboldSystemFont(13), color("#98a2b3", "#94a3b8"));
    return;
  }
  courses.forEach((course, index) => {
    if (index > 0) widget.addSpacer(large ? 7 : 6);
    addTodayRow(widget, course, large);
  });
}

function roundedRect(ctx, rect, radius, fill, stroke) {
  const path = new Path();
  path.addRoundedRect(rect, radius, radius);
  ctx.addPath(path);
  ctx.setFillColor(fill);
  ctx.fillPath();
  if (stroke) {
    ctx.addPath(path);
    ctx.setStrokeColor(stroke);
    ctx.setLineWidth(2);
    ctx.strokePath();
  }
}

function canvasText(ctx, text, rect, font, value, align) {
  ctx.setFont(font);
  ctx.setTextColor(value);
  if (align === "center") ctx.setTextAlignedCenter();
  else if (align === "right") ctx.setTextAlignedRight();
  else ctx.setTextAlignedLeft();
  ctx.drawTextInRect(String(text || ""), rect);
}

function weekDays(data) {
  const source = data.weekDays?.length ? data.weekDays : data.days || [];
  return Array.from({ length: 7 }, (_, index) => source.find((day) => Number(day.day) === index + 1) || null);
}

function weekRange(days) {
  const first = days.find(Boolean);
  const last = [...days].reverse().find(Boolean);
  const start = shortDate(first?.date);
  const end = shortDate(last?.date);
  return start && end ? start + " - " + end : start || end;
}

function compactCourseName(value) {
  const text = String(value || "课程");
  if (text.length <= 8) return text.length > 4 ? text.slice(0, 4) + "\\n" + text.slice(4) : text;
  return text.slice(0, 4) + "\\n" + text.slice(4, 7) + "…";
}

function drawWeekImage(data) {
  const width = 920;
  const height = 920;
  const summaryHeight = 70;
  const labelWidth = 80;
  const headerHeight = 70;
  const columnWidth = (width - labelWidth) / 7;
  const rowHeight = (height - summaryHeight - headerHeight) / 11;
  const days = weekDays(data);
  const ctx = new DrawContext();
  ctx.size = new Size(width, height);
  ctx.opaque = true;
  ctx.respectScreenScale = false;
  ctx.setFillColor(color("#f8fbff", "#111827"));
  ctx.fillRect(new Rect(0, 0, width, height));

  const week = data.displayWeek || data.week;
  canvasText(ctx, week ? "第 " + week + " 周" : "整周课表", new Rect(30, 16, 300, 45), Font.boldSystemFont(34), color("#4338ca", "#a5b4fc"), "left");
  canvasText(ctx, weekRange(days), new Rect(580, 18, 314, 42), Font.systemFont(23), color("#667085", "#cbd5e1"), "right");
  canvasText(ctx, "节次", new Rect(4, summaryHeight + 22, labelWidth - 8, 32), Font.boldSystemFont(22), color("#667085", "#cbd5e1"), "center");

  const labels = ["一", "二", "三", "四", "五", "六", "日"];
  days.forEach((day, index) => {
    const left = labelWidth + index * columnWidth + 4;
    const rect = new Rect(left, summaryHeight + 2, columnWidth - 8, headerHeight - 6);
    const today = day?.isToday === true;
    roundedRect(ctx, rect, 15, today ? color("#e4f8f4", "#17443c") : color("#f8fbff", "#111827"), today ? color("#2cb39a", "#5eead4") : color("#dce6ee", "#334155"));
    canvasText(ctx, labels[index], new Rect(left, summaryHeight + 11, columnWidth - 8, 30), Font.boldSystemFont(25), today ? color("#0c846f", "#5eead4") : color("#2f3b4e", "#f8fafc"), "center");
    canvasText(ctx, shortDate(day?.date), new Rect(left, summaryHeight + 39, columnWidth - 8, 24), Font.systemFont(18), color("#667085", "#cbd5e1"), "center");
  });

  for (let slot = 0; slot < 11; slot++) {
    const top = summaryHeight + headerHeight + slot * rowHeight;
    canvasText(ctx, String(slot + 1), new Rect(4, top + 7, labelWidth - 8, 24), Font.boldSystemFont(22), color("#1d2939", "#f8fafc"), "center");
    canvasText(ctx, SLOT_STARTS[slot] + "\\n" + SLOT_ENDS[slot], new Rect(4, top + 31, labelWidth - 8, 34), Font.systemFont(13), color("#667085", "#cbd5e1"), "center");
    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
      const left = labelWidth + dayIndex * columnWidth + 4;
      roundedRect(ctx, new Rect(left, top + 3, columnWidth - 8, rowHeight - 7), 11, color("#fafcfe", "#16202f"), color("#dce6ee", "#334155"));
    }
  }

  days.forEach((day, dayIndex) => {
    (day?.courses || []).forEach((course) => {
      const start = Math.max(1, Math.min(11, Number(course.startSlot) || 1));
      const end = Math.max(start, Math.min(11, Number(course.endSlot) || start));
      const left = labelWidth + dayIndex * columnWidth + 7;
      const top = summaryHeight + headerHeight + (start - 1) * rowHeight + 6;
      const courseHeight = (end - start + 1) * rowHeight - 13;
      const index = paletteIndex(course);
      const rect = new Rect(left, top, columnWidth - 14, courseHeight);
      roundedRect(ctx, rect, 13, color(TINTS[index], DARK_TINTS[index]), color(ACCENTS[index]));
      canvasText(ctx, compactCourseName(course.name), new Rect(left + 5, top + Math.max(8, courseHeight / 2 - 28), columnWidth - 24, Math.min(58, courseHeight - 8)), Font.boldSystemFont(20), color("#27364a", "#f8fafc"), "center");
      if (course.location && courseHeight > 88) {
        canvasText(ctx, "@" + course.location, new Rect(left + 5, top + courseHeight - 29, columnWidth - 24, 22), Font.systemFont(15), color("#526078", "#cbd5e1"), "center");
      }
    });
  });
  return ctx.getImage();
}

function normalizedStyle() {
  if (["upcoming", "near", "临近", "临近课程"].includes(STYLE_PARAMETER)) return "upcoming";
  if (["split", "next", "当前接下来", "当前/接下来"].includes(STYLE_PARAMETER)) return "split";
  if (["today", "今日", "今日课程"].includes(STYLE_PARAMETER)) return "today";
  if (["week", "weekly", "整周", "整周课表"].includes(STYLE_PARAMETER)) return "week";
  if (FAMILY === "small") return "upcoming";
  if (FAMILY === "large") return "week";
  return "split";
}

async function render() {
  const data = await loadSchedule();
  const widget = new ListWidget();
  widget.backgroundColor = color("#f8fbff", "#111827");
  widget.setPadding(12, 12, 12, 12);
  widget.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  const style = normalizedStyle();
  if (style === "week" && FAMILY === "large") {
    widget.setPadding(0, 0, 0, 0);
    widget.backgroundImage = drawWeekImage(data);
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
