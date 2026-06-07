import crypto from "node:crypto";
import { Errors } from "../utils/response";
import {
  parseGraduateSchedulePayload,
  type GraduateSchedulePayload,
  type GraduateTermOption,
} from "./graduateScheduleParser";
import { fetchAnyCpuText } from "./jwxtClient";

const GRAD_HOST = "ygl.cpu.edu.cn";
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

function defaultGraduateRequestHeaders() {
  return {
    Accept: "application/json, text/plain, */*",
    "X-Requested-With": "XMLHttpRequest",
    Referer: GRAD_SCHEDULE_PAGE_URL,
  };
}

function decryptGraduateResponse(raw: string) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;
  if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html")) return trimmed;

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
  if (!decrypted || decrypted.startsWith("<!DOCTYPE") || decrypted.startsWith("<html")) {
    throw Errors.badRequest(`研究生系统返回了非 JSON 的${label}响应`);
  }
  try {
    return JSON.parse(decrypted) as T;
  } catch {
    throw Errors.badRequest(`研究生系统${label}响应解析失败`);
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

async function fetchGraduateTerms(token: string) {
  const response = await fetchAnyCpuText(token, GRAD_BINDTERM_URL, {
    expectedHost: GRAD_HOST,
    headers: defaultGraduateRequestHeaders(),
  });
  const json = parseGraduateJson<RawGraduateTermOption[]>(response.text, "学期列表");
  const terms = Array.isArray(json) ? json.map(normalizeTermOption).filter((item): item is GraduateTermOption => Boolean(item)) : [];
  if (!terms.length) throw Errors.badRequest("研究生系统没有返回可用学期列表");
  return terms;
}

async function fetchGraduateSchedulePayload(token: string, termcode: string) {
  const body = new URLSearchParams({
    kblx: "xs",
    termcode,
  });
  const response = await fetchAnyCpuText(token, GRAD_SCHEDULE_URL, {
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

  const payload = await fetchGraduateSchedulePayload(token, targetTerm.termcode);
  return {
    parsed: parseGraduateSchedulePayload(payload, terms, targetTerm.termcode),
    source: {
      mode: "live",
      semester: targetTerm.termname,
      termcode: targetTerm.termcode,
      fetchedAt: new Date().toISOString(),
    },
  };
}
