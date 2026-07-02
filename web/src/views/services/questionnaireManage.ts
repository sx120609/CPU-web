import type {
  Questionnaire,
  QuestionnaireBranchAction,
  QuestionnaireBranchRule,
  QuestionnaireField,
  QuestionnaireFieldType,
  QuestionnaireResponse,
} from "@/api/tools";

export type EditableField = {
  localKey: string;
  id: string;
  label: string;
  type: QuestionnaireFieldType;
  required: boolean;
  placeholder: string;
  description: string;
  optionsText: string;
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  branching: Record<string, QuestionnaireBranchRule>;
};

export type EditableBranchAction = "next" | QuestionnaireBranchAction;

export type FieldStat = {
  field: QuestionnaireField;
  answered: number;
  choices: Array<{ label: string; count: number; percent: number }>;
  numericCount: number;
  average?: number;
  min?: number;
  max?: number;
  samples: string[];
};

export function makeFieldId() {
  return `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function toEditableField(field: QuestionnaireField): EditableField {
  return {
    localKey: randomLocalKey(),
    id: field.id,
    label: field.label,
    type: field.type,
    required: Boolean(field.required),
    placeholder: field.placeholder ?? "",
    description: field.description ?? "",
    optionsText: (field.options ?? []).join("\n"),
    min: field.min,
    max: field.max,
    step: field.step,
    maxLength: field.maxLength,
    branching: cloneBranching(field.branching),
  };
}

export function makeEditableField(type: QuestionnaireFieldType): EditableField {
  const field: EditableField = {
    localKey: randomLocalKey(),
    id: makeFieldId(),
    label: "",
    type,
    required: false,
    placeholder: "",
    description: "",
    optionsText: "",
    branching: {},
  };
  normalizeEditableField(field);
  return field;
}

export function normalizeEditableField(field: EditableField) {
  if (field.type === "single" || field.type === "multiple") {
    if (!field.optionsText.trim()) field.optionsText = "选项1\n选项2";
  } else {
    field.optionsText = "";
  }
  if (field.type === "single") {
    syncBranchRules(field);
  } else {
    field.branching = {};
  }
  if (field.type === "rating") {
    field.min = field.min ?? 1;
    field.max = field.max ?? 5;
    field.step = undefined;
  } else if (field.type === "number") {
    field.step = field.step ?? 1;
  } else if (field.type === "text") {
    field.maxLength = field.maxLength ?? 300;
  } else if (field.type === "textarea") {
    field.maxLength = field.maxLength ?? 2000;
  }
}

export function cloneEditableField(source: EditableField): EditableField {
  return {
    ...source,
    id: makeFieldId(),
    localKey: randomLocalKey(),
    label: source.label ? `${source.label} 副本` : "",
    branching: cloneBranching(source.branching),
  };
}

export function buildFields(fields: EditableField[]): QuestionnaireField[] {
  return fields
    .map((field) => normalizeField(field, false))
    .filter((field): field is QuestionnaireField => Boolean(field));
}

export function normalizeField(field: EditableField, allowUntitled: boolean): QuestionnaireField | null {
  const label = field.label.trim();
  if (!label && !allowUntitled) return null;
  const options = field.type === "single" || field.type === "multiple"
    ? editableOptions(field)
    : undefined;
  const result: QuestionnaireField = {
    id: field.id,
    label: label || "未命名题目",
    type: field.type,
    required: field.required,
    placeholder: field.placeholder.trim() || undefined,
    description: field.description.trim() || undefined,
    options,
    min: field.min,
    max: field.max,
    step: field.step,
    maxLength: field.maxLength,
  };
  const branching = normalizeBranching(field, options ?? []);
  if (branching) result.branching = branching;
  return result;
}

export function editableOptions(field: EditableField) {
  return field.optionsText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

export function cloneBranching(source?: Record<string, QuestionnaireBranchRule>): Record<string, QuestionnaireBranchRule> {
  return Object.fromEntries(
    Object.entries(source ?? {}).map(([option, rule]) => [option, { ...rule }])
  );
}

export function syncBranchRules(field: EditableField) {
  const options = new Set(editableOptions(field));
  for (const option of Object.keys(field.branching)) {
    if (!options.has(option)) delete field.branching[option];
  }
}

export function normalizeBranching(field: EditableField, options: string[]) {
  if (field.type !== "single") return undefined;
  const optionSet = new Set(options);
  const rules: Record<string, QuestionnaireBranchRule> = {};
  for (const [option, rule] of Object.entries(field.branching)) {
    if (!optionSet.has(option)) continue;
    if (rule.action === "end") {
      rules[option] = { action: "end" };
    } else if (rule.action === "jump" && rule.targetId) {
      rules[option] = { action: "jump", targetId: rule.targetId };
    }
  }
  return Object.keys(rules).length ? rules : undefined;
}

export function remapBranchingTargets(source: Record<string, QuestionnaireBranchRule> | undefined, idMap: Map<string, string>) {
  if (!source) return undefined;
  const rules: Record<string, QuestionnaireBranchRule> = {};
  for (const [option, rule] of Object.entries(source)) {
    if (rule.action === "end") {
      rules[option] = { action: "end" };
    } else if (rule.action === "jump" && rule.targetId && idMap.has(rule.targetId)) {
      rules[option] = { action: "jump", targetId: idMap.get(rule.targetId) };
    }
  }
  return Object.keys(rules).length ? rules : undefined;
}

export function branchRuleAction(field: EditableField, option: string): EditableBranchAction {
  return field.branching[option]?.action ?? "next";
}

export function branchTargetOptions(fields: EditableField[], index: number) {
  return fields.slice(index + 1).map((field, offset) => ({
    id: field.id,
    label: `Q${index + offset + 2} ${field.label.trim() || "未命名题目"}`,
  }));
}

export function setBranchRuleAction(field: EditableField, option: string, action: EditableBranchAction, targets: Array<{ id: string }>) {
  if (action === "next") {
    delete field.branching[option];
    return;
  }
  if (action === "end") {
    field.branching[option] = { action: "end" };
    return;
  }
  const currentTarget = field.branching[option]?.targetId;
  field.branching[option] = {
    action: "jump",
    targetId: targets.some((item) => item.id === currentTarget) ? currentTarget : targets[0]?.id,
  };
}

export function setBranchRuleTarget(field: EditableField, option: string, targetId: string) {
  field.branching[option] = { action: "jump", targetId };
}

export function getEditorValidationMessage(title: string, fields: QuestionnaireField[]) {
  if (!title.trim()) return "请填写标题";
  if (!fields.length) return "至少添加 1 个题目";

  const ids = new Set<string>();
  const fieldIndexById = new Map(fields.map((field, index) => [field.id, index]));
  for (const [index, field] of fields.entries()) {
    if (ids.has(field.id)) return `题目 ID 重复：${field.id}`;
    ids.add(field.id);
    if ((field.type === "single" || field.type === "multiple") && (!field.options || field.options.length < 2)) {
      return `选项题“${field.label}”至少需要 2 个选项`;
    }
    if (field.branching) {
      const message = getBranchingValidationMessage(field, index, fieldIndexById);
      if (message) return message;
    }
    if (field.type === "rating" && (field.min ?? 1) >= (field.max ?? 5)) {
      return `评分题“${field.label}”的最高分需要大于最低分`;
    }
    if (field.type === "number" && field.min !== undefined && field.max !== undefined && field.min > field.max) {
      return `数字题“${field.label}”的最小值不能大于最大值`;
    }
  }
  return "";
}

export function buildFieldStat(field: QuestionnaireField, responses: QuestionnaireResponse[]): FieldStat {
  const optionCounts = new Map<string, number>();
  const samples: string[] = [];
  const numbers: number[] = [];
  let answered = 0;

  if (field.type === "single" || field.type === "multiple") {
    for (const option of field.options ?? []) optionCounts.set(option, 0);
  }
  if (field.type === "rating") {
    const min = Math.max(0, Math.round(field.min ?? 1));
    const max = Math.min(10, Math.round(field.max ?? 5));
    for (let value = min; value <= max; value += 1) optionCounts.set(String(value), 0);
  }

  for (const response of responses) {
    const raw = response.answers[field.id];
    if (Array.isArray(raw)) {
      const values = raw.map(String).map((item) => item.trim()).filter(Boolean);
      if (!values.length) continue;
      answered += 1;
      for (const value of values) optionCounts.set(value, (optionCounts.get(value) ?? 0) + 1);
      continue;
    }

    const value = String(raw ?? "").trim();
    if (!value) continue;
    answered += 1;
    if (field.type === "single" || field.type === "date" || field.type === "rating") {
      optionCounts.set(value, (optionCounts.get(value) ?? 0) + 1);
    }
    if (field.type === "number" || field.type === "rating") {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) numbers.push(numeric);
    }
    if ((field.type === "text" || field.type === "textarea") && samples.length < 8) {
      samples.push(value);
    }
  }

  const choices = Array.from(optionCounts.entries())
    .filter(([, count]) => field.type !== "date" || count > 0)
    .slice(0, field.type === "date" ? 10 : undefined)
    .map(([label, count]) => ({
      label,
      count,
      percent: answered ? Math.round((count / answered) * 100) : 0,
    }));

  const sum = numbers.reduce((total, item) => total + item, 0);
  return {
    field,
    answered,
    choices,
    numericCount: numbers.length,
    average: numbers.length ? round(sum / numbers.length) : undefined,
    min: numbers.length ? Math.min(...numbers) : undefined,
    max: numbers.length ? Math.max(...numbers) : undefined,
    samples,
  };
}

export function duplicateQuestionnaireFields(source: Questionnaire) {
  const sourceFields = source.fields ?? [];
  const idMap = new Map(sourceFields.map((field) => [field.id, makeFieldId()]));
  return sourceFields.map((field) => ({
    ...field,
    id: idMap.get(field.id) ?? makeFieldId(),
    branching: remapBranchingTargets(field.branching, idMap),
  }));
}

export function ratingRange(field: QuestionnaireField) {
  const min = Math.max(0, Math.round(field.min ?? 1));
  const max = Math.min(10, Math.round(field.max ?? 5));
  return Array.from({ length: Math.max(0, max - min + 1) }, (_, index) => min + index);
}

export function formatAnswer(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.join("、") || "-";
  return value || "-";
}

export function csvEscape(value: string) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export function sanitizeFilename(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60) || "questionnaire";
}

function getBranchingValidationMessage(
  field: QuestionnaireField,
  index: number,
  fieldIndexById: Map<string, number>,
) {
  if (field.type !== "single") return `只有单选题“${field.label}”可以配置分支`;
  const allowed = new Set(field.options ?? []);
  for (const [option, rule] of Object.entries(field.branching ?? {})) {
    if (!allowed.has(option)) return `题目“${field.label}”的分支选项不存在：${option}`;
    if (rule.action === "jump") {
      const targetIndex = fieldIndexById.get(rule.targetId ?? "");
      if (targetIndex === undefined || targetIndex <= index) return `题目“${field.label}”只能跳到后面的题`;
    }
  }
  return "";
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function randomLocalKey() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
