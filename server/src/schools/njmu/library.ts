import { Errors } from "../../utils/response";
import { LIBRARY_HOST, casLoginUrl, subsystemRequest } from "./client";

/**
 * 南医图书馆（meta.njmu.edu.cn，「元宇宙」OPAC）的个人借阅，只读。
 * 统一认证换票进入；接口前缀 /meta-local/opac，信封 {code:0,msg,data}，会话过期回 401。
 * 读者证号、证件号这类字段不外传。
 */

const ORIGIN = `https://${LIBRARY_HOST}`;
// 借阅页是前端单页，直接打开不会跳统一认证；要带图书馆的 CAS 回调地址去换票。
// 统一认证里登记的回调地址带显式的 :443，不带端口会被当成未登记的服务、直接给登录页。
const ENTRY_URL = casLoginUrl(`https://${LIBRARY_HOST}:443/meta-local/opac/cas/rosetta`);
const API = `${ORIGIN}/meta-local/opac`;

type Row = Record<string, unknown>;

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value).replace(/\s+/gu, " ").trim();
}

function number(value: unknown) {
  const raw = text(value).replace(/[^\d.-]/gu, "");
  const parsed = Number(raw);
  return raw && Number.isFinite(parsed) ? parsed : undefined;
}

function obj(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

/** {code, data} 信封里的 data；stats 这类裸对象原样返回。 */
export function unwrapLibrary(body: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw Errors.badGateway("南医图书馆返回了无法识别的数据");
  }
  const envelope = obj(parsed);
  if ("code" in envelope && "data" in envelope) {
    if (Number(envelope.code) !== 0) throw Errors.badGateway(text(envelope.msg) || "南医图书馆暂时不可用");
    return envelope.data;
  }
  return parsed;
}

function pageItems(data: unknown): Row[] {
  const list = Array.isArray(data) ? data : Array.isArray(obj(data).items) ? obj(data).items as unknown[] : [];
  return list.map(obj);
}

function day(value: unknown) {
  const raw = text(value);
  return raw.length >= 10 ? raw.slice(0, 10) : raw;
}

function bibOf(row: Row) {
  const bib = obj(row.bibAttrs);
  return {
    author: text(bib.author) || text(row.author) || undefined,
    publisher: text(bib.publisher) || undefined,
    isbn: text(bib.isbn) || undefined,
  };
}

export type LibraryLoan = {
  title: string;
  author?: string;
  publisher?: string;
  callNo?: string;
  location?: string;
  loanDate?: string;
  dueDate?: string;
  renewTimes: number;
  /** 还能续借几次；学校没给上限时为 undefined */
  renewLeft?: number;
  status?: string;
};

export function parseLibraryLoans(data: unknown, maxRenew: unknown = null): LibraryLoan[] {
  const maxByBarcode = new Map<string, number>();
  for (const item of Array.isArray(maxRenew) ? maxRenew : []) {
    const row = obj(item);
    const code = text(row.barCode);
    const max = number(row.maxRenewTimes ?? row.max);
    if (code && max !== undefined) maxByBarcode.set(code, max);
  }
  return pageItems(data).flatMap((row): LibraryLoan[] => {
    const item = obj(row.item);
    const title = text(item.title) || text(row.title);
    if (!title) return [];
    const renewTimes = number(row.renewTimes) ?? 0;
    const max = number(row.maxRenewTimes) ?? maxByBarcode.get(text(row.barCode));
    return [{
      title,
      ...bibOf(row),
      callNo: text(row.callNo) || text(item.callNo) || undefined,
      location: text(row.location) || undefined,
      loanDate: day(row.loanDate) || undefined,
      dueDate: day(row.dueDate) || undefined,
      renewTimes,
      renewLeft: max === undefined ? undefined : Math.max(0, max - renewTimes),
      status: text(row.loanStatusDesc) || text(row.loanTypeDesc) || undefined,
    }];
  }).sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
}

export type LibraryHistoryItem = { title: string; author?: string; callNo?: string; loanDate?: string; returnDate?: string };

export function parseLibraryHistory(data: unknown): { list: LibraryHistoryItem[]; total: number } {
  const list = pageItems(data).flatMap((row): LibraryHistoryItem[] => {
    const title = text(row.title) || text(obj(row.item).title);
    if (!title) return [];
    return [{
      title,
      author: text(row.author) || bibOf(row).author,
      callNo: text(row.callNo) || undefined,
      loanDate: day(row.loanDate) || undefined,
      returnDate: day(row.returnDate) || undefined,
    }];
  });
  return { list, total: number(obj(data).total) ?? list.length };
}

export type LibraryFine = { title: string; amount?: number; reason?: string };

export function parseLibraryFines(data: unknown): LibraryFine[] {
  return pageItems(data).flatMap((row): LibraryFine[] => {
    const amount = [row.fineSum, row.amount, row.money, row.fee, row.fine].map(number).find((value) => value !== undefined);
    const title = text(row.title);
    if (!title && amount === undefined) return [];
    return [{ title: title || "罚款", amount, reason: text(row.reason) || undefined }];
  });
}

/** 「3 / 20」这样的额度字符串 */
export function parseLibraryQuota(data: unknown) {
  const match = text(data).match(/(\d+)\s*\/\s*(\d+)/u);
  return match ? { borrowed: Number(match[1]), limit: Number(match[2]) } : null;
}

async function libraryData(token: string, path: string, signal?: AbortSignal) {
  const res = await subsystemRequest(token, `${API}${path}`, ENTRY_URL, { json: true }, signal);
  if (res.status !== 200) throw Errors.badGateway("南医图书馆暂时不可用，请稍后重试");
  return unwrapLibrary(res.body);
}

export async function loadLibraryOverview(token: string, signal?: AbortSignal) {
  const loans = await libraryData(token, "/users/loans?page=1&pageSize=50", signal);
  const [maxRenew, quota, fines] = await Promise.all([
    libraryData(token, "/users/loan_max_renew_times", signal).catch(() => null),
    libraryData(token, "/users/loan_info", signal).catch(() => null),
    libraryData(token, "/users/fines?page=1&pageSize=20", signal).catch(() => null),
  ]);
  return {
    loans: parseLibraryLoans(loans, maxRenew),
    quota: parseLibraryQuota(quota),
    fines: parseLibraryFines(fines),
  };
}

export async function loadLibraryHistory(token: string, page: number, signal?: AbortSignal) {
  const safePage = Math.min(Math.max(1, Math.trunc(page) || 1), 100);
  return { page: safePage, ...parseLibraryHistory(await libraryData(token, `/users/loan_hists?page=${safePage}&pageSize=20`, signal)) };
}
