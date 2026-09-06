import { setTimeout as sleep } from "node:timers/promises";
import tiku from "./safetyPlatformTiku.json";

const SAFETY_PLATFORM_HOST = "wap.xiaoyuananquantong.com";
const SAFETY_PLATFORM_BASE = `http://${SAFETY_PLATFORM_HOST}/guns-vip-main`;
const SAFETY_PLATFORM_ORIGIN = `http://${SAFETY_PLATFORM_HOST}`;
export const SAFETY_PLATFORM_COLLEGE_ID = "1224316225859555329";
const SAFETY_REQUEST_TIMEOUT_MS = 20_000;
const SAFETY_MAX_REDIRECTS = 5;
const SAFETY_MIN_ACTION_DELAY_MS = 5_000;
const SAFETY_SHORT_DURATION_RETRY_DELAY_MS = 10_000;
const SAFETY_SHORT_DURATION_MAX_RETRIES = 6;
const SAFETY_UNIT_ARTICLE_IDS: Record<string, string> = {
  "题库学习": "2080135073788600321",
  "入学安全": "2079132357549375490",
  "国家安全": "2079133938168643585",
  "财物安全": "2079139032318623745",
  "心理健康": "2079140991327027201",
  "消防安全": "2079142411614830593",
  "人身安全": "2079143452481699842",
  "交通安全": "2079144978977669121",
  "禁毒防艾": "2079146093836255234",
  "应急救护": "2079146628521934850",
  "防灾减灾": "2079147344531570690",
};
const SAFETY_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 16; wv) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Version/4.0 Chrome/146.0.7680.178 Mobile Safari/537.36 MicroMessenger/8.0.71";

type SafetyApiResponse = {
  code?: number | string;
  success?: boolean | string;
  message?: string;
  data?: any;
};

type SafetyCourse = {
  id?: string | number;
  name?: string;
  isFinsh?: boolean;
};

type SafetyArticle = {
  id?: string | number;
  isFinsh?: boolean;
};

type SafetyQuestion = {
  id?: string | number;
  questionId?: string | number;
  quesType?: string | number;
};

type SafetyExamRow = {
  questionId?: string | number;
  question?: SafetyQuestion;
};

type SafetyTikuRow = {
  questionId: string;
  answer: string;
  quesType: string;
};

export type SafetyPlatformCredentials = {
  username: string;
  password: string;
};

type SafetyPlatformSession = {
  jar: SafetyCookieJar;
  userId: string;
  collegeId: string;
};

export type SafetyPlatformRunOptions = {
  minimumActionDelayMs?: number;
  shortDurationRetryDelayMs?: number;
};

/**
 * 平台登录后通过 Cookie 维持会话。每次刷课任务创建独立 jar，避免不同用户串会话。
 * 这里只保留内存中的 Cookie，不落库，也不进入日志。
 */
class SafetyCookieJar {
  private readonly cookies = new Map<string, string>();

  ingest(response: Response) {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    const raw = headers.getSetCookie?.() ?? response.headers.get("set-cookie");
    if (!raw) return;
    const values = Array.isArray(raw) ? raw : splitSetCookieHeader(raw);
    for (const value of values) {
      const separator = value.indexOf("=");
      if (separator <= 0) continue;
      const name = value.slice(0, separator).trim();
      const cookieValue = value.slice(separator + 1).split(";", 1)[0].trim();
      if (!name) continue;
      if (!cookieValue || /expires=.*1970/i.test(value)) this.cookies.delete(name);
      else this.cookies.set(name, cookieValue);
    }
  }

  toHeader() {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }
}

function splitSetCookieHeader(raw: string) {
  const values: string[] = [];
  let start = 0;
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] !== ",") continue;
    const next = raw.slice(index + 1).trimStart();
    if (/^[\w!#$%&'*+\-.^`|~]+\s*=/.test(next)) {
      values.push(raw.slice(start, index));
      start = index + 1;
    }
  }
  values.push(raw.slice(start));
  return values.map((value) => value.trim()).filter(Boolean);
}

function getSafetyErrorMessage(payload: SafetyApiResponse, fallback: string) {
  const message = String(payload?.message || "").trim();
  return message && !/^(?:请求)?成功[！!。.]?$/.test(message) ? message : fallback;
}

function describeMissingCredential(payload: SafetyApiResponse, fallback: string) {
  const code = payload.code === undefined ? "未知" : String(payload.code);
  const dataFields = payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
    ? Object.keys(payload.data).filter((key) => !/token|auth|password|cookie/i.test(key)).slice(0, 8).join("、") || "无"
    : `非对象（${typeof payload.data}）`;
  return `${getSafetyErrorMessage(payload, fallback)}（平台 code=${code}，data 字段：${dataFields}）`;
}

function isSuccessfulSafetyResponse(payload: SafetyApiResponse) {
  const code = payload?.code === undefined ? 200 : Number(payload.code);
  return code === 200 && payload?.success !== false && payload?.success !== "false";
}

async function safetyRequest(jar: SafetyCookieJar, url: string, init: RequestInit = {}) {
  let currentUrl = url;
  let currentInit = init;

  for (let redirectCount = 0; redirectCount <= SAFETY_MAX_REDIRECTS; redirectCount += 1) {
    const parsed = new URL(currentUrl);
    if (parsed.hostname !== SAFETY_PLATFORM_HOST) {
      throw new Error("江苏省大学生安全教育平台重定向到未知地址，已停止请求。");
    }
    const headers = new Headers(currentInit.headers);
    if (!headers.has("User-Agent")) headers.set("User-Agent", SAFETY_USER_AGENT);
    if (!headers.has("Accept")) headers.set("Accept", "application/json, text/javascript, */*; q=0.01");
    if (!headers.has("Origin")) headers.set("Origin", SAFETY_PLATFORM_ORIGIN);
    if (!headers.has("X-Requested-With")) headers.set("X-Requested-With", "XMLHttpRequest");
    const cookie = jar.toHeader();
    if (cookie) headers.set("Cookie", cookie);

    const response = await fetch(currentUrl, {
      ...currentInit,
      headers,
      redirect: "manual",
      signal: currentInit.signal || AbortSignal.timeout(SAFETY_REQUEST_TIMEOUT_MS),
    });
    jar.ingest(response);

    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location || redirectCount === SAFETY_MAX_REDIRECTS) return response;
    const nextUrl = new URL(location, currentUrl);
    if (nextUrl.hostname !== SAFETY_PLATFORM_HOST) {
      throw new Error("江苏省大学生安全教育平台重定向到未知地址，已停止请求。");
    }
    currentUrl = nextUrl.toString();
    if (response.status !== 307 && response.status !== 308) {
      currentInit = { method: "GET", headers: { Referer: url } };
    }
  }

  throw new Error("江苏省大学生安全教育平台重定向次数过多。");
}

async function readSafetyJson(
  jar: SafetyCookieJar,
  path: string,
  init: RequestInit,
  fallback: string,
  acceptedFailureCodes: number[] = [],
) {
  const response = await safetyRequest(jar, `${SAFETY_PLATFORM_BASE}${path}`, init);
  if (!response.ok) {
    throw new Error(`江苏省大学生安全教育平台请求失败（${response.status}）：${path}`);
  }
  let payload: SafetyApiResponse;
  try {
    payload = await response.json() as SafetyApiResponse;
  } catch {
    throw new Error(`江苏省大学生安全教育平台返回了无法解析的数据：${path}`);
  }
  if (!isSuccessfulSafetyResponse(payload) && !acceptedFailureCodes.includes(Number(payload.code))) {
    throw new Error(getSafetyErrorMessage(payload, fallback));
  }
  return payload;
}

async function safetyPostForm(
  jar: SafetyCookieJar,
  path: string,
  fields: Array<[string, string]>,
  fallback: string,
  referer?: string,
  acceptedFailureCodes?: number[],
) {
  const body = new URLSearchParams(fields);
  return readSafetyJson(
    jar,
    path,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        ...(referer ? { Referer: referer } : {}),
      },
      body,
    },
    fallback,
    acceptedFailureCodes,
  );
}

async function safetyGet(
  jar: SafetyCookieJar,
  path: string,
  params: Record<string, string>,
  fallback: string,
  referer?: string,
) {
  const query = new URLSearchParams(params);
  return readSafetyJson(
    jar,
    `${path}?${query.toString()}`,
    { method: "GET", headers: referer ? { Referer: referer } : undefined },
    fallback,
  );
}

function normalizeCredentialPart(value: string, maxLength: number) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maxLength || /[\r\n]/.test(normalized)) return "";
  return normalized;
}

export function validateSafetyPlatformCredentials(input: SafetyPlatformCredentials) {
  const username = normalizeCredentialPart(input.username, 128);
  const password = normalizeCredentialPart(input.password, 256);
  if (!username || !password) return null;
  return { username, password };
}

export function parseSafetyPlatformCredentials(message: string) {
  const normalized = String(message || "").trim();
  if (!normalized || /[\r\n]/.test(normalized)) return null;
  const match = normalized.match(/^(\S+)\s+(.+)$/);
  if (!match) return null;
  return validateSafetyPlatformCredentials({ username: match[1], password: match[2] });
}

export async function loginSafetyPlatform(input: SafetyPlatformCredentials): Promise<SafetyPlatformSession> {
  const credentials = validateSafetyPlatformCredentials(input);
  if (!credentials) throw new Error("用户名或密码格式不正确，请按“用户名 密码”重新发送。");

  const jar = new SafetyCookieJar();
  const payload = await safetyPostForm(
    jar,
    "/wap/jsUserLogin",
    [
      ["openId", ""],
      ["account", credentials.username],
      ["collegeId", SAFETY_PLATFORM_COLLEGE_ID],
      ["password", credentials.password],
    ],
    "登录失败，请检查用户名、密码是否正确。",
    `${SAFETY_PLATFORM_BASE}/wap/jiangsuwxJsback`,
  );
  const userId = String(payload.data?.userId || "").trim();
  if (!userId) throw new Error(getSafetyErrorMessage(payload, "登录失败，平台没有返回用户信息。"));
  return { jar, userId, collegeId: SAFETY_PLATFORM_COLLEGE_ID };
}

function buildQuestionIndex() {
  const index = new Map<string, SafetyTikuRow[]>();
  for (const row of tiku as SafetyTikuRow[]) {
    const questionId = String(row.questionId || "").trim();
    if (!questionId) continue;
    const list = index.get(questionId);
    if (list) list.push(row);
    else index.set(questionId, [row]);
  }
  return index;
}

const safetyAnswerIndex = buildQuestionIndex();

function answerTupleForQuestion(questionId: string, quesType?: string | number) {
  const rows = safetyAnswerIndex.get(String(questionId));
  if (!rows?.length) return null;
  const type = String(quesType || rows[0].quesType);
  if (type === "2") {
    const letters = rows
      .flatMap((row) => String(row.answer || "").trim().split(/[,，\s]+/))
      .filter((answer) => /^[A-F]$/.test(answer));
    if (!letters.length) return null;
    return {
      question: letters.map((answer) => `~${questionId}-${answer}`).join(""),
      questionId,
      quesType: type,
    };
  }
  const answer = String(rows[0].answer || "").trim();
  if (!answer) return null;
  return {
    question: `${questionId}-${answer === "正确" ? "1" : answer === "错误" ? "0" : answer}`,
    questionId,
    quesType: type,
  };
}

export function getSafetyAnswerRows(questionId: string) {
  return safetyAnswerIndex.get(String(questionId)) ?? null;
}

export function buildSafetyAnswerTuples(questionId: string, quesType?: string | number) {
  return answerTupleForQuestion(String(questionId), quesType);
}

async function getSafetyCourseList(session: SafetyPlatformSession, courseType: "1" | "2") {
  const payload = await safetyPostForm(
    session.jar,
    "/wap/compulsory/list",
    [
      ["name", ""],
      ["courseType", courseType],
      ["userId", session.userId],
      ["collegeId", session.collegeId],
      ["ah", ""],
    ],
    "获取安全教育课程列表失败，请稍后重试。",
  );
  if (!Array.isArray(payload.data)) throw new Error("安全教育平台返回的课程列表格式异常。");
  return payload.data as SafetyCourse[];
}

async function getSafetyArticles(session: SafetyPlatformSession, courseId: string) {
  const payload = await safetyPostForm(
    session.jar,
    "/wap/directory/list",
    [
      ["name", ""],
      ["courseId", courseId],
      ["userId", session.userId],
      ["collegeId", session.collegeId],
      ["ah", ""],
    ],
    "获取安全教育课程目录失败，请稍后重试。",
  );
  const chapters = Array.isArray(payload.data) ? payload.data : [];
  return chapters.flatMap((chapter: { list?: SafetyArticle[] }) => Array.isArray(chapter?.list) ? chapter.list : [])
    .filter((article) => !article.isFinsh && String(article.id || "").trim());
}

async function getSafetyArticleQuestions(session: SafetyPlatformSession, articleId: string) {
  const payload = await safetyGet(
    session.jar,
    "/wap/question/list",
    { articleId, ah: "" },
    "获取安全教育题目失败，请稍后重试。",
  );
  const questions = payload.data?.list;
  if (!Array.isArray(questions)) throw new Error("安全教育平台返回的题目列表格式异常。");
  return questions as SafetyQuestion[];
}

function buildUnitAnswers(
  userId: string,
  courseName: string,
  articleId: string,
  questions: SafetyQuestion[],
) {
  const answers: Array<[string, string]> = [
    ["articleId", articleId],
    ["title", courseName],
    ["userId", userId],
    ["ah", ""],
  ];
  const missing: string[] = [];
  for (const question of questions) {
    const questionId = String(question.id || question.questionId || "").trim();
    if (!questionId) {
      missing.push("unknown");
      continue;
    }
    const answer = answerTupleForQuestion(questionId, question.quesType);
    if (!answer) {
      missing.push(questionId);
      continue;
    }
    answers.push(["question", answer.question], ["quesType", answer.quesType]);
  }
  return { answers, missing };
}

async function createSafetyUnitAttempt(session: SafetyPlatformSession, articleId: string) {
  const payload = await safetyPostForm(
    session.jar,
    "/wap/unitTest/create",
    [
      ["userId", session.userId],
      ["articleId", articleId],
    ],
    "创建课程答题会话失败，请稍后重试。",
  );
  const logId = String(payload.data?.logId || "").trim();
  const token = String(payload.data?.token || "").trim();
  if (!logId || !token) {
    throw new Error(describeMissingCredential(payload, "平台没有返回课程提交凭证，请稍后重试。"));
  }
  return { logId, token, createdAt: Date.now() };
}

async function waitForMinimumActionDelay(createdAt: number, delayMs: number) {
  const remainingMs = Math.max(0, delayMs - (Date.now() - createdAt));
  if (remainingMs > 0) await sleep(remainingMs);
}

async function completeSafetyArticle(
  session: SafetyPlatformSession,
  courseName: string,
  articleId: string,
  options: Required<SafetyPlatformRunOptions>,
) {
  // 新版平台会在 create 时签发与当前章节、开始时间绑定的提交凭证。
  // 必须先创建会话，再读取题目并补足最短答题时长；顺序与平台页面及上游脚本保持一致。
  const attempt = await createSafetyUnitAttempt(session, articleId);
  const questions = await getSafetyArticleQuestions(session, articleId);
  if (!questions.length) return;
  const { answers, missing } = buildUnitAnswers(session.userId, courseName, articleId, questions);
  if (missing.length) {
    throw new Error(`课程“${courseName}”有 ${missing.length} 道题不在当前题库中，已停止提交，题目：${missing.join("、")}`);
  }
  await waitForMinimumActionDelay(attempt.createdAt, options.minimumActionDelayMs);
  const payload = await safetyPostForm(
    session.jar,
    "/wap/unitTest",
    [...answers, ["logId", attempt.logId], ["token", attempt.token]],
    `课程“${courseName}”提交失败，请稍后重试。`,
  );
  if (!payload.data?.isSuccess) {
    throw new Error(getSafetyErrorMessage(payload, `课程“${courseName}”未完成。`));
  }
}

async function completeSafetyCourses(
  session: SafetyPlatformSession,
  emit: (message: string) => Promise<void>,
  options: Required<SafetyPlatformRunOptions>,
) {
  const courseGroups = await Promise.all([
    getSafetyCourseList(session, "2"),
    getSafetyCourseList(session, "1"),
  ]);
  const courses = courseGroups.flat();
  const unfinished = courses.filter((course) => !course.isFinsh);
  if (unfinished.length) {
    await emit(`正在完成 ${unfinished.length} 门未完成课程，请稍候。`);
    for (const course of unfinished) {
      const courseName = String(course.name || "未命名课程");
      const courseId = String(course.id || "").trim();
      if (!courseId) throw new Error(`课程“${courseName}”缺少课程编号。`);
      // 2026 新版只会为每门课的固定结课测验章节签发 token；目录中的普通内容章节
      // 即使 question/list 有数据，也可能从 unitTest/create 得到 code=200 但无凭证。
      const fixedArticleId = SAFETY_UNIT_ARTICLE_IDS[courseName.trim()];
      const articles = fixedArticleId ? [{ id: fixedArticleId }] : await getSafetyArticles(session, courseId);
      for (const article of articles) {
        await completeSafetyArticle(session, courseName, String(article.id), options);
      }
      await emit(`已处理课程：${courseName}`);
    }
  }

  const verifiedGroups = await Promise.all([
    getSafetyCourseList(session, "2"),
    getSafetyCourseList(session, "1"),
  ]);
  const remaining = verifiedGroups.flat().filter((course) => !course.isFinsh);
  if (remaining.length) {
    throw new Error(`仍有 ${remaining.length} 门必修课程未完成，请稍后重试。`);
  }
  return verifiedGroups.flat()
    .map((course) => String(course.name || "未命名课程"))
    .filter(Boolean);
}

async function getSafetyExamId(session: SafetyPlatformSession) {
  const payload = await safetyPostForm(
    session.jar,
    "/wap/test/getTest",
    [
      ["examType", "2"],
      ["examClass", "20"],
      ["userId", session.userId],
      ["ah", ""],
    ],
    "获取考试配置失败，请确认必修课程已经完成。",
  );
  const examId = String(payload.data?.id || "").trim();
  if (!examId) throw new Error("平台没有返回有效的考试编号，请稍后重试。");
  return examId;
}

async function createSafetyExam(session: SafetyPlatformSession, examId: string) {
  const payload = await safetyPostForm(
    session.jar,
    "/wap/test/create",
    [
      ["examId", examId],
      ["userId", session.userId],
      ["ah", ""],
    ],
    "创建考试失败，请确认必修课程已经完成。",
  );
  const logId = String(payload.data?.logId || "").trim();
  const token = String(payload.data?.token || "").trim();
  if (!logId || !token) {
    throw new Error(describeMissingCredential(payload, "平台没有返回考试提交凭证，请稍后重试。"));
  }
  return { logId, token, createdAt: Date.now() };
}

async function getSafetyExamQuestions(session: SafetyPlatformSession, logId: string, examId: string) {
  const payload = await safetyGet(
    session.jar,
    "/wap/test/list",
    { logId, page: "1", limit: "200", ah: "", userId: session.userId },
    "获取考试题目失败，请稍后重试。",
    `${SAFETY_PLATFORM_BASE}/wap/newStudentssimulate?examId=${encodeURIComponent(examId)}&examType=2&userId=${encodeURIComponent(session.userId)}&ah`,
  );
  const rows = payload.data?.data;
  if (!Array.isArray(rows) || !rows.length) throw new Error("考试没有返回题目，请稍后重试。");
  return rows as SafetyExamRow[];
}

async function submitSafetyExam(
  session: SafetyPlatformSession,
  examId: string,
  logId: string,
  token: string,
  rows: SafetyExamRow[],
  createdAt: number,
  options: Required<SafetyPlatformRunOptions>,
) {
  const fields: Array<[string, string]> = [
    ["examId", examId],
    ["examType", "2"],
    ["sysSource", "20"],
    ["logId", logId],
    ["userId", session.userId],
    ["ah", ""],
    ["token", token],
  ];
  const missing: string[] = [];
  for (const row of rows) {
    const question = row.question;
    const questionId = String(question?.id || question?.questionId || row.questionId || "").trim();
    if (!questionId) {
      missing.push("unknown");
      continue;
    }
    const answer = answerTupleForQuestion(questionId, question?.quesType);
    if (!answer) {
      missing.push(questionId);
      continue;
    }
    fields.push(["question", answer.question], ["questionId", answer.questionId], ["quesType", answer.quesType]);
  }
  if (missing.length) {
    throw new Error(`考试题库缺少 ${missing.length} 道题，已停止交卷，题目：${missing.join("、")}`);
  }
  await waitForMinimumActionDelay(createdAt, options.minimumActionDelayMs);
  let payload: SafetyApiResponse | undefined;
  for (let attempt = 0; attempt <= SAFETY_SHORT_DURATION_MAX_RETRIES; attempt += 1) {
    payload = await safetyPostForm(
      session.jar,
      "/wap/imitateTest",
      fields,
      "考试提交失败，请稍后重试。",
      `${SAFETY_PLATFORM_BASE}/wap/newStudentssimulate?examId=${encodeURIComponent(examId)}&examType=2&userId=${encodeURIComponent(session.userId)}&ah`,
      [1006],
    );
    if (Number(payload.code) !== 1006) break;
    if (attempt === SAFETY_SHORT_DURATION_MAX_RETRIES) {
      throw new Error("平台持续提示答题时间过短，请稍后重新发送“刷课”重试。");
    }
    await sleep(options.shortDurationRetryDelayMs);
  }
  if (!payload) throw new Error("考试提交失败，请稍后重试。");
  if (!payload.data?.isSuccess) throw new Error(getSafetyErrorMessage(payload, "考试未通过，请稍后重试。"));
  const score = Number(payload.data?.count);
  if (!Number.isFinite(score)) throw new Error("考试提交成功，但平台没有返回有效分数。");
  return score;
}

export function buildSafetyCertificateUrl(userId: string) {
  return `${SAFETY_PLATFORM_BASE}/wap/qrCode?userId=${encodeURIComponent(userId)}`;
}

export type SafetyPlatformProgress = (message: string) => void | Promise<void>;

export type SafetyPlatformRunResult = {
  score: number;
  certificateUrl: string;
  completedCourses: string[];
  fullScore: boolean;
};

export async function runSafetyPlatform(
  credentials: SafetyPlatformCredentials,
  onProgress?: SafetyPlatformProgress,
  runOptions: SafetyPlatformRunOptions = {},
): Promise<SafetyPlatformRunResult> {
  const options: Required<SafetyPlatformRunOptions> = {
    minimumActionDelayMs: Math.max(0, runOptions.minimumActionDelayMs ?? SAFETY_MIN_ACTION_DELAY_MS),
    shortDurationRetryDelayMs: Math.max(0, runOptions.shortDurationRetryDelayMs ?? SAFETY_SHORT_DURATION_RETRY_DELAY_MS),
  };
  const session = await loginSafetyPlatform(credentials);
  const emit = async (message: string) => {
    if (onProgress) await onProgress(message);
  };
  const completedCourses = await completeSafetyCourses(session, emit, options);
  await emit("必修课程已完成，正在准备考试。");
  const examId = await getSafetyExamId(session);
  const exam = await createSafetyExam(session, examId);
  const rows = await getSafetyExamQuestions(session, exam.logId, examId);
  await emit(`已获取 ${rows.length} 道考试题目，正在提交答案。`);
  const score = await submitSafetyExam(session, examId, exam.logId, exam.token, rows, exam.createdAt, options);
  return {
    score,
    certificateUrl: buildSafetyCertificateUrl(session.userId),
    completedCourses,
    fullScore: score === 100,
  };
}
