import type { ProgressResult, ProgressSummaryRow } from "../../services/jwxtParser";
import type { FreeRoomRow, FreeRoomSlot, LevelExamRow } from "../../services/jwxtRecords";

/**
 * 南医正方教务里课表、成绩、考试之外的数据：考级成绩、学分统计与学业体检单、空闲教室。
 * 上游行里的学号、姓名、证件号、手机号和内部主键都不外传。
 */

type Row = Record<string, unknown>;

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value).replace(/\s+/gu, " ").trim();
}

function number(value: unknown) {
  const parsed = Number(text(value));
  return text(value) && Number.isFinite(parsed) ? parsed : undefined;
}

function rowsOf(input: unknown): Row[] {
  const list = Array.isArray(input) ? input : input && typeof input === "object" && Array.isArray((input as { items?: unknown }).items) ? (input as { items: unknown[] }).items : [];
  return list.filter((item): item is Row => Boolean(item) && typeof item === "object" && !Array.isArray(item));
}

function decodeEntities(value: string) {
  return value.replace(/&nbsp;/gu, " ").replace(/&amp;/gu, "&").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&#169;/gu, "©");
}

// ============ 考级成绩（kjgl/kjbm_cxXskjbm.html） ============

/** 考级报名记录里也有「火车票优惠卡」这类非考试项目，只留有成绩的。 */
export function parseZfLevelExams(input: unknown): { kind: "level-exams"; list: LevelExamRow[] } {
  const entries = rowsOf(input).flatMap((row) => {
    const name = text(row.xmmc);
    const result = text(row.xmcj);
    if (!name || !result) return [];
    const score = number(result);
    const year = text(row.xnmc);
    const term = text(row.xqmmc);
    const sortKey = `${year}-${term.padStart(2, "0")}`;
    const exam: LevelExamRow = {
      name,
      subject: text(row.xmlbmc) || undefined,
      score: score !== undefined && score > 0 ? score : undefined,
      grade: score === undefined ? result : undefined,
      note: year ? `${year} 学年第 ${term || "?"} 学期` : undefined,
    };
    return [{ sortKey, exam }];
  });
  entries.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
  return { kind: "level-exams", list: entries.map((item) => item.exam) };
}

// ============ 学业：学分统计（cjcx_cxXsxftj）+ 学业体检单（cjpmtj_cxXsxytjdIndex） ============

export type ZfCheckup = {
  /** 核心课程平均学分绩点 */
  coreGpa?: number;
  /** 必修课程平均学分绩点 */
  requiredGpa?: number;
  /** 学业总评成绩 */
  overallScore?: number;
  cet4?: number;
  failedCount?: number;
  electiveCredits?: number;
  punishments?: number;
  /** 截至时间，形如「2026 年 11 月」 */
  asOf?: string;
  graduationRules: string[];
  degreeRules: string[];
  failed: Array<{ semester?: string; courseCode?: string; courseName: string; attr?: string; credits?: number; bestScore?: string }>;
};

export type ZfProgressResult = ProgressResult & { checkup?: ZfCheckup };

/** 学分统计：按课程性质给出通过学分。正方不给要求学分，要求数在学业体检单的文字里。 */
export function parseZfCreditStats(input: unknown): ProgressResult {
  const summary: ProgressSummaryRow[] = rowsOf(input).flatMap((row) => {
    const name = text(row.kcxzmc);
    if (!name) return [];
    const earned = number(row.tgxf) ?? 0;
    const optional = /任选|选修/u.test(name);
    return [{
      name,
      requiredMust: 0,
      requiredOpt: 0,
      earnedMust: optional ? 0 : earned,
      earnedOpt: optional ? earned : 0,
      leftMust: 0,
      leftOpt: 0,
    }];
  });
  const totals = summary.reduce((sum, row) => ({
    requiredMust: 0,
    requiredOpt: 0,
    earnedMust: sum.earnedMust + row.earnedMust,
    earnedOpt: sum.earnedOpt + row.earnedOpt,
    leftMust: 0,
    leftOpt: 0,
  }), { requiredMust: 0, requiredOpt: 0, earnedMust: 0, earnedOpt: 0, leftMust: 0, leftOpt: 0 });
  return { summary, totals, completed: [], uncompleted: [] };
}

function plainText(html: string) {
  return decodeEntities(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/giu, " ").replace(/<[^>]+>/gu, " ")).replace(/\s+/gu, " ").trim();
}

function rulesBetween(textValue: string, start: RegExp, end: RegExp) {
  const from = textValue.search(start);
  if (from < 0) return [];
  const rest = textValue.slice(from).replace(start, "");
  const to = rest.search(end);
  const body = (to >= 0 ? rest.slice(0, to) : rest).trim();
  // 条目以「1.」「（1）」开头；按条目断开，保留编号。
  return body
    .split(/\s(?=(?:\d+[.、．]|（[\d一二三四五六七八九十]+）|\(\d+\)))/u)
    .map((item) => item.trim())
    .filter((item) => item.length > 1);
}

function captureNumber(source: string, pattern: RegExp) {
  const match = source.match(pattern);
  return match ? number(match[1]) : undefined;
}

/** 学业体检单是一页按学生生成的文字报告；只取数字和规则，不取页头的姓名学号。 */
export function parseZfCheckup(html: string): ZfCheckup | null {
  const body = plainText(html);
  if (!/学业情况/u.test(body)) return null;
  const situation = body.slice(Math.max(0, body.search(/三、\s*你的学业情况/u)));
  const failed: ZfCheckup["failed"] = [];
  const tableStart = html.indexOf("不及格课程统计表");
  if (tableStart >= 0) {
    const tbody = html.slice(tableStart).match(/<tbody>([\s\S]*?)<\/tbody>/iu)?.[1] ?? "";
    for (const tr of tbody.match(/<tr[\s\S]*?<\/tr>/giu) ?? []) {
      const cells = (tr.match(/<td[^>]*>([\s\S]*?)<\/td>/giu) ?? []).map((cell) => plainText(cell));
      const [, semester, courseCode, courseName, attr, credits, bestScore] = cells;
      if (!courseName) continue;
      failed.push({
        semester: semester || undefined,
        courseCode: courseCode || undefined,
        courseName,
        attr: attr || undefined,
        credits: number(credits),
        bestScore: bestScore || undefined,
      });
    }
  }
  const asOf = situation.match(/截至\s*(\d{4})\s*年\s*(\d{1,2})\s*月/u);
  return {
    coreGpa: captureNumber(situation, /核心课程\s*平均学分绩点\s*（GPA）\s*为\s*([\d.]+)/u),
    requiredGpa: captureNumber(situation, /必修课程平均学分绩点为\s*([\d.]+)/u),
    overallScore: captureNumber(situation, /学业总评成绩为\s*([\d.]+)/u),
    cet4: captureNumber(situation, /CET4成绩为\s*([\d.]+)/u),
    failedCount: captureNumber(situation, /不及格课程\s*(\d+)\s*门/u),
    electiveCredits: captureNumber(situation, /任选课学分共\s*([\d.]+)\s*分/u),
    punishments: captureNumber(situation, /有\s*(\d+)\s*次处分记录/u),
    asOf: asOf ? `${asOf[1]} 年 ${asOf[2]} 月` : undefined,
    graduationRules: rulesBetween(body, /一、\s*毕业[^二]{0,6}?要求/u, /二、\s*学位授予基本条件/u),
    degreeRules: rulesBetween(body, /二、\s*学位授予基本条件/u, /三、\s*你的学业情况/u),
    failed,
  };
}

// ============ 空闲教室（cdjy/cdjy_cxKxcdlb.html） ============

/** 一次查询给出「这几节都空着」的教室；按上课的大节分段各查一次，拼成每间教室各段的占用情况。 */
export const ZF_ROOM_SLOTS: ReadonlyArray<{ from: number; to: number }> = [
  { from: 1, to: 2 },
  { from: 3, to: 5 },
  { from: 7, to: 8 },
  { from: 9, to: 11 },
  { from: 13, to: 15 },
];

/** 自习能用的教室类别；体育馆、操场、医院、实验室这类不列。 */
const STUDY_ROOM_TYPES = /多媒体|智慧|PBL|语音|普通教室|研讨/u;

export function periodMask(from: number, to: number) {
  let mask = 0;
  for (let period = from; period <= to; period++) mask += 2 ** (period - 1);
  return mask;
}

export type ZfRoomQueryResult = { slot: { from: number; to: number }; rows: unknown };

export function mergeZfFreeRooms(
  results: ZfRoomQueryResult[],
  periods: Array<{ id: number; start: string; end: string }>,
): { slots: FreeRoomSlot[]; rooms: FreeRoomRow[] } {
  const timeOf = (id: number) => periods.find((item) => item.id === id);
  const slots: FreeRoomSlot[] = results.map(({ slot }) => ({
    name: `${slot.from}-${slot.to}节`,
    periods: `${slot.from}-${slot.to}`,
    start: timeOf(slot.from)?.start ?? "",
    end: timeOf(slot.to)?.end ?? "",
  }));
  const byName = new Map<string, { building?: string; type?: string; seats?: number; free: Set<number> }>();
  results.forEach(({ rows }, index) => {
    for (const row of rowsOf(rows)) {
      const name = text(row.cdmc);
      if (!name) continue;
      const building = text(row.jxlmc);
      const entry = byName.get(name) ?? {
        building: building && !/无楼号/u.test(building) ? building : undefined,
        type: text(row.cdlbmc) || undefined,
        seats: number(row.zws),
        free: new Set<number>(),
      };
      entry.free.add(index);
      byName.set(name, entry);
    }
  });
  let rooms = [...byName.entries()].map(([name, entry]): FreeRoomRow => ({
    name,
    building: entry.building,
    type: entry.type,
    seats: entry.seats,
    states: slots.map((_, index) => (entry.free.has(index) ? "" : "class")),
  }));
  const study = rooms.filter((room) => STUDY_ROOM_TYPES.test(room.type ?? ""));
  if (study.length) rooms = study;
  rooms.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  return { slots, rooms };
}
