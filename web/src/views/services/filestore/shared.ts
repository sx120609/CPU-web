import type {
  FilestoreCreator,
  FilestoreField,
  FilestoreRules,
  FilestoreStatus,
  FilestoreSubmission,
  FilestoreSurveyAnswer,
  FilestoreSurveyField,
  FilestoreTask,
  FilestoreTaskPayload,
  FilestoreTemplate,
} from "@/api/filestore";
import type { QuestionnaireFieldType } from "@/api/tools";

export interface FilestoreDraft {
  title: string;
  description: string;
  deadline: string;
  status: FilestoreStatus;
  allowedTypes: string;
  maxSizeMb: number;
  maxCount: number;
  renameTemplate: string;
  folderTemplate: string;
  expectedEntries: string;
  fields: FilestoreField[];
  surveyFields: FilestoreSurveyField[];
  renameExistingFiles: boolean;
}

export const builtInFilestoreTemplates: FilestoreTemplate[] = [
  {
    name: "学号模板",
    description: "适合按姓名和学号收作业、照片、报名材料。",
    fields: [
      { id: "name", key: "name", label: "姓名", required: true, pattern: "^[\\u4e00-\\u9fa5·]{2,20}$", placeholder: "请输入中文姓名" },
      { id: "student_id", key: "student_id", label: "学号", required: true, pattern: "^2020\\d{6}$", placeholder: "例如 2020240444" },
    ],
    surveyFields: [],
    fileRules: { allowedTypes: ["pdf", "doc", "docx", "jpg", "png", "zip"], maxSizeMb: 20, maxCount: 1 },
    renameTemplate: "{name}-{student_id}",
    folderTemplate: "{name}-{student_id}",
    expectedEntries: "",
  },
  {
    name: "考试号模板",
    description: "适合按姓名和考试号收准考证、考试材料或确认文件。",
    fields: [
      { id: "name", key: "name", label: "姓名", required: true, pattern: "^[\\u4e00-\\u9fa5·]{2,20}$", placeholder: "请输入中文姓名" },
      { id: "student_id", key: "student_id", label: "考试号", required: true, pattern: "^24201505\\d{2}$", placeholder: "例如 2420150508" },
    ],
    surveyFields: [],
    fileRules: { allowedTypes: ["pdf", "jpg", "png", "zip"], maxSizeMb: 20, maxCount: 1 },
    renameTemplate: "{name}-{student_id}",
    folderTemplate: "{name}-{student_id}",
    expectedEntries: "",
  },
];

export function createFilestoreDraft(): FilestoreDraft {
  return {
    title: "",
    description: "",
    deadline: "",
    status: "open",
    allowedTypes: "pdf,doc,docx,jpg,png,zip",
    maxSizeMb: 20,
    maxCount: 1,
    renameTemplate: "{name}-{student_id}",
    folderTemplate: "{name}-{student_id}",
    expectedEntries: "",
    fields: cloneFields(builtInFilestoreTemplates[0].fields),
    surveyFields: [],
    renameExistingFiles: false,
  };
}

export function cloneFields(fields: FilestoreField[]) {
  return fields.map((field) => ({
    id: field.key || field.id,
    key: field.key || field.id,
    label: field.label,
    required: field.required !== false,
    pattern: field.pattern || "",
    placeholder: field.placeholder || "",
  }));
}

export function makeFilestoreField(index: number): FilestoreField {
  const key = `field_${index + 1}`;
  return {
    id: key,
    key,
    label: "新字段",
    required: true,
    pattern: "",
    placeholder: "",
  };
}

export const filestoreSurveyFieldTypes: Array<{ value: QuestionnaireFieldType; label: string }> = [
  { value: "text", label: "短文本" },
  { value: "textarea", label: "长文本" },
  { value: "single", label: "单选" },
  { value: "multiple", label: "多选" },
  { value: "number", label: "数字" },
  { value: "date", label: "日期" },
  { value: "rating", label: "评分" },
];

export function makeFilestoreSurveyField(index: number, type: QuestionnaireFieldType = "text"): FilestoreSurveyField {
  const id = `q_${index + 1}`;
  const field: FilestoreSurveyField = {
    id,
    label: "",
    type,
    required: false,
    placeholder: "",
    description: "",
    maxLength: type === "textarea" ? 2000 : 300,
  };
  return normalizeFilestoreSurveyField(field, true);
}

export function cloneSurveyFields(fields: FilestoreSurveyField[] = []) {
  return fields.map((field, index) => normalizeFilestoreSurveyField({
    ...field,
    id: normalizeSurveyFieldId(field.id) || `q_${index + 1}`,
    options: [...(field.options || [])],
    branching: field.branching ? { ...field.branching } : undefined,
  }, true));
}

export function normalizeSurveyFieldId(value: string) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export function normalizeFilestoreSurveyField(field: FilestoreSurveyField, allowUntitled = false): FilestoreSurveyField {
  const type = filestoreSurveyFieldTypes.some((item) => item.value === field.type) ? field.type : "text";
  const normalized: FilestoreSurveyField = {
    id: normalizeSurveyFieldId(field.id),
    label: field.label?.trim() || (allowUntitled ? "" : "未命名题目"),
    type,
    required: Boolean(field.required),
    placeholder: field.placeholder?.trim() || undefined,
    description: field.description?.trim() || undefined,
    maxLength: field.maxLength,
  };
  if (type === "single" || type === "multiple") {
    normalized.options = (field.options || []).map((item) => String(item || "").trim()).filter(Boolean).slice(0, 20);
    if (!normalized.options.length && allowUntitled) normalized.options = ["选项1", "选项2"];
    if (field.branching && type === "single") normalized.branching = { ...field.branching };
  }
  if (type === "number") {
    normalized.min = field.min;
    normalized.max = field.max;
    normalized.step = field.step || 1;
  }
  if (type === "rating") {
    normalized.min = Math.max(0, Math.round(Number(field.min ?? 1)));
    normalized.max = Math.min(10, Math.round(Number(field.max ?? 5)));
  }
  if (type === "text") normalized.maxLength = field.maxLength || 300;
  if (type === "textarea") normalized.maxLength = field.maxLength || 2000;
  return normalized;
}

export function normalizeFilestoreSurveyFields(fields: FilestoreSurveyField[]) {
  return fields.map((field) => normalizeFilestoreSurveyField(field)).filter((field) => field.id && field.label);
}

export function applyTemplateToDraft(draft: FilestoreDraft, template: FilestoreTemplate, resetTitle = false) {
  if (resetTitle) {
    draft.title = "";
    draft.description = "";
    draft.deadline = "";
    draft.status = "open";
  } else if (!draft.description.trim() && template.description) {
    draft.description = template.description;
  }
  draft.fields = cloneFields(template.fields);
  draft.surveyFields = cloneSurveyFields(template.surveyFields || []);
  draft.allowedTypes = template.fileRules.allowedTypes.join(",");
  draft.maxSizeMb = template.fileRules.maxSizeMb;
  draft.maxCount = template.fileRules.maxCount;
  draft.renameTemplate = template.renameTemplate || "{name}-{student_id}";
  draft.folderTemplate = template.folderTemplate || "{name}-{student_id}";
  draft.expectedEntries = template.expectedEntries || "";
}

export function normalizeFilestoreRules(draft: Pick<FilestoreDraft, "allowedTypes" | "maxSizeMb" | "maxCount">): FilestoreRules {
  return {
    allowedTypes: normalizeAllowedTypes(draft.allowedTypes),
    maxSizeMb: Number(draft.maxSizeMb) || 20,
    maxCount: Number(draft.maxCount) || 1,
  };
}

export function normalizeAllowedTypes(value: string | string[]) {
  const list = Array.isArray(value) ? value : value.split(",");
  return Array.from(new Set(
    list
      .map((item) => String(item || "").trim().toLowerCase().replace(/^\.+/, ""))
      .filter(Boolean),
  ));
}

export function normalizeFilestoreFields(fields: FilestoreField[]) {
  return fields.map((field) => {
    const key = normalizeFieldKey(field.key || field.id);
    return {
      id: key,
      key,
      label: field.label.trim(),
      required: field.required !== false,
      pattern: field.pattern.trim(),
      placeholder: field.placeholder.trim(),
    };
  });
}

export function buildFilestorePayload(draft: FilestoreDraft): FilestoreTaskPayload {
  return {
    title: draft.title.trim(),
    description: draft.description.trim(),
    deadline: draft.deadline ? new Date(draft.deadline).toISOString() : null,
    status: draft.status,
    fields: normalizeFilestoreFields(draft.fields),
    surveyFields: normalizeFilestoreSurveyFields(draft.surveyFields),
    fileRules: normalizeFilestoreRules(draft),
    renameTemplate: draft.renameTemplate.trim() || "{name}-{student_id}",
    folderTemplate: draft.folderTemplate.trim() || "{name}-{student_id}",
    expectedEntries: draft.expectedEntries.trim(),
    renameExistingFiles: draft.renameExistingFiles,
  };
}

export function validateFilestoreDraft(draft: FilestoreDraft) {
  if (!draft.title.trim()) return "请填写任务标题";
  const fields = normalizeFilestoreFields(draft.fields);
  if (!fields.length) return "至少需要一个填写字段";
  if (fields.some((field) => !field.key || !field.label)) return "字段变量和名称不能为空";
  if (new Set(fields.map((field) => field.key)).size !== fields.length) return "字段变量不能重复";
  const invalid = fields.find((field) => !/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(field.key));
  if (invalid) return `变量“${invalid.key}”只能包含中文、英文、数字和下划线`;
  for (const field of fields) {
    if (!field.pattern) continue;
    try {
      new RegExp(field.pattern);
    } catch {
      return `字段“${field.label}”的正则规则不合法`;
    }
  }
  for (const field of draft.surveyFields) {
    if (!normalizeSurveyFieldId(field.id)) return "问卷题目 ID 不能为空";
    if (!field.label?.trim()) return "问卷题目标题不能为空";
  }
  const surveyFields = normalizeFilestoreSurveyFields(draft.surveyFields);
  if (new Set(surveyFields.map((field) => field.id)).size !== surveyFields.length) return "问卷题目 ID 不能重复";
  for (const field of surveyFields) {
    if (!/^[a-zA-Z0-9_-]+$/.test(field.id)) return `问卷题目 ID“${field.id}”只能包含英文、数字、下划线和中划线`;
    if ((field.type === "single" || field.type === "multiple") && (!field.options || field.options.length < 2)) {
      return `选项题“${field.label}”至少需要 2 个选项`;
    }
    if (field.type === "number" && field.min !== undefined && field.max !== undefined && field.min > field.max) {
      return `数字题“${field.label}”的最小值不能大于最大值`;
    }
    if (field.type === "rating" && Number(field.min ?? 1) >= Number(field.max ?? 5)) {
      return `评分题“${field.label}”的最高分需要大于最低分`;
    }
  }
  const rules = normalizeFilestoreRules(draft);
  if (rules.maxSizeMb <= 0 || rules.maxSizeMb > 100) return "单文件大小必须在 0 到 100 MB 之间";
  if (rules.maxCount <= 0 || rules.maxCount > 20) return "文件数量必须在 1 到 20 个之间";
  return "";
}

export function normalizeFieldKey(value: string) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export function statusText(status: FilestoreStatus) {
  return status === "open" ? "开放提交" : "停止提交";
}

export function formatDateTime(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatDateForInput(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60 * 1000).toISOString().slice(0, 16);
}

export function safeFileName(value: string) {
  return String(value || "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[. ]+|[. ]+$/g, "")
    .slice(0, 160) || "file";
}

export function cleanRenderedName(value: string) {
  return safeFileName(value).replace(/[-_ ]{2,}/g, "-").replace(/^[\s\-_.]+|[\s\-_.]+$/g, "") || "file";
}

export function renderFilestoreTemplate(template: string, data: Record<string, string>, originalName = "", index = 1, totalCount = 1) {
  const dot = originalName.lastIndexOf(".");
  const original = dot > 0 ? originalName.slice(0, dot) : originalName;
  const values: Record<string, string> = {
    ...Object.fromEntries(Object.entries(data).map(([key, value]) => [key, safeFileName(value)])),
    original: safeFileName(original),
    index: totalCount > 1 ? String(index) : "",
  };
  const rendered = String(template || "{name}-{student_id}").replace(/\{([a-zA-Z0-9_\u4e00-\u9fa5]+)(?:\|(last|first):(\d{1,2}))?\}/g, (_match, key, op, rawCount) => {
    const value = values[key] || "";
    const count = Number(rawCount || 0);
    if (op === "last") return count > 0 ? value.slice(-count) : "";
    if (op === "first") return count > 0 ? value.slice(0, count) : "";
    return value;
  });
  return cleanRenderedName(rendered);
}

export function previewStoredFileName(template: string, data: Record<string, string>, fileName: string, index: number, totalCount: number) {
  const dot = fileName.lastIndexOf(".");
  const ext = dot > 0 ? fileName.slice(dot).toLowerCase() : "";
  const base = renderFilestoreTemplate(template, data, fileName, index, totalCount);
  const withIndex = totalCount > 1 && !template.includes("{index}") ? `${base}-${index}` : base;
  return `${withIndex}${ext}`;
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename || "download";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function openDirectUrl(url: string, filename: string, action: "download" | "preview") {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener noreferrer";
  if (action === "preview") anchor.target = "_blank";
  if (action === "download" && filename) anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

export function requestErrorMessage(error: unknown, fallback = "操作失败") {
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return fallback;
}

export function formatDateOnly(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("zh-CN");
}

export function formatCreator(user?: FilestoreCreator | null) {
  if (!user) return "未绑定";
  return `${user.displayName || user.username || "未命名"}（${user.username || user.userId}）`;
}

export function formatSurveyAnswer(value: FilestoreSurveyAnswer | undefined) {
  return Array.isArray(value) ? value.join("、") : String(value || "");
}

export function unexpectedLabel(item: { id: number; name: string; identity: string }) {
  return item.identity || item.name || `#${item.id}`;
}

export function fileTotal(task: Pick<FilestoreTask, "submissions">) {
  return (task.submissions || []).reduce((sum, submission) => sum + submission.files.length, 0);
}

export function submitPath(slug: string) {
  return `/services/tools/filestore/submit/${slug}`;
}

export function statusPath(slug: string) {
  return `/services/tools/filestore/status/${slug}`;
}

export function absoluteUrl(path: string) {
  return new URL(path, window.location.origin).toString();
}

// 提交人展示名：优先姓名，其次第一个身份字段，最后用提交编号兜底。
export function submissionOwner(task: Pick<FilestoreTask, "fields">, submission: FilestoreSubmission) {
  return submission.data.name || submission.data[task.fields[0]?.key || ""] || `#${submission.id}`;
}

export function submissionIdentifier(task: Pick<FilestoreTask, "fields">, submission: FilestoreSubmission) {
  const owner = submissionOwner(task, submission);
  return submission.data.student_id || task.fields.map((field) => submission.data[field.key]).find((value) => value && value !== owner) || "";
}

export function fileExt(fileName: string) {
  return fileName.includes(".") ? fileName.split(".").pop()!.trim().toLowerCase().replace(/^\.+/, "") : "";
}

export function fileKind(fileName: string) {
  const ext = fileExt(fileName);
  if (["jpg", "jpeg", "png", "webp", "gif", "heic", "bmp"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (["doc", "docx", "wps", "rtf", "txt", "md"].includes(ext)) return "doc";
  if (["xls", "xlsx", "csv"].includes(ext)) return "sheet";
  if (["ppt", "pptx", "key"].includes(ext)) return "slide";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "archive";
  return "file";
}
