import { Resvg } from "@resvg/resvg-js";
import { existsSync } from "node:fs";
import type { WechatScheduleResult } from "./wechatSchedule";

const SLOTS = [
  { no: 1, start: "08:00", end: "08:45" },
  { no: 2, start: "08:55", end: "09:40" },
  { no: 3, start: "09:55", end: "10:40" },
  { no: 4, start: "10:50", end: "11:35" },
  { no: 5, start: "13:30", end: "14:15" },
  { no: 6, start: "14:25", end: "15:10" },
  { no: 7, start: "15:25", end: "16:10" },
  { no: 8, start: "16:20", end: "17:05" },
  { no: 9, start: "18:30", end: "19:15" },
  { no: 10, start: "19:25", end: "20:10" },
  { no: 11, start: "20:20", end: "21:05" },
];
const FONT_FILES = [
  "C:/Windows/Fonts/msyh.ttc",
  "C:/Windows/Fonts/msyhbd.ttc",
  "C:/Windows/Fonts/simhei.ttf",
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
  "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
].filter(existsSync);
const WIDTH = 1260;
const SIDE = 34;
const HEADER_HEIGHT = 146;
const GRID_HEAD_HEIGHT = 90;
const SLOT_HEIGHT = 126;
const GAP = 7;
const FOOTER_HEIGHT = 72;
const AXIS_WIDTH = 102;

export function renderWechatScheduleImage(result: WechatScheduleResult) {
  const svg = result.query.scope === "week" ? renderWeekSvg(result) : renderDaySvg(result);
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: WIDTH },
    font: {
      loadSystemFonts: true,
      fontFiles: FONT_FILES,
      defaultFontFamily: "Microsoft YaHei",
    },
  });
  return resvg.render().asPng();
}

function renderWeekSvg(result: WechatScheduleResult) {
  const height = HEADER_HEIGHT + GRID_HEAD_HEIGHT + SLOTS.length * SLOT_HEIGHT + (SLOTS.length - 1) * GAP + FOOTER_HEIGHT + 34;
  const gridWidth = WIDTH - SIDE * 2;
  const dayWidth = (gridWidth - AXIS_WIDTH - GAP * 7) / 7;
  const headY = HEADER_HEIGHT;
  const bodyY = headY + GRID_HEAD_HEIGHT;
  const days = normalizeDays(result.days);
  const courses = days.flatMap((day) => day.courses.map((course: any) => ({ ...course, day: day.day })));
  const defs = renderCourseGradients(courses);
  const headCells = days.map((day, index) => {
    const x = SIDE + AXIS_WIDTH + GAP + index * (dayWidth + GAP);
    return `
      <rect x="${n(x)}" y="${headY + 7}" width="${n(dayWidth)}" height="${GRID_HEAD_HEIGHT - 14}" rx="16" fill="${day.isToday ? "#173f38" : "#12332c"}" stroke="${day.isToday ? "#35d6b3" : "#31564e"}" stroke-width="${day.isToday ? 3 : 1.5}" />
      <text x="${n(x + dayWidth / 2)}" y="${headY + 39}" text-anchor="middle" font-size="22" font-weight="800" fill="${day.isToday ? "#54e2c5" : "#d9ebe6"}">${escapeXml(day.label.replace("周", ""))}</text>
      <text x="${n(x + dayWidth / 2)}" y="${headY + 65}" text-anchor="middle" font-size="17" font-weight="650" fill="#9fbcb4">${escapeXml(shortDate(day.date))}</text>`;
  }).join("");
  const cells = SLOTS.flatMap((slot, slotIndex) => {
    const y = bodyY + slotIndex * (SLOT_HEIGHT + GAP);
    const axis = `
      <text x="${SIDE + AXIS_WIDTH / 2}" y="${y + 38}" text-anchor="middle" font-size="25" font-weight="850" fill="#f4fbf8">${slot.no}</text>
      <text x="${SIDE + AXIS_WIDTH / 2}" y="${y + 70}" text-anchor="middle" font-size="16" font-weight="650" fill="#9fbcb4">${slot.start}</text>
      <text x="${SIDE + AXIS_WIDTH / 2}" y="${y + 94}" text-anchor="middle" font-size="16" font-weight="650" fill="#9fbcb4">${slot.end}</text>`;
    const dayCells = days.map((day, dayIndex) => {
      const x = SIDE + AXIS_WIDTH + GAP + dayIndex * (dayWidth + GAP);
      return `<rect x="${n(x)}" y="${n(y)}" width="${n(dayWidth)}" height="${SLOT_HEIGHT}" rx="14" fill="${day.isToday ? "#153a32" : "#102f28"}" stroke="#315149" stroke-width="1.5" />`;
    }).join("");
    return axis + dayCells;
  }).join("");
  const blocks = courses.map((course: any) => {
    const startSlot = clampSlot(course.startSlot);
    const endSlot = Math.max(startSlot, clampSlot(course.endSlot));
    const x = SIDE + AXIS_WIDTH + GAP + (Number(course.day) - 1) * (dayWidth + GAP) + 2;
    const y = bodyY + (startSlot - 1) * (SLOT_HEIGHT + GAP) + 2;
    const h = (endSlot - startSlot + 1) * SLOT_HEIGHT + (endSlot - startSlot) * GAP - 4;
    const w = dayWidth - 4;
    const tone = courseTone(course.name);
    const nameLines = wrapText(String(course.name || "未命名课程"), 5, Math.max(1, Math.min(5, Math.floor((h - 36) / 31))));
    const meta = String(course.location || course.teacher || "").trim();
    const nameHeight = nameLines.length * 29;
    const showMeta = Boolean(meta) && h >= nameHeight + 52;
    const totalHeight = nameHeight + (showMeta ? 28 : 0);
    const firstY = y + Math.max(28, (h - totalHeight) / 2 + 23);
    return `
      <rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="16" fill="url(#${tone.id})" stroke="${tone.border}" stroke-width="2.5" />
      ${renderCenteredLines(nameLines, x + w / 2, firstY, 25, 29, tone.text, 850)}
      ${showMeta ? `<text x="${n(x + w / 2)}" y="${n(firstY + nameHeight + 2)}" text-anchor="middle" font-size="18" font-weight="750" fill="${tone.text}" opacity="0.92">${escapeXml(`@${truncate(meta, 8)}`)}</text>` : ""}`;
  }).join("");
  return svgFrame(height, result, defs, `
    <text x="${SIDE + AXIS_WIDTH / 2}" y="${headY + 53}" text-anchor="middle" font-size="19" font-weight="750" fill="#9fbcb4">节次</text>
    ${headCells}${cells}${blocks}`);
}

function renderDaySvg(result: WechatScheduleResult) {
  const height = HEADER_HEIGHT + GRID_HEAD_HEIGHT + SLOTS.length * SLOT_HEIGHT + (SLOTS.length - 1) * GAP + FOOTER_HEIGHT + 34;
  const headY = HEADER_HEIGHT;
  const bodyY = headY + GRID_HEAD_HEIGHT;
  const courseX = SIDE + AXIS_WIDTH + GAP;
  const courseWidth = WIDTH - SIDE - courseX;
  const day = result.day || { courses: [] };
  const courses = Array.isArray(day.courses) ? day.courses : [];
  const defs = renderCourseGradients(courses);
  const cells = SLOTS.map((slot, index) => {
    const y = bodyY + index * (SLOT_HEIGHT + GAP);
    return `
      <text x="${SIDE + AXIS_WIDTH / 2}" y="${y + 38}" text-anchor="middle" font-size="25" font-weight="850" fill="#f4fbf8">${slot.no}</text>
      <text x="${SIDE + AXIS_WIDTH / 2}" y="${y + 70}" text-anchor="middle" font-size="16" font-weight="650" fill="#9fbcb4">${slot.start}</text>
      <text x="${SIDE + AXIS_WIDTH / 2}" y="${y + 94}" text-anchor="middle" font-size="16" font-weight="650" fill="#9fbcb4">${slot.end}</text>
      <rect x="${courseX}" y="${y}" width="${courseWidth}" height="${SLOT_HEIGHT}" rx="16" fill="#102f28" stroke="#315149" stroke-width="1.5" />`;
  }).join("");
  const blocks = courses.map((course: any) => {
    const startSlot = clampSlot(course.startSlot);
    const endSlot = Math.max(startSlot, clampSlot(course.endSlot));
    const x = courseX + 2;
    const y = bodyY + (startSlot - 1) * (SLOT_HEIGHT + GAP) + 2;
    const h = (endSlot - startSlot + 1) * SLOT_HEIGHT + (endSlot - startSlot) * GAP - 4;
    const w = courseWidth - 4;
    const tone = courseTone(course.name);
    const detail = [course.location ? `@${course.location}` : "", course.teacher || ""].filter(Boolean).join("  ");
    const nameLines = wrapText(String(course.name || "未命名课程"), 22, Math.max(1, Math.min(3, Math.floor(h / 42))));
    const startY = y + Math.max(43, (h - nameLines.length * 40 - (detail ? 32 : 0)) / 2 + 32);
    return `
      <rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="22" fill="url(#${tone.id})" stroke="${tone.border}" stroke-width="3" />
      ${renderLeftLines(nameLines, x + 30, startY, 34, 40, tone.text, 850)}
      ${detail ? `<text x="${n(x + 30)}" y="${n(startY + nameLines.length * 40 + 2)}" font-size="23" font-weight="720" fill="${tone.text}" opacity="0.92">${escapeXml(truncate(detail, 38))}</text>` : ""}`;
  }).join("");
  const label = String(day.label || weekdayLabel(day.day));
  return svgFrame(height, result, defs, `
    <rect x="${courseX}" y="${headY + 7}" width="${courseWidth}" height="${GRID_HEAD_HEIGHT - 14}" rx="18" fill="#153a32" stroke="#35d6b3" stroke-width="2.5" />
    <text x="${courseX + 28}" y="${headY + 42}" font-size="25" font-weight="850" fill="#54e2c5">${escapeXml(label)}</text>
    <text x="${courseX + 28}" y="${headY + 68}" font-size="18" font-weight="650" fill="#a9c8c0">${escapeXml(String(day.date || ""))}</text>
    <text x="${SIDE + AXIS_WIDTH / 2}" y="${headY + 53}" text-anchor="middle" font-size="19" font-weight="750" fill="#9fbcb4">节次</text>
    ${cells}${blocks}`);
}

function svgFrame(height: number, result: WechatScheduleResult, defs: string, content: string) {
  const cacheText = result.cached ? "最近同步缓存" : "教务实时同步";
  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="page-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b211d"/><stop offset="1" stop-color="#102c26"/></linearGradient>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#020b09" flood-opacity="0.32"/></filter>
      ${defs}
    </defs>
    <rect width="${WIDTH}" height="${height}" fill="url(#page-bg)" />
    <text x="${SIDE}" y="62" font-size="35" font-weight="880" fill="#f3fbf8">${escapeXml(result.query.label)}</text>
    <text x="${SIDE}" y="105" font-size="22" font-weight="650" fill="#9fbcb4">${escapeXml(result.scopeDescription)}</text>
    <rect x="${WIDTH - SIDE - 185}" y="44" width="185" height="52" rx="26" fill="#153b33" stroke="#327565" />
    <text x="${WIDTH - SIDE - 92.5}" y="78" text-anchor="middle" font-size="19" font-weight="780" fill="#5ce0c3">拾小间课表</text>
    ${content}
    <line x1="${SIDE}" y1="${height - FOOTER_HEIGHT}" x2="${WIDTH - SIDE}" y2="${height - FOOTER_HEIGHT}" stroke="#2c4d45" />
    <text x="${SIDE}" y="${height - 28}" font-size="18" font-weight="650" fill="#789c93">课程安排以学校教务系统为准</text>
    <text x="${WIDTH - SIDE}" y="${height - 28}" text-anchor="end" font-size="18" font-weight="700" fill="#789c93">${cacheText}</text>
  </svg>`;
}

function renderCourseGradients(courses: any[]) {
  const seen = new Map<string, ReturnType<typeof courseTone>>();
  for (const course of courses) {
    const tone = courseTone(course?.name);
    seen.set(tone.id, tone);
  }
  return [...seen.values()].map((tone) => (
    `<linearGradient id="${tone.id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${tone.top}"/><stop offset="1" stop-color="${tone.bottom}"/></linearGradient>`
  )).join("");
}

function courseTone(name: unknown) {
  let hash = 0;
  const seed = String(name || "课程").trim().replace(/\s+/g, " ");
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  const hue = hash % 360;
  const saturation = Math.min(82, 58 + ((hash >>> 8) % 18) + 4);
  return {
    id: `course-${hash.toString(16)}`,
    top: `hsl(${hue}, ${saturation}%, 34%)`,
    bottom: `hsl(${hue}, ${saturation}%, 24%)`,
    border: `hsl(${hue}, ${Math.min(86, saturation + 4)}%, 72%)`,
    text: "#f8fffd",
  };
}

function normalizeDays(value: unknown) {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length: 7 }, (_, index) => {
    const day = source.find((item: any) => Number(item?.day) === index + 1) || source[index] || {};
    return {
      ...day,
      day: index + 1,
      label: String(day?.label || weekdayLabel(index + 1)),
      date: String(day?.date || ""),
      courses: Array.isArray(day?.courses) ? day.courses : [],
    };
  });
}

function wrapText(value: string, maxUnits: number, maxLines: number) {
  const chars = Array.from(value.trim());
  const lines: string[] = [];
  let line = "";
  let units = 0;
  for (const char of chars) {
    const nextUnits = /[\u0000-\u00ff]/u.test(char) ? 0.56 : 1;
    if (line && units + nextUnits > maxUnits) {
      lines.push(line);
      line = "";
      units = 0;
      if (lines.length >= maxLines) break;
    }
    line += char;
    units += nextUnits;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.join("").length < chars.length && lines.length) lines[lines.length - 1] = `${lines.at(-1)!.replace(/…$/u, "").slice(0, -1)}…`;
  return lines.length ? lines : ["课程"];
}

function renderCenteredLines(lines: string[], x: number, y: number, size: number, lineHeight: number, color: string, weight: number) {
  return lines.map((line, index) => `<text x="${n(x)}" y="${n(y + index * lineHeight)}" text-anchor="middle" font-size="${size}" font-weight="${weight}" fill="${color}">${escapeXml(line)}</text>`).join("");
}

function renderLeftLines(lines: string[], x: number, y: number, size: number, lineHeight: number, color: string, weight: number) {
  return lines.map((line, index) => `<text x="${n(x)}" y="${n(y + index * lineHeight)}" font-size="${size}" font-weight="${weight}" fill="${color}">${escapeXml(line)}</text>`).join("");
}

function clampSlot(value: unknown) {
  return Math.max(1, Math.min(SLOTS.length, Number(value) || 1));
}

function shortDate(value: unknown) {
  return String(value || "").replace(/^\d{4}-/u, "").replace("-", "/") || "--";
}

function weekdayLabel(value: unknown) {
  return ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"][Number(value)] || "课程";
}

function truncate(value: string, length: number) {
  const chars = Array.from(value);
  return chars.length > length ? `${chars.slice(0, Math.max(1, length - 1)).join("")}…` : value;
}

function escapeXml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&apos;" })[char] || char);
}

function n(value: number) {
  return Number(value.toFixed(2));
}
