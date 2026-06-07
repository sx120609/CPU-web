import * as cheerio from "cheerio";
import type {
  ScheduleCell,
  ScheduleCourse,
  ScheduleResult,
  SemesterOption,
} from "./jwxtParser";

const DAY_ATTR_TO_NO: Record<string, number> = {
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
  Sunday: 7,
};

const GRADUATE_PAYLOAD_DAY_FIELDS = ["z1", "z2", "z3", "z4", "z5", "z6", "z7"] as const;

export interface GraduateTermOption {
  termcode: string;
  termname: string;
  selected?: boolean;
}

export interface GraduateSchedulePayloadRow {
  mc?: string;
  z1?: string | null;
  z2?: string | null;
  z3?: string | null;
  z4?: string | null;
  z5?: string | null;
  z6?: string | null;
  z7?: string | null;
}

export interface GraduateSchedulePayload {
  week?: string;
  rows?: GraduateSchedulePayloadRow[];
}

export function parseGraduateSchedule(html: string): ScheduleResult {
  const $ = cheerio.load(html);
  const table = $("#kb");
  const headers = table.find("thead th, > tbody > tr:first-child th").map((_, el) => cleanText($(el).text())).get();
  const semesters = parseGraduateSemesters($);
  const currentSemester = semesters.find((item) => item.current)?.value ?? "";
  const cells: ScheduleCell[] = [];
  let currentSlot = 0;

  table.find("tbody > tr").each((_, tr) => {
    const rowLabel = cleanText($(tr).find("> td.C_kc").first().text());
    if (!rowLabel || rowLabel === "无节次") return;

    currentSlot += 1;
    $(tr).find("> td.C_kc_rowspan").each((_, td) => {
      const $td = $(td);
      if (isHiddenCell($td)) return;

      const day = DAY_ATTR_TO_NO[String($td.attr("w") || "").trim()];
      if (!day) return;

      const courses = parseGraduateCellCourses($td);
      if (!courses.length) return;

      const rowSpan = Math.max(1, Number($td.attr("rowspan")) || 1);
      const startSlot = currentSlot;
      const endSlot = currentSlot + rowSpan - 1;
      const bigSlot = Math.max(1, Math.ceil(startSlot / 2));

      cells.push({
        day,
        bigSlot,
        courses: courses.map((course) => ({
          ...course,
          startSlot,
          endSlot,
          slotNote: formatSlotRange(startSlot, endSlot),
        })),
      });
    });
  });

  const { weeks, currentWeek } = buildGraduateWeekOptions(cells);

  return {
    title: $("title").text().trim() || "研究生课表",
    semesters: semesters.length ? semesters : [{
      value: currentSemester || "研究生课表",
      label: currentSemester || "研究生课表",
      current: true,
    }],
    currentSemester: currentSemester || semesters[0]?.value || "研究生课表",
    weeks,
    currentWeek,
    cells: cells.sort((a, b) => a.bigSlot - b.bigSlot || a.day - b.day),
    headers,
  };
}

export function parseGraduateSchedulePayload(
  payload: GraduateSchedulePayload,
  terms: GraduateTermOption[],
  requestedTermCode?: string,
): ScheduleResult {
  const currentTermCode = resolveGraduateCurrentTermCode(terms, requestedTermCode);
  const semesters = parseGraduateSemestersFromTerms(terms, currentTermCode);
  const currentSemester = semesters.find((item) => item.current)?.value
    ?? terms.find((item) => item.termcode === currentTermCode)?.termname
    ?? "研究生课表";
  const cells: ScheduleCell[] = [];
  let currentSlot = 0;

  for (const row of payload.rows ?? []) {
    const rowLabel = cleanText(row?.mc);
    if (!rowLabel || rowLabel === "无节次") continue;

    currentSlot += 1;
    GRADUATE_PAYLOAD_DAY_FIELDS.forEach((field, index) => {
      const courses = parseGraduatePayloadCourses(row?.[field] ?? "");
      if (!courses.length) return;
      const day = index + 1;
      const bigSlot = Math.max(1, Math.ceil(currentSlot / 2));
      cells.push({
        day,
        bigSlot,
        courses: courses.map((course) => ({
          ...course,
          startSlot: currentSlot,
          endSlot: currentSlot,
          slotNote: formatSlotRange(currentSlot, currentSlot),
        })),
      });
    });
  }

  const normalizedCells = normalizeGraduatePayloadCells(cells);
  const { weeks, currentWeek } = buildGraduateWeekOptions(normalizedCells);

  return {
    title: "研究生课表",
    semesters: semesters.length ? semesters : [{
      value: currentSemester,
      label: currentSemester,
      current: true,
    }],
    currentSemester,
    weeks,
    currentWeek,
    cells: normalizedCells,
  };
}

function parseGraduateSemesters($: cheerio.CheerioAPI): SemesterOption[] {
  const items = $(".combobox-item")
    .map((_, el) => {
      const label = cleanText($(el).text());
      if (!label) return null;
      return {
        value: label,
        label,
        current: $(el).hasClass("combobox-item-selected"),
      } satisfies SemesterOption;
    })
    .get()
    .filter((item): item is SemesterOption => Boolean(item));

  const visibleLabel = cleanText(
    $(".textbox.combo .textbox-text").first().val()?.toString()
      ?? $(".textbox.combo .textbox-text").first().attr("value")
      ?? "",
  );

  if (items.length) {
    const resolvedCurrentLabel = resolveGraduateCurrentSemesterLabel(items, visibleLabel);
    return items.map((item) => ({
      ...item,
      current: Boolean(resolvedCurrentLabel) && item.label === resolvedCurrentLabel,
    }));
  }

  const fallback = visibleLabel || cleanText($("input.textbox-text").first().val()?.toString() ?? "");
  return fallback ? [{ value: fallback, label: fallback, current: true }] : [];
}

function parseGraduateSemestersFromTerms(terms: GraduateTermOption[], currentTermCode?: string): SemesterOption[] {
  return terms
    .map((item) => {
      const label = cleanText(item.termname);
      if (!label) return null;
      return {
        value: label,
        label,
        current: item.termcode === currentTermCode || (!currentTermCode && Boolean(item.selected)),
      } satisfies SemesterOption;
    })
    .filter((item): item is SemesterOption => Boolean(item));
}

function parseGraduateCellCourses($td: cheerio.Cheerio<any>): ScheduleCourse[] {
  const html = $td.html() ?? "";
  if (!html.trim()) return [];

  const rawMatches = [...html.matchAll(/([^<]+?)<span>([^<]*)<\/span>\s*([^<]*?)<span>([^<]*)<\/span>/g)];
  const dedup = new Map<string, ScheduleCourse>();

  for (const match of rawMatches) {
    const name = normalizeName(match[1]);
    const weeks = cleanText(match[2]);
    const teacher = cleanText(match[3]) || undefined;
    const location = cleanText(match[4]) || undefined;
    if (!name || !weeks) continue;

    const course: ScheduleCourse = {
      name,
      teacher,
      weeks,
      weekList: parseWeeks(weeks),
      location,
    };
    dedup.set(courseIdentity(course), course);
  }

  return [...dedup.values()];
}

function parseGraduatePayloadCourses(rawText: string): ScheduleCourse[] {
  const source = String(rawText ?? "")
    .replace(/\r?\n+/g, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\u00a0/g, " ");
  const dedup = new Map<string, ScheduleCourse>();
  const matches = [...source.matchAll(/([^\[]+?)\[(.*?)\]\s*([^\[]*?)\[(.*?)\]/g)];

  for (const match of matches) {
    const name = normalizeName(match[1]);
    const weeks = cleanText(match[2]);
    const teacher = cleanText(match[3]) || undefined;
    const location = cleanText(match[4]) || undefined;
    if (!name || !weeks) continue;

    const course: ScheduleCourse = {
      name,
      teacher,
      weeks,
      weekList: parseWeeks(weeks),
      location,
    };
    dedup.set(courseIdentity(course), course);
  }

  return [...dedup.values()];
}

function normalizeName(text: string) {
  return cleanText(text)
    .replace(/^(?:(?:\/)?[a-z]+>)+/gi, "")
    .replace(/^[,\-，、\s]+/, "");
}

function cleanText(text: unknown) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isHiddenCell($td: cheerio.Cheerio<any>) {
  const style = String($td.attr("style") || "").replace(/\s+/g, "").toLowerCase();
  return style.includes("display:none");
}

function courseIdentity(course: ScheduleCourse) {
  return [
    normalizeKeyPart(course.name),
    normalizeKeyPart(course.weeks),
    normalizeKeyPart(course.teacher),
    normalizeKeyPart(course.location),
  ].join("|");
}

function normalizeKeyPart(value?: string) {
  return String(value ?? "").replace(/\s+/g, "").trim();
}

function mergeNumberLists(a: number[] = [], b: number[] = []) {
  return [...new Set([...a, ...b])].sort((x, y) => x - y);
}

function buildGraduateWeekOptions(cells: ScheduleCell[]) {
  const allWeeks = [...new Set(
    cells.flatMap((cell) => cell.courses.flatMap((course) => course.weekList ?? [])),
  )].sort((a, b) => a - b);
  const firstWeek = allWeeks[0] ?? 1;
  const lastWeek = allWeeks[allWeeks.length - 1] ?? firstWeek;
  const weeks = Array.from({ length: Math.max(1, lastWeek) }, (_, index) => {
    const value = String(index + 1);
    return { value, label: `第 ${value} 周`, current: index + 1 === firstWeek };
  });
  return {
    weeks,
    currentWeek: String(firstWeek),
  };
}

function normalizeGraduatePayloadCells(cells: ScheduleCell[]): ScheduleCell[] {
  type CourseEntry = { day: number; bigSlot: number; course: ScheduleCourse };
  const groups = new Map<string, CourseEntry[]>();

  for (const cell of cells) {
    for (const course of cell.courses) {
      const key = [
        cell.day,
        normalizeKeyPart(course.name),
        normalizeKeyPart(course.weeks),
        normalizeKeyPart(course.teacher),
        normalizeKeyPart(course.location),
      ].join("|");
      const list = groups.get(key) ?? [];
      list.push({ day: cell.day, bigSlot: cell.bigSlot, course });
      groups.set(key, list);
    }
  }

  const mergedCells = new Map<string, ScheduleCourse[]>();

  for (const list of groups.values()) {
    const sorted = list.sort((a, b) => {
      const aStart = a.course.startSlot ?? (a.bigSlot * 2 - 1);
      const bStart = b.course.startSlot ?? (b.bigSlot * 2 - 1);
      return a.day - b.day || aStart - bStart;
    });
    const merged: CourseEntry[] = [];

    for (const entry of sorted) {
      const start = entry.course.startSlot ?? (entry.bigSlot * 2 - 1);
      const end = entry.course.endSlot ?? start;
      const prev = merged[merged.length - 1];
      if (prev && prev.day === entry.day && start <= (prev.course.endSlot ?? start) + 1) {
        const nextStart = Math.min(prev.course.startSlot ?? start, start);
        const nextEnd = Math.max(prev.course.endSlot ?? end, end);
        prev.bigSlot = Math.max(1, Math.ceil(nextStart / 2));
        prev.course = {
          ...prev.course,
          startSlot: nextStart,
          endSlot: nextEnd,
          slotNote: formatSlotRange(nextStart, nextEnd),
          weekList: mergeNumberLists(prev.course.weekList, entry.course.weekList),
        };
      } else {
        merged.push({
          day: entry.day,
          bigSlot: Math.max(1, Math.ceil(start / 2)),
          course: {
            ...entry.course,
            startSlot: start,
            endSlot: end,
            slotNote: formatSlotRange(start, end),
          },
        });
      }
    }

    for (const entry of merged) {
      const key = `${entry.day}:${entry.bigSlot}`;
      const courses = mergedCells.get(key) ?? [];
      courses.push(entry.course);
      mergedCells.set(key, courses);
    }
  }

  return [...mergedCells.entries()]
    .map(([key, courses]) => {
      const [day, bigSlot] = key.split(":").map(Number);
      return { day, bigSlot, courses };
    })
    .sort((a, b) => a.bigSlot - b.bigSlot || a.day - b.day);
}

function parseWeeks(text: string): number[] {
  const source = normalizeWeekText(text);
  if (!source) return [];
  const out = new Set<number>();
  const clauses = source.split(/[,，、;；]+/).map((item) => item.trim()).filter(Boolean);

  for (const clause of clauses.length ? clauses : [source]) {
    const kind = parseWeekKind(clause);
    const matches = [...clause.matchAll(/(\d{1,2})\s*(?:[-~至到]\s*(\d{1,2}))?/g)];
    for (const match of matches) {
      const start = Number(match[1]);
      const end = Number(match[2] || match[1]);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      const min = Math.max(1, Math.min(start, end));
      const max = Math.min(64, Math.max(start, end));
      for (let i = min; i <= max; i += 1) {
        if (kind === "odd" && i % 2 === 0) continue;
        if (kind === "even" && i % 2 === 1) continue;
        out.add(i);
      }
    }
  }

  return [...out].sort((a, b) => a - b);
}

function normalizeWeekText(text: string) {
  return String(text ?? "")
    .replace(/[０-９]/g, (char) => String(char.charCodeAt(0) - 0xff10))
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[－–—~～]/g, "-")
    .replace(/第/g, "")
    .replace(/\s+/g, "");
}

function parseWeekKind(text: string): "all" | "odd" | "even" {
  if (/单双周/.test(text)) return "all";
  if (/单周|\(单\)|[^双]单/.test(text)) return "odd";
  if (/双周|\(双\)|双/.test(text)) return "even";
  return "all";
}

function formatSlotRange(start: number, end: number) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return start === end ? `${pad(start)}节` : `${pad(start)}-${pad(end)}节`;
}

type GraduateSemesterSeason = "first" | "second";

interface GraduateSemesterDescriptor {
  startYear: number;
  endYear: number;
  season: GraduateSemesterSeason;
}

function resolveGraduateCurrentTermCode(terms: GraduateTermOption[], requestedTermCode?: string) {
  const cleanRequested = cleanText(requestedTermCode);
  if (cleanRequested && terms.some((item) => item.termcode === cleanRequested)) return cleanRequested;
  return terms.find((item) => item.selected)?.termcode ?? terms[0]?.termcode ?? cleanRequested;
}

function resolveGraduateCurrentSemesterLabel(items: SemesterOption[], visibleLabel: string) {
  if (visibleLabel) return visibleLabel;

  const selectedLabel = items.find((item) => item.current)?.label ?? "";
  const inferredLabel = inferGraduateCurrentSemesterLabel(items.map((item) => item.label));
  if (!selectedLabel) return inferredLabel || items[0]?.label || "";
  if (!inferredLabel) return selectedLabel;

  const selectedDescriptor = parseGraduateSemesterDescriptor(selectedLabel);
  const inferredDescriptor = parseGraduateSemesterDescriptor(inferredLabel);
  if (!selectedDescriptor || !inferredDescriptor) return selectedLabel;

  const yearGap = Math.abs(selectedDescriptor.startYear - inferredDescriptor.startYear);
  if (yearGap >= 2) return inferredLabel;
  return selectedLabel;
}

function inferGraduateCurrentSemesterLabel(labels: string[]) {
  const inferred = inferGraduateSemesterDescriptorFromToday();
  if (!inferred) return labels[0] || "";
  return labels.find((label) => {
    const descriptor = parseGraduateSemesterDescriptor(label);
    return descriptor
      && descriptor.startYear === inferred.startYear
      && descriptor.endYear === inferred.endYear
      && descriptor.season === inferred.season;
  }) ?? "";
}

function inferGraduateSemesterDescriptorFromToday(): GraduateSemesterDescriptor | null {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const year = value("year");
  const month = value("month");
  if (!year || !month) return null;

  if (month >= 9) {
    return { startYear: year, endYear: year + 1, season: "first" };
  }
  if (month === 1) {
    return { startYear: year - 1, endYear: year, season: "first" };
  }
  return { startYear: year - 1, endYear: year, season: "second" };
}

function parseGraduateSemesterDescriptor(label: string): GraduateSemesterDescriptor | null {
  const normalized = cleanText(label);
  const match = normalized.match(/(\d{4})-(\d{4})/);
  if (!match) return null;

  const season = /第一学期|第1学期|1学期|一学期|秋学期|秋/.test(normalized)
    ? "first"
    : /第二学期|第2学期|2学期|二学期|春学期|春/.test(normalized)
      ? "second"
      : null;
  if (!season) return null;

  return {
    startYear: Number(match[1]),
    endYear: Number(match[2]),
    season,
  };
}
