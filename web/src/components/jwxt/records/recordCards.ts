// 把 /api/jwxt/records 各类数据整理成统一的卡片条目，页面只管排版。

export type RecordKind =
  | "level-exams"
  | "term-courses"
  | "enrollment"
  | "textbooks"
  | "graduation-audit"
  | "election-rounds"
  | "student-status"
  | "major-transfer"
  | "retake-options"
  | "grade-summary"
  | "free-rooms"
  | "timetable-search"
  | "class-timetable";

/** 与成绩、培养方案页的标签配色一致：必修红、限选橙、公选绿、选修主色、其余灰。 */
export type RecordTagType = "danger" | "warning" | "success" | "primary" | "info";

export interface RecordCard {
  key: string;
  title: string;
  sub?: string;
  badge?: string;
  badgeType?: RecordTagType;
  value?: string;
  valueLabel?: string;
  meta: string[];
  lines: string[];
}

export interface RecordCardGroup {
  key: string;
  label: string;
  note?: string;
  cards: RecordCard[];
}

type Row = Record<string, any>;

function compact(values: Array<string | false | null | undefined>) {
  return values.filter((value): value is string => Boolean(value));
}

function credit(value: unknown) {
  return typeof value === "number" ? `${value} 学分` : "";
}

function hours(value: unknown) {
  return typeof value === "number" && value > 0 ? `${value} 学时` : "";
}

export function categoryTagType(value?: string): RecordTagType {
  if (!value) return "info";
  if (/必修/.test(value)) return "danger";
  if (/限选|限定选修|指选/.test(value)) return "warning";
  if (/任选|公选|通识/.test(value)) return "success";
  if (/选修/.test(value)) return "primary";
  return "info";
}

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") : [];
}

function keyed(cards: Omit<RecordCard, "key">[], prefix: string): RecordCard[] {
  return cards.map((card, index) => ({ ...card, key: `${prefix}-${index}` }));
}

function levelExamCards(data: Row) {
  return keyed(rows(data.list).map((row) => ({
    title: row.name,
    sub: compact([row.date, row.endDate && row.endDate !== row.date ? `至 ${row.endDate}` : ""]).join(" "),
    value: row.score ? String(row.score) : row.grade || "未出分",
    valueLabel: row.score ? "总成绩" : undefined,
    meta: compact([
      row.written ? `笔试 ${row.written}` : "",
      row.practical ? `机试 ${row.practical}` : "",
      row.score && row.grade ? `等级 ${row.grade}` : "",
    ]),
    lines: compact([row.note]),
  })), "level");
}

function termCourseCards(data: Row) {
  return keyed(rows(data.list).map((row) => ({
    title: row.courseName,
    sub: compact([row.teacher, row.courseCode]).join(" · "),
    badge: row.category,
    badgeType: categoryTagType(row.category),
    value: typeof row.credits === "number" ? String(row.credits) : undefined,
    valueLabel: typeof row.credits === "number" ? "学分" : undefined,
    meta: compact([
      row.nature,
      row.assessment ? `考核：${row.assessment}` : "",
      hours(row.hours),
      ...rows(row.hourBreakdown).map((item) => `${item.label} ${item.hours}`),
      typeof row.enrolled === "number"
        ? `已选 ${row.enrolled}${typeof row.capacity === "number" ? ` / ${row.capacity}` : ""} 人`
        : "",
      row.group,
    ]),
    lines: compact([...(Array.isArray(row.sessions) ? row.sessions : []), row.className ? `教学班：${row.className}` : ""]),
  })), "course");
}

function enrollmentGroups(data: Row): RecordCardGroup[] {
  const selected = keyed(rows(data.selected).map((row) => ({
    title: row.courseName,
    sub: compact([row.teacher, row.courseCode]).join(" · "),
    badge: row.category,
    badgeType: categoryTagType(row.category),
    value: typeof row.credits === "number" ? String(row.credits) : undefined,
    valueLabel: typeof row.credits === "number" ? "学分" : undefined,
    meta: compact([row.nature, hours(row.hours), row.department, row.status ? `审核：${row.status}` : ""]),
    lines: compact([
      ...(Array.isArray(row.sessions) ? row.sessions : []),
      row.className ? `教学班：${row.className}` : "",
      row.comment,
    ]),
  })), "selected");
  const dropped = keyed(rows(data.dropped).map((row) => ({
    title: row.courseName,
    sub: compact([row.teacher, row.courseCode]).join(" · "),
    badge: row.dropType || "已退课",
    badgeType: "warning" as const,
    meta: compact([credit(row.credits), row.nature, row.selectionType, row.droppedAt ? `退课于 ${row.droppedAt}` : ""]),
    lines: compact([row.time, row.note]),
  })), "dropped");
  const groups: RecordCardGroup[] = [{
    key: "selected",
    label: "已选课程",
    note: selected.length ? `${selected.length} 门 · ${data.credits ?? 0} 学分` : undefined,
    cards: selected,
  }];
  if (dropped.length) groups.push({ key: "dropped", label: "退课记录", note: `${dropped.length} 门`, cards: dropped });
  return groups;
}

function textbookCards(data: Row) {
  return keyed(rows(data.list).map((row) => ({
    title: row.title,
    sub: compact([row.author, row.publisher, row.edition]).join(" · "),
    value: typeof row.price === "number" ? `¥${row.price.toFixed(2)}` : undefined,
    valueLabel: typeof row.price === "number" ? "定价" : undefined,
    meta: compact([row.courseName, row.teacher, row.nature]),
    lines: compact([row.isbn ? `ISBN ${row.isbn}` : ""]),
  })), "book");
}

function auditGroups(data: Row): RecordCardGroup[] {
  return rows(data.groups).map((group) => ({
    key: group.key,
    label: group.label,
    note: `${rows(group.list).length} 门 · ${group.credits ?? 0} 学分`,
    cards: keyed(rows(group.list).map((row) => ({
      title: row.courseName,
      sub: compact([row.semester, row.courseCode]).join(" · "),
      badge: row.category,
      badgeType: categoryTagType(row.category),
      value: row.score || (typeof row.credits === "number" ? String(row.credits) : undefined),
      valueLabel: row.score ? "成绩" : typeof row.credits === "number" ? "学分" : undefined,
      meta: compact([row.system, row.nature, row.score ? credit(row.credits) : "", hours(row.hours)]),
      lines: [],
    })), `audit-${group.key}`),
  }));
}

function roundState(row: Row, now: number): { label: string; tone: RecordTagType } | null {
  const start = Date.parse(String(row.startsAt || "").replace(" ", "T"));
  const end = Date.parse(String(row.endsAt || "").replace(" ", "T"));
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (now < start) return { label: "未开始", tone: "warning" };
  if (now > end) return { label: "已结束", tone: "info" };
  return { label: "进行中", tone: "success" };
}

function electionRoundCards(data: Row, now: number) {
  return keyed(rows(data.list).map((row) => {
    const state = roundState(row, now);
    return {
      title: row.name,
      sub: row.startsAt && row.endsAt ? `${row.startsAt} 至 ${row.endsAt}` : row.startsAt || row.endsAt,
      badge: state?.label,
      badgeType: state?.tone,
      meta: compact([row.semester, row.policy]),
      lines: [],
    };
  }), "round");
}

function statusGroups(data: Row): RecordCardGroup[] {
  return [{
    key: "warnings",
    label: "学籍预警",
    note: rows(data.warnings).length ? `${rows(data.warnings).length} 条` : "无",
    cards: keyed(rows(data.warnings).map((row) => ({
      title: row.name,
      sub: row.semester,
      badge: row.result,
      badgeType: "warning" as const,
      meta: compact([row.target, row.outcome]),
      lines: compact([row.reason]),
    })), "warning"),
  }, {
    key: "changes",
    label: "学籍异动",
    note: rows(data.changes).length ? `${rows(data.changes).length} 条` : "无",
    cards: keyed(rows(data.changes).map((row) => ({
      title: row.type,
      badge: row.review,
      badgeType: "info" as const,
      meta: [],
      lines: compact([
        Array.isArray(row.from) && row.from.length ? `原：${row.from.join(" / ")}` : "",
        Array.isArray(row.to) && row.to.length ? `现：${row.to.join(" / ")}` : "",
      ]),
    })), "change"),
  }];
}

function majorTransferCards(data: Row) {
  return keyed(rows(data.list).map((row) => ({
    title: row.major,
    sub: compact([row.college, row.grade ? `${row.grade} 级` : "", row.semester]).join(" · "),
    value: typeof row.quota === "number" ? `${row.applicants ?? 0} / ${row.quota}` : undefined,
    valueLabel: typeof row.quota === "number" ? "报名 / 拟接收" : undefined,
    meta: compact([row.assessment ? `考核：${row.assessment}` : "", row.window ? `申请时间 ${row.window}` : ""]),
    lines: compact([row.condition, row.excluded ? `不接收：${row.excluded}` : ""]),
  })), "transfer");
}

function retakeCards(data: Row) {
  return keyed(rows(data.list).map((row) => ({
    title: row.courseName,
    sub: compact([row.courseCode, row.examType]).join(" · "),
    badge: row.offered ? "本学期开课" : "本学期未开课",
    badgeType: row.offered ? "success" as const : "info" as const,
    value: row.bestScore,
    valueLabel: row.bestScore ? "最好成绩" : undefined,
    meta: compact([
      row.category,
      row.nature,
      credit(row.credits),
      row.qualified ? "已取得资格" : "",
      row.registered ? "已报名" : "",
      row.selected ? "已选课" : "",
    ]),
    lines: [],
  })), "retake");
}

export function timetableCards(data: Row | null | undefined) {
  return keyed(rows(data?.list).map((row) => ({
    title: row.courseName,
    sub: compact([row.teacher, row.teacherTitle]).join(" · "),
    badge: row.category,
    badgeType: categoryTagType(row.category),
    meta: compact([
      compact([row.weekday, row.periods ? `${row.periods} 节` : ""]).join(" "),
      row.weeks ? `${row.weeks} 周${row.weekType ? `（${row.weekType}）` : ""}` : "",
      compact([row.building, row.room]).join(" "),
      typeof row.enrolled === "number" ? `${row.enrolled} 人` : "",
      row.assessment ? `考核：${row.assessment}` : "",
    ]),
    lines: compact([row.className, row.department]),
  })), "timetable");
}

// ============ 课表检索结果的筛选、分组和导出 ============

export interface TimetableRow {
  courseName: string;
  courseCode?: string;
  teacher?: string;
  teacherTitle?: string;
  room?: string;
  building?: string;
  weekday?: string;
  periods?: string;
  weeks?: string;
  weekType?: string;
  className?: string;
  department?: string;
  credits?: number;
  hours?: number;
  enrolled?: number;
  nature?: string;
  category?: string;
  assessment?: string;
}

export const WEEKDAYS = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"];

/** “1-8”“3,5,7-9”这样的周次里有没有第 week 周；单周／双周再按奇偶筛一次。 */
export function weeksInclude(weeks: string | undefined, weekType: string | undefined, week: number) {
  if (!weeks) return true;
  if (/单/.test(weekType ?? "") && week % 2 === 0) return false;
  if (/双/.test(weekType ?? "") && week % 2 === 1) return false;
  return weeks.split(/[,，]/).some((part) => {
    const range = /^\s*(\d+)\s*(?:-\s*(\d+))?/.exec(part);
    if (!range) return false;
    const from = Number.parseInt(range[1], 10);
    const to = range[2] ? Number.parseInt(range[2], 10) : from;
    return week >= from && week <= to;
  });
}

export function filterTimetable(list: TimetableRow[], options: { week?: number | null; weekday?: string }) {
  return list.filter((row) => {
    if (options.weekday && row.weekday !== options.weekday) return false;
    if (options.week && !weeksInclude(row.weeks, row.weekType, options.week)) return false;
    return true;
  });
}

/** 按星期分组，一天一组；没有星期的排在最后。 */
export function timetableDayGroups(list: TimetableRow[]): RecordCardGroup[] {
  const days = [...WEEKDAYS, ""];
  return days.flatMap((day) => {
    const rows = list.filter((row) => (row.weekday ?? "") === day || (!day && !WEEKDAYS.includes(row.weekday ?? "")));
    if (!rows.length) return [];
    return [{
      key: day || "other",
      label: day || "时间未定",
      note: `${rows.length} 节`,
      cards: timetableCards({ list: rows }).map((card) => ({ ...card, key: `${day || "other"}-${card.key}` })),
    }];
  });
}

function csvCell(value: unknown) {
  const text = value === undefined || value === null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** 导出给 Excel 用的表格；调用方负责加 BOM。 */
export function timetableCsv(list: TimetableRow[]) {
  const header = ["星期", "节次", "周次", "课程", "教师", "教室", "上课班级", "学分", "学时", "课程属性", "考核方式", "开课单位"];
  const lines = list.map((row) => [
    row.weekday,
    row.periods,
    row.weeks ? `${row.weeks}${row.weekType ? `(${row.weekType})` : ""}` : "",
    row.courseName,
    row.teacher,
    [row.building, row.room].filter(Boolean).join(" "),
    row.className,
    row.credits,
    row.hours,
    row.category,
    row.assessment,
    row.department,
  ].map(csvCell).join(","));
  return [header.join(","), ...lines].join("\r\n");
}

/**
 * 单组数据也按一组返回，页面统一渲染。同一页里放几类数据时用 label 给单组数据补上标题
 * （例如“选课轮次”“转专业计划”）。
 */
export function recordGroups(
  kind: RecordKind,
  data: Row | null | undefined,
  options: { label?: string; now?: number } = {},
): RecordCardGroup[] {
  if (!data) return [];
  const now = options.now ?? Date.now();
  const single = (cards: RecordCard[]): RecordCardGroup[] => [{
    key: kind,
    label: options.label ?? "",
    note: options.label && cards.length ? `${cards.length} 条` : undefined,
    cards,
  }];
  switch (kind) {
    case "level-exams": return single(levelExamCards(data));
    case "term-courses": return single(termCourseCards(data));
    case "enrollment": return enrollmentGroups(data);
    case "textbooks": return single(textbookCards(data));
    case "graduation-audit": return auditGroups(data);
    case "election-rounds": return single(electionRoundCards(data, now));
    case "student-status": return statusGroups(data);
    case "major-transfer": return single(majorTransferCards(data));
    case "retake-options": return single(retakeCards(data));
    case "timetable-search": return single(timetableCards(data));
    default: return [];
  }
}

// ============ 空教室 ============

export interface FreeRoomSlot { name: string; periods: string; start: string; end: string }
/** building：学校给了楼名就用（南医）；没给时按教室号推断。 */
export interface FreeRoom { name: string; building?: string; type?: string; seats?: number; examSeats?: number; states: string[] }

/** “A104”“D106-1”归到 A 楼、D 楼，其余（礼堂、体育馆等）归到“其他”。 */
export function roomBuilding(name: string) {
  const match = /^([A-Za-z])\d/.exec(name.trim());
  return match ? `${match[1].toUpperCase()} 楼` : "其他";
}

export function roomBuildingOf(room: FreeRoom) {
  return room.building?.trim() || roomBuilding(room.name);
}

export function roomBuildings(rooms: FreeRoom[]) {
  const names = Array.from(new Set(rooms.map(roomBuildingOf)));
  return names.sort((a, b) => Number(a === "其他") - Number(b === "其他") || a.localeCompare(b));
}

export interface RoomFilter {
  building?: string;
  slots?: number[];
  /** 至少多少座。 */
  minSeats?: number;
  type?: string;
  /** 教室号里包含的字，不分大小写。 */
  keyword?: string;
}

/** 所选时段全部空闲才算空；没选时段时不按占用过滤。 */
export function filterRooms(rooms: FreeRoom[], options: RoomFilter) {
  const slots = options.slots ?? [];
  const keyword = (options.keyword ?? "").trim().toLowerCase();
  return rooms.filter((room) => {
    if (options.building && roomBuildingOf(room) !== options.building) return false;
    if (options.minSeats && (room.seats ?? 0) < options.minSeats) return false;
    if (options.type && room.type !== options.type) return false;
    if (keyword && !room.name.toLowerCase().includes(keyword)) return false;
    return slots.every((index) => !room.states[index]);
  });
}

export function roomTypes(rooms: FreeRoom[]) {
  return Array.from(new Set(rooms.map((room) => room.type).filter((type): type is string => Boolean(type))))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

export type RoomSort = "building" | "free" | "seats";

/**
 * free：选了时段时按“从那个时段起还能连续空多久”排，没选时按全天空闲的时段数排；
 * seats：座位多的在前。building 不改变顺序，交给按楼分组。
 */
export function sortRooms(rooms: FreeRoom[], mode: RoomSort, slots: FreeRoomSlot[], fromSlot: number) {
  if (mode === "building") return rooms;
  const byName = (a: FreeRoom, b: FreeRoom) => a.name.localeCompare(b.name);
  if (mode === "seats") return [...rooms].sort((a, b) => (b.seats ?? 0) - (a.seats ?? 0) || byName(a, b));
  const score = (room: FreeRoom) => (fromSlot >= 0 ? freeUntil(room, slots, fromSlot) : String(freeSlotCount(room)).padStart(2, "0"));
  return [...rooms].sort((a, b) => score(b).localeCompare(score(a)) || (b.seats ?? 0) - (a.seats ?? 0) || byName(a, b));
}

export interface RoomBuildingGroup { name: string; rooms: FreeRoom[] }

export function groupRoomsByBuilding(rooms: FreeRoom[]): RoomBuildingGroup[] {
  const groups = new Map<string, FreeRoom[]>();
  for (const room of rooms) {
    const name = roomBuildingOf(room);
    groups.set(name, [...(groups.get(name) ?? []), room]);
  }
  return roomBuildings(rooms).map((name) => ({ name, rooms: groups.get(name) ?? [] }));
}

/** 从某个时段起连续空闲到几点；那个时段本身被占用时返回空串。 */
export function freeUntil(room: FreeRoom, slots: FreeRoomSlot[], from: number) {
  if (from < 0 || from >= slots.length || room.states[from]) return "";
  let last = from;
  while (last + 1 < slots.length && !room.states[last + 1]) last += 1;
  return slots[last].end;
}

export function freeSlotCount(room: FreeRoom) {
  return room.states.filter((state) => !state).length;
}

/** 今天正在进行或即将开始的那个时段；全部结束后返回 -1。 */
export function currentSlotIndex(slots: FreeRoomSlot[], hhmm: string) {
  return slots.findIndex((slot) => slot.end > hhmm);
}

export function shanghaiDate(offsetDays = 0, now = new Date()) {
  const base = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
  if (!offsetDays) return base;
  const [year, month, day] = base.split("-").map((part) => Number.parseInt(part, 10));
  return new Date(Date.UTC(year, month - 1, day + offsetDays)).toISOString().slice(0, 10);
}

export function shanghaiClock(now = new Date()) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
}

export const ROOM_STATE_LABELS: Record<string, string> = {
  class: "课",
  graduate: "研",
  borrowed: "借",
  rescheduled: "调",
  busy: "占",
};
