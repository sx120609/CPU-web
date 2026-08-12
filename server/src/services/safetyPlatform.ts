import tiku from "./safetyPlatformTiku.json";

const SAFETY_PLATFORM_BASE = "http://wap.xiaoyuananquantong.com/guns-vip-main";
const SAFETY_PLATFORM_COLLEGE_ID = "1224316234189443073";
const SAFETY_EXAM_ID = "1948924196784492546";
const SAFETY_EXAM_QUESTION_COUNT = 50;
const SAFETY_REQUEST_TIMEOUT_MS = 15_000;

type SafetyUnitPayload = {
  articleId: string;
  title: string;
  userId: string;
  ah: string;
  question: string;
  quesType: string;
};

const SAFETY_UNITS: SafetyUnitPayload[] = [
  { articleId: "2080135073788600321", title: "题库学习", userId: "", ah: "", question: "2080136617019842561-1", quesType: "3" },
  { articleId: "2079132357549375490", title: "入学安全", userId: "", ah: "", question: "2079154657984266242-1", quesType: "3" },
  { articleId: "2079133938168643585", title: "国家安全", userId: "", ah: "", question: "2079156723934838786-B", quesType: "1" },
  { articleId: "2079139032318623745", title: "财物安全", userId: "", ah: "", question: "2079446660177477633-1", quesType: "3" },
  { articleId: "2079140991327027201", title: "心理健康", userId: "", ah: "", question: "2079467760328392705-D", quesType: "1" },
  { articleId: "2079142411614830593", title: "消防安全", userId: "", ah: "", question: "2079492272201678850-C", quesType: "1" },
  { articleId: "2079143452481699842", title: "人身安全", userId: "", ah: "", question: "2079527272678703105-1", quesType: "3" },
  { articleId: "2079144978977669121", title: "交通安全", userId: "", ah: "", question: "2079540470853156866-A", quesType: "1" },
  { articleId: "2079146093836255234", title: "禁毒防艾", userId: "", ah: "", question: "2079548501443756034-1", quesType: "3" },
  { articleId: "2079146628521934850", title: "应急救护", userId: "", ah: "", question: "~2079553855799967746-A~2079553855799967746-B~2079553855799967746-C~2079553855799967746-D", quesType: "2" },
  { articleId: "2079147344531570690", title: "防灾减灾", userId: "", ah: "", question: "2079558043292418049-D", quesType: "1" },
];

type SafetyTikuRow = {
  questionId: string;
  answer: string;
  quesType: string;
};

const safetyAnswerIndex = (() => {
  const index = new Map<string, SafetyTikuRow[]>();
  for (const row of tiku as SafetyTikuRow[]) {
    const list = index.get(row.questionId);
    if (list) list.push(row);
    else index.set(row.questionId, [row]);
  }
  return index;
})();

async function safetyPostForm(path: string, fields: Record<string, unknown>) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) body.append(key, String(value));
  }
  const response = await fetch(`${SAFETY_PLATFORM_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body,
    signal: AbortSignal.timeout(SAFETY_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`安全平台请求失败（${response.status}）：${path}`);
  return response.json() as Promise<any>;
}

async function safetyGet(path: string, params: Record<string, unknown>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) query.append(key, String(value));
  }
  const response = await fetch(`${SAFETY_PLATFORM_BASE}${path}?${query.toString()}`, {
    method: "GET",
    signal: AbortSignal.timeout(SAFETY_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`安全平台请求失败（${response.status}）：${path}`);
  return response.json() as Promise<any>;
}

export function isValidSafetyUserId(userId: string) {
  return /^\d{19}$/.test(userId);
}

export function extractSafetyUserIdFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    const userId = parsed.searchParams.get("userId")
      || parsed.searchParams.get("userid")
      || parsed.searchParams.get("user_id");
    return userId ?? "";
  } catch {
    return "";
  }
}

export function extractSafetyPlatformUrlFromText(text: string) {
  const match = String(text || "").trim().match(/https?:\/\/[^\s<>"']+/i);
  if (!match) return "";
  const url = match[0];
  const cut = url.search(/[^\x00-\x7E]/);
  const truncated = cut === -1 ? url : url.slice(0, cut);
  return truncated.replace(/[)\]}>]+$/, "").trim();
}

export function isSafetyPlatformJshomeUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(String(url || "").trim());
  } catch {
    return false;
  }
  const isHttp = parsed.protocol === "http:" || parsed.protocol === "https:";
  const isJshome = parsed.hostname === "wap.xiaoyuananquantong.com"
    && parsed.pathname === "/guns-vip-main/wap/jshome";
  if (!isHttp || !isJshome) return false;
  return Boolean(
    parsed.searchParams.get("userId")
    || parsed.searchParams.get("userid")
    || parsed.searchParams.get("user_id"),
  );
}

export async function getSafetyCourseList(userId: string) {
  const data = await safetyPostForm("/wap/compulsory/list", {
    userId,
    collegeId: SAFETY_PLATFORM_COLLEGE_ID,
  });
  return data.data as Array<{ name?: string; isFinsh?: boolean }>;
}

export async function completeSafetyUnit(userId: string, index: number) {
  const unit = SAFETY_UNITS[index];
  if (!unit) throw new Error(`未知的课程序号：${index}`);
  const data = await safetyPostForm("/wap/unitTest", { ...unit, userId });
  return data;
}

export async function createSafetyExam(userId: string) {
  const data = await safetyPostForm("/wap/test/create", {
    examId: SAFETY_EXAM_ID,
    userId,
  });
  return data;
}

export async function getSafetyExamQuestions(logId: string, userId: string) {
  return safetyGet("/wap/test/list", {
    logId,
    page: 1,
    limit: 200,
    ah: "",
    userId,
  });
}

export async function getSafetyExamId(userId: string) {
  return safetyPostForm("/wap/test/getTest", {
    examType: 2,
    examClass: 20,
    userId,
    ah: "",
  });
}

export function getSafetyAnswerRows(questionId: string) {
  return safetyAnswerIndex.get(questionId) ?? null;
}

export function buildSafetyAnswerTuples(questionId: string) {
  const rows = safetyAnswerIndex.get(questionId);
  if (!rows || rows.length === 0) return null;
  const quesType = rows[0].quesType;
  if (quesType === "2") {
    const question = rows.map((row) => `~${row.questionId}-${row.answer}`).join("");
    return {
      question,
      questionId,
      quesType,
    };
  }
  const row = rows[0];
  return {
    question: `${row.questionId}-${row.answer}`,
    questionId: row.questionId,
    quesType,
  };
}

export async function submitSafetyExam(input: {
  examId: string;
  logId: string;
  userId: string;
  answers: Array<{ question: string; questionId: string; quesType: string }>;
}) {
  const fields: Array<[string, string]> = [
    ["examId", input.examId],
    ["examType", "2"],
    ["sysSource", "20"],
    ["logId", input.logId],
    ["userId", input.userId],
    ["ah", ""],
  ];
  for (const answer of input.answers) {
    fields.push(["question", answer.question], ["questionId", answer.questionId], ["quesType", answer.quesType]);
  }
  const response = await fetch(`${SAFETY_PLATFORM_BASE}/wap/imitateTest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      Referer: `${SAFETY_PLATFORM_BASE}/wap/newStudentssimulate?examId=${input.examId}&examType=2&userId=${input.userId}&ah`,
    },
    body: new URLSearchParams(fields),
    signal: AbortSignal.timeout(SAFETY_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("安全平台考试提交失败");
  return response.json() as Promise<any>;
}

export function buildSafetyCertificateUrl(userId: string) {
  return `${SAFETY_PLATFORM_BASE}/wap/qrCode?userId=${userId}`;
}

export type SafetyPlatformProgress = (message: string) => void | Promise<void>;

export type SafetyPlatformRunResult = {
  score: number;
  certificateUrl: string;
  completedCourses: string[];
};

export async function runSafetyPlatform(userId: string, onProgress?: SafetyPlatformProgress): Promise<SafetyPlatformRunResult> {
  if (!isValidSafetyUserId(userId)) {
    throw new Error("userId 格式不正确，应为 19 位纯数字，请检查你提供的链接。");
  }
  const emit = async (message: string) => {
    if (onProgress) await onProgress(message);
  };

  const courses = await getSafetyCourseList(userId);
  const nameOf = (index: number) => courses[index]?.name || `课程${index + 1}`;
  const unfinished: number[] = [];
  courses.forEach((course, index) => {
    if (!course.isFinsh) unfinished.push(index);
  });

  if (unfinished.length) {
    await emit(`正在完成未学课程：${unfinished.map(nameOf).join("、")}`);
    for (const index of unfinished) {
      await completeSafetyUnit(userId, index);
    }
    const after = await getSafetyCourseList(userId);
    const remaining = after
      .map((course, index) => ({ name: course.name || `课程${index + 1}`, isFinsh: course.isFinsh }))
      .filter((course) => !course.isFinsh)
      .map((course) => course.name);
    if (remaining.length) {
      await emit(`仍有课程未完成：${remaining.join("、")}，尝试继续下一步。`);
    }
  }

  const created = await createSafetyExam(userId);
  const logId = created?.data?.logId;
  if (!logId) throw new Error("创建考试失败，请稍后重试。");

  const examList = await getSafetyExamQuestions(logId, userId);
  const questions = examList?.data?.data ?? [];
  const examData = await getSafetyExamId(userId);
  if (examData?.code === 500) {
    throw new Error("账号未完成内容学习，无法进入考试。可能原因：学校不属于江苏省、脚本题库出错或平台更新。");
  }
  const examId = examData?.data?.id;
  if (!examId) throw new Error("获取考试编号失败，请稍后重试。");

  const answers: Array<{ question: string; questionId: string; quesType: string }> = [];
  const missing: string[] = [];
  for (let i = 0; i < SAFETY_EXAM_QUESTION_COUNT && i < questions.length; i += 1) {
    const questionId = questions[i]?.questionId;
    if (!questionId) continue;
    const answer = buildSafetyAnswerTuples(questionId);
    if (answer) answers.push(answer);
    else missing.push(String(questionId));
  }

  const submitted = await submitSafetyExam({ examId, logId, userId, answers });
  const score = Number(submitted?.data?.count ?? 0);

  const completedCourses = courses
    .map((course, index) => ({ name: course.name || `课程${index + 1}`, isFinsh: course.isFinsh, index }))
    .filter((course) => course.isFinsh || !unfinished.includes(course.index))
    .map((course) => course.name);

  if (score !== 100) {
    throw new Error(`得分 ${score}，未满 100 分（历史遗留问题，题库中有一题出错），可稍后重试一次。`);
  }

  return {
    score,
    certificateUrl: buildSafetyCertificateUrl(userId),
    completedCourses,
  };
}