import crypto from "node:crypto";
import { Errors } from "../utils/response";
import {
  parseGraduateSchedulePayload,
  type GraduateSchedulePayload,
  type GraduateTermOption,
} from "./graduateScheduleParser";
import { fetchAnyCpuText } from "./jwxtClient";

const GRAD_HOST = "ygl.cpu.edu.cn";
const GRAD_OAUTH_ENTRY_URL = "https://ygl.cpu.edu.cn/gmis5/oauthLogin/zgyk";
const GRAD_SCHEDULE_PAGE_URL = "https://ygl.cpu.edu.cn/gmis5/student/pygl/xskbcx";
const GRAD_BINDTERM_URL = "https://ygl.cpu.edu.cn/gmis5/student/default/bindterm";
const GRAD_SCHEDULE_URL = "https://ygl.cpu.edu.cn/gmis5/student/pygl/py_kbcx_ew";
const GRAD_AES_KEY = Buffer.from("southsoft12345!#", "utf8");

type GraduateScheduleParsed = ReturnType<typeof parseGraduateSchedulePayload>;

export interface GraduateScheduleSourceMeta {
  mode: "live";
  semester: string;
  termcode: string;
  fetchedAt: string;
}

export interface GraduateScheduleFetchResult {
  parsed: GraduateScheduleParsed;
  source: GraduateScheduleSourceMeta;
}

type RawGraduateTermOption = {
  termcode?: unknown;
  termname?: unknown;
  selected?: unknown;
};

type GraduateTermEnvelope =
  | RawGraduateTermOption[]
  | {
      terms?: unknown;
      data?: unknown;
      rows?: unknown;
      list?: unknown;
      items?: unknown;
    };

function defaultGraduateRequestHeaders() {
  return {
    Accept: "application/json, text/plain, */*",
    "X-Requested-With": "XMLHttpRequest",
    Referer: GRAD_SCHEDULE_PAGE_URL,
  };
}

function isGraduateHtmlResponse(value: string) {
  return /^<!DOCTYPE|^<html/i.test(value) || /<body[\s>]/i.test(value);
}

function graduateHtmlErrorMessage(raw: string, label: string) {
  const html = String(raw || "").trim();
  if (!html) {
    return `研究生入口暂时没有返回可用的${label}数据，请刷新后重试。`;
  }

  if (
    /统一身份认证|CAS|登录|login/i.test(html)
    && /用户名|学号|工号|密码|captcha|execution|lt/i.test(html)
  ) {
    return "当前没有拿到研究生入口的有效登录态。请刷新后重试；如果你刚完成教务授权，稍等几秒再试一次即可。";
  }

  if (/jsxsd|教务系统|成绩|培养方案/i.test(html)) {
    return "当前会话暂时落在本科教务入口，系统还没成功接上研究生入口。请刷新后重试；如果你刚完成教务授权，稍等几秒再试一次即可。";
  }

  return `研究生入口返回了网页而不是${label}数据。请刷新后重试；如果你刚完成教务授权，稍等几秒再试一次即可。`;
}

function decryptGraduateResponse(raw: string) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;
  if (isGraduateHtmlResponse(trimmed)) return trimmed;

  try {
    const decipher = crypto.createDecipheriv("aes-128-ecb", GRAD_AES_KEY, null);
    decipher.setAutoPadding(true);
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(trimmed, "base64")),
      decipher.final(),
    ]).toString("utf8");
    return decrypted.replace(/^\ufeff/, "").trim();
  } catch {
    return trimmed;
  }
}

function parseGraduateJson<T>(raw: string, label: string) {
  const decrypted = decryptGraduateResponse(raw);
  if (!decrypted || isGraduateHtmlResponse(decrypted)) {
    throw Errors.badRequest(graduateHtmlErrorMessage(decrypted || raw, label));
  }
  try {
    return JSON.parse(decrypted) as T;
  } catch {
    throw Errors.badRequest(`研究生${label}响应解析失败，请刷新后重试。`);
  }
}

function normalizeTermOption(item: RawGraduateTermOption): GraduateTermOption | null {
  const termcode = String(item?.termcode ?? "").trim();
  const termname = String(item?.termname ?? "").trim();
  if (!termcode || !termname) return null;
  return {
    termcode,
    termname,
    selected: Boolean(item?.selected),
  };
}

export function normalizeGraduateSemesterLabel(value: string) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/第一学期/g, "一学期")
    .replace(/第二学期/g, "二学期")
    .replace(/秋学期/g, "一学期")
    .replace(/春学期/g, "二学期")
    .trim();
}

function resolveGraduateTargetTerm(
  terms: GraduateTermOption[],
  args: { semester?: string; termcode?: string },
) {
  const requestedTermcode = String(args.termcode ?? "").trim();
  if (requestedTermcode) {
    const byCode = terms.find((item) => item.termcode === requestedTermcode);
    if (!byCode) throw Errors.badRequest(`未找到 termcode=${requestedTermcode} 对应的研究生学期`);
    return byCode;
  }

  const requestedSemester = String(args.semester ?? "").trim();
  if (requestedSemester) {
    const normalized = normalizeGraduateSemesterLabel(requestedSemester);
    const bySemester = terms.find((item) => normalizeGraduateSemesterLabel(item.termname) === normalized);
    if (!bySemester) throw Errors.badRequest(`未找到「${requestedSemester}」对应的研究生学期`);
    return bySemester;
  }

  return terms.find((item) => item.selected) ?? terms[0] ?? null;
}

function hasGraduateScheduleCourses(parsed: GraduateScheduleParsed | null | undefined) {
  return Array.isArray(parsed?.cells) && parsed.cells.length > 0;
}

function graduateScheduleCourseEntryCount(parsed: GraduateScheduleParsed | null | undefined) {
  return (parsed?.cells ?? []).reduce((sum, cell) => sum + (cell.courses?.length ?? 0), 0);
}

function unwrapGraduateTermCandidate(candidate: unknown): RawGraduateTermOption[] {
  if (Array.isArray(candidate)) return candidate as RawGraduateTermOption[];
  if (typeof candidate === "string") {
    const trimmed = candidate.trim();
    if (!trimmed) return [];
    try {
      return unwrapGraduateTermCandidate(JSON.parse(trimmed));
    } catch {
      return [];
    }
  }
  if (!candidate || typeof candidate !== "object") return [];

  const nestedObject = candidate as Record<string, unknown>;
  const deeperCandidates = [
    nestedObject.terms,
    nestedObject.data,
    nestedObject.rows,
    nestedObject.list,
    nestedObject.items,
    nestedObject.obj,
    nestedObject.records,
    nestedObject.datas,
  ];
  for (const deeper of deeperCandidates) {
    const unwrapped = unwrapGraduateTermCandidate(deeper);
    if (unwrapped.length) return unwrapped;
  }
  return [];
}

function unwrapGraduateTermArray(value: unknown): RawGraduateTermOption[] {
  return unwrapGraduateTermCandidate(value);
}

async function warmupGraduateScheduleSession(token: string) {
  await fetchAnyCpuText(token, GRAD_OAUTH_ENTRY_URL, {
    allowSso: true,
    expectedHost: GRAD_HOST,
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      Referer: "http://jsxsd.cpu.edu.cn/",
    },
  });
}

async function fetchGraduateTermsOnce(token: string) {
  const response = await fetchAnyCpuText(token, GRAD_BINDTERM_URL, {
    allowSso: true,
    expectedHost: GRAD_HOST,
    headers: defaultGraduateRequestHeaders(),
  });
  const json = parseGraduateJson<GraduateTermEnvelope>(response.text, "学期列表");
  const termItems = unwrapGraduateTermArray(json);
  const terms = termItems
    .map(normalizeTermOption)
    .filter((item): item is GraduateTermOption => Boolean(item));
  if (!terms.length) throw Errors.badRequest("研究生系统没有返回可用学期列表");
  return terms;
}

async function fetchGraduateTerms(token: string) {
  try {
    return await fetchGraduateTermsOnce(token);
  } catch {
    await warmupGraduateScheduleSession(token);
    return fetchGraduateTermsOnce(token);
  }
}

async function fetchGraduateSchedulePayload(token: string, termcode: string) {
  const body = new URLSearchParams({
    kblx: "xs",
    termcode,
  });
  const response = await fetchAnyCpuText(token, GRAD_SCHEDULE_URL, {
    allowSso: true,
    expectedHost: GRAD_HOST,
    method: "POST",
    headers: {
      ...defaultGraduateRequestHeaders(),
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
    body,
  });
  return parseGraduateJson<GraduateSchedulePayload>(response.text, "课表");
}

export async function getGraduateSchedule(
  token: string,
  args: { semester?: string; termcode?: string } = {},
): Promise<GraduateScheduleFetchResult> {
  const terms = await fetchGraduateTerms(token);
  const targetTerm = resolveGraduateTargetTerm(terms, args);
  if (!targetTerm) throw Errors.badRequest("未找到可用的研究生学期");

  const explicitTarget = Boolean(String(args.semester ?? "").trim() || String(args.termcode ?? "").trim());
  let resolvedTerm = targetTerm;
  let payload = await fetchGraduateSchedulePayload(token, resolvedTerm.termcode);
  let parsed = parseGraduateSchedulePayload(payload, terms, resolvedTerm.termcode);

  if (!explicitTarget && !hasGraduateScheduleCourses(parsed)) {
    let bestFallback: {
      term: GraduateTermOption;
      payload: GraduateSchedulePayload;
      parsed: GraduateScheduleParsed;
      score: number;
    } | null = null;

    for (const candidate of terms) {
      if (candidate.termcode === resolvedTerm.termcode) continue;
      const nextPayload = await fetchGraduateSchedulePayload(token, candidate.termcode);
      const nextParsed = parseGraduateSchedulePayload(nextPayload, terms, candidate.termcode);
      if (!hasGraduateScheduleCourses(nextParsed)) continue;
      const nextScore = graduateScheduleCourseEntryCount(nextParsed);
      if (!bestFallback || nextScore > bestFallback.score) {
        bestFallback = {
          term: candidate,
          payload: nextPayload,
          parsed: nextParsed,
          score: nextScore,
        };
      }
    }

    if (bestFallback) {
      resolvedTerm = bestFallback.term;
      payload = bestFallback.payload;
      parsed = bestFallback.parsed;
    }
  }

  return {
    parsed,
    source: {
      mode: "live",
      semester: resolvedTerm.termname,
      termcode: resolvedTerm.termcode,
      fetchedAt: new Date().toISOString(),
    },
  };
}
