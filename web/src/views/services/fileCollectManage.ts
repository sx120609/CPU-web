import type {
  FileCollectField,
  FileCollectPayload,
  FileCollectStatus,
  FileCollectTemplate,
  FileCollectVisibility,
} from "@/api/tools";

export type EditableFileCollectField = FileCollectField & {
  localKey: string;
  required: boolean;
  placeholder: string;
  pattern: string;
};

export type FileCollectTemplateDraft = {
  key: string;
  name: string;
  description?: string | null;
  visibility: FileCollectVisibility;
  fields: FileCollectField[];
  fileRules: {
    allowedTypes: string[];
    maxSizeMb: number;
    maxCount: number;
  };
  renameTemplate: string;
  folderTemplate: string;
  expectedEntries: string;
  customId?: number;
};

export type FileCollectFormState = {
  title: string;
  description: string;
  status: FileCollectStatus;
  visibility: FileCollectVisibility;
  allowedTypes: string;
  maxSizeMb: number;
  maxCount: number;
  renameTemplate: string;
  folderTemplate: string;
  expectedEntries: string;
  fields: EditableFileCollectField[];
};

export type RenameSliceMode = "whole" | "last" | "first";

export type RenameInsertState = {
  fieldId: string;
  mode: RenameSliceMode;
  count: number;
};

export type RenameQuickToken = {
  label: string;
  token: string;
  group: "system";
};

export const builtInFileCollectTemplates: FileCollectTemplateDraft[] = [
  {
    key: "builtin:student",
    name: "学号模板",
    description: "适合按姓名和学号收作业、照片、报名材料。",
    visibility: "public",
    fields: [
      { id: "name", label: "姓名", required: true, placeholder: "请输入姓名" },
      { id: "student_id", label: "学号", required: true, placeholder: "请输入学号" },
    ],
    fileRules: { allowedTypes: ["pdf", "doc", "docx", "jpg", "png", "zip"], maxSizeMb: 20, maxCount: 1 },
    renameTemplate: "{name}-{student_id}",
    folderTemplate: "{name}-{student_id}",
    expectedEntries: "",
  },
  {
    key: "builtin:exam",
    name: "考试号模板",
    description: "适合按姓名和考试号收准考证、考试材料或确认文件。",
    visibility: "public",
    fields: [
      { id: "name", label: "姓名", required: true, placeholder: "请输入姓名" },
      { id: "student_id", label: "考试号", required: true, placeholder: "请输入考试号" },
    ],
    fileRules: { allowedTypes: ["pdf", "jpg", "png", "zip"], maxSizeMb: 20, maxCount: 1 },
    renameTemplate: "{name}-{student_id}",
    folderTemplate: "{name}-{student_id}",
    expectedEntries: "",
  },
];

export const fileRenameQuickTokens: RenameQuickToken[] = [
  { label: "连接符 -", token: "-", group: "system" },
  { label: "原文件名", token: "{original}", group: "system" },
  { label: "多文件序号", token: "{index}", group: "system" },
];

export const fileFolderQuickTokens: RenameQuickToken[] = [
  { label: "连接符 -", token: "-", group: "system" },
];

export function createDefaultFileCollectForm(): FileCollectFormState {
  return {
    title: "",
    description: "",
    status: "open",
    visibility: "public",
    allowedTypes: "pdf,doc,docx,jpg,png,zip",
    maxSizeMb: 20,
    maxCount: 1,
    renameTemplate: "{name}-{student_id}",
    folderTemplate: "{name}-{student_id}",
    expectedEntries: "",
    fields: [
      { localKey: "fc-name", id: "name", label: "姓名", required: true, placeholder: "请输入姓名", pattern: "" },
      { localKey: "fc-student", id: "student_id", label: "学号", required: true, placeholder: "请输入学号", pattern: "" },
    ],
  };
}

export function buildFileTemplateOptions(customTemplates: FileCollectTemplate[]): FileCollectTemplateDraft[] {
  return [
    ...builtInFileCollectTemplates,
    ...customTemplates.map((item) => ({
      key: `custom:${item.id}`,
      customId: item.id,
      name: item.name,
      description: item.description,
      visibility: item.visibility,
      fields: item.fields,
      fileRules: item.fileRules,
      renameTemplate: item.renameTemplate,
      folderTemplate: item.folderTemplate,
      expectedEntries: item.expectedEntries,
    })),
  ];
}

export function applyFileTemplateToForm(form: FileCollectFormState, template: FileCollectTemplateDraft, resetTitle = false) {
  if (resetTitle) {
    form.title = "";
    form.description = "";
    form.status = "open";
  } else if (!form.description.trim() && template.description) {
    form.description = template.description;
  }
  form.visibility = template.visibility;
  form.allowedTypes = template.fileRules.allowedTypes.join(",");
  form.maxSizeMb = template.fileRules.maxSizeMb;
  form.maxCount = template.fileRules.maxCount;
  form.renameTemplate = template.renameTemplate;
  form.folderTemplate = template.folderTemplate;
  form.expectedEntries = template.expectedEntries;
  form.fields = template.fields.map((field, index) => ({
    localKey: `fc-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
    id: field.id,
    label: field.label,
    required: Boolean(field.required),
    placeholder: field.placeholder || "",
    pattern: field.pattern || "",
  }));
}

export function makeFileCollectField(index: number): EditableFileCollectField {
  return {
    localKey: `fc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    id: `field_${index + 1}`,
    label: "新字段",
    required: false,
    placeholder: "",
    pattern: "",
  };
}

export function normalizeFileCollectFields(fields: EditableFileCollectField[]): FileCollectField[] {
  return fields.map((field) => ({
    id: field.id.trim(),
    label: field.label.trim(),
    required: Boolean(field.required),
    placeholder: field.placeholder?.trim() || undefined,
    pattern: field.pattern?.trim() || undefined,
  }));
}

export function fileCollectVariableFields(fields: EditableFileCollectField[]) {
  return normalizeFileCollectFields(fields).filter((field) => field.id && field.label).slice(0, 20);
}

export function getFileCollectValidationMessage(form: FileCollectFormState) {
  if (!form.title.trim()) return "请填写收集任务标题";
  const fields = normalizeFileCollectFields(form.fields);
  if (!fields.length || fields.some((field) => !field.id || !field.label)) return "请完善填写字段";
  if (new Set(fields.map((field) => field.id)).size !== fields.length) return "字段 ID 不能重复";
  const invalid = fields.find((field) => !/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(field.id));
  if (invalid) return `变量名“${invalid.id}”只能包含中文、英文、数字和下划线`;
  return "";
}

export function buildFieldVariableToken(state: RenameInsertState, fields: FileCollectField[]) {
  const fallback = fields[0]?.id || "";
  const fieldId = fields.some((field) => field.id === state.fieldId) ? state.fieldId : fallback;
  if (!fieldId) return { token: "", message: "请先添加可用于命名的填写字段" };
  state.fieldId = fieldId;
  if (state.mode === "whole") return { token: `{${fieldId}}`, message: "" };
  const count = clampSliceCount(state.count);
  state.count = count;
  return { token: `{${fieldId}|${state.mode}:${count}}`, message: "" };
}

export function syncRenameInsertFields(states: RenameInsertState[], fields: FileCollectField[]) {
  const fallback = fields[0]?.id || "";
  for (const state of states) {
    if (!fallback) {
      state.fieldId = "";
    } else if (!fields.some((field) => field.id === state.fieldId)) {
      state.fieldId = fallback;
    }
  }
}

export function clampSliceCount(value: number) {
  const count = Math.round(Number(value) || 1);
  return Math.min(99, Math.max(1, count));
}

export function buildFileCollectionPayload(form: FileCollectFormState): FileCollectPayload {
  return {
    title: form.title.trim(),
    description: form.description.trim() || undefined,
    status: form.status,
    visibility: form.visibility,
    fields: normalizeFileCollectFields(form.fields),
    fileRules: normalizeFileRules(form),
    renameTemplate: form.renameTemplate.trim() || "{name}-{student_id}",
    folderTemplate: form.folderTemplate.trim() || "{name}-{student_id}",
    expectedEntries: form.expectedEntries.trim() || undefined,
  };
}

export function buildFileCollectionTemplatePayload(name: string, form: FileCollectFormState) {
  return {
    name,
    description: form.description.trim() || undefined,
    visibility: form.visibility,
    fields: normalizeFileCollectFields(form.fields),
    fileRules: normalizeFileRules(form),
    renameTemplate: form.renameTemplate.trim() || "{name}-{student_id}",
    folderTemplate: form.folderTemplate.trim() || "{name}-{student_id}",
    expectedEntries: form.expectedEntries.trim() || "",
  };
}

function normalizeFileRules(form: FileCollectFormState) {
  return {
    allowedTypes: form.allowedTypes.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean),
    maxSizeMb: Number(form.maxSizeMb) || 20,
    maxCount: Number(form.maxCount) || 1,
  };
}
