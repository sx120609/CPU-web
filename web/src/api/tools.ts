import { request, type RequestOptions } from "./request";

export type ServiceToolCode = "feedback" | "questionnaire" | "grade_check";
export type QuestionnaireStatus = "draft" | "open" | "closed";
export type QuestionnaireVisibility = "public" | "login";
export type QuestionnaireFieldType = "text" | "textarea" | "single" | "multiple" | "number" | "date" | "rating";
export type GradeCheckStatus = "draft" | "open" | "closed";

export interface ToolMeta {
  code: ServiceToolCode;
  name: string;
  description: string;
  requireLogin: boolean;
  allowPublicManage: boolean;
  canManage: boolean;
  canAdmin: boolean;
}

export interface QuestionnaireField {
  id: string;
  label: string;
  type: QuestionnaireFieldType;
  required?: boolean;
  placeholder?: string;
  options?: string[];
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
}

export interface Questionnaire {
  id: number;
  toolCode: ServiceToolCode;
  slug: string;
  title: string;
  description?: string | null;
  status: QuestionnaireStatus;
  visibility: QuestionnaireVisibility;
  allowAnonymous: boolean;
  oneResponsePerUser: boolean;
  isSystem: boolean;
  fields?: QuestionnaireField[];
  responseCount?: number;
  canManage?: boolean;
  publishedAt?: string | null;
  closedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy?: {
    id: number;
    username: string;
    nickname: string;
    role: string;
  } | null;
}

export interface QuestionnaireResponse {
  id: number;
  questionnaireId: number;
  answers: Record<string, string | string[]>;
  respondent?: {
    id: number;
    username: string;
    nickname: string;
    avatar?: string | null;
    role: string;
  } | null;
  createdAt: string;
}

export interface GradeCheckTable {
  id: number;
  slug: string;
  title: string;
  description?: string | null;
  status: GradeCheckStatus;
  studentIdColumn: string;
  columns: string[];
  rowCount: number;
  feedbackQuestionnaireSlug?: string | null;
  publishedAt?: string | null;
  closedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy?: {
    id: number;
    username: string;
    nickname: string;
    role: string;
  } | null;
}

export interface GradeCheckLookup {
  table: GradeCheckTable;
  studentId: string;
  row: Record<string, string> | null;
  feedbackQuestionnaireSlug?: string | null;
  canManage: boolean;
}

export interface GradeCheckPayload {
  title: string;
  description?: string;
  status?: GradeCheckStatus;
  studentIdColumn: string;
  columns: string[];
  rows: Array<Record<string, string | number | boolean | null>>;
}

export interface ToolManager {
  id: number;
  toolCode: ServiceToolCode;
  role: "manager";
  createdAt: string;
  user: {
    id: number;
    username: string;
    nickname: string;
    avatar?: string | null;
    role: string;
  };
}

export const toolsApi = {
  tools: () => request.get<ToolMeta[]>("/tools"),
  myPermissions: (options?: RequestOptions) =>
    request.get<{ toolCodes: ServiceToolCode[]; adminToolCodes: ServiceToolCode[] }>("/tools/permissions/me", undefined, options),
  managers: (toolCode: ServiceToolCode) => request.get<ToolManager[]>(`/tools/${toolCode}/managers`),
  addManager: (toolCode: ServiceToolCode, payload: { userId?: number; username?: string }) =>
    request.post<ToolManager>(`/tools/${toolCode}/managers`, payload),
  removeManager: (toolCode: ServiceToolCode, userId: number) =>
    request.delete<{ ok: true }>(`/tools/${toolCode}/managers/${userId}`),
  updateToolSetting: (toolCode: ServiceToolCode, payload: { requireLogin?: boolean; allowPublicManage?: boolean }) =>
    request.patch<{ toolCode: ServiceToolCode; requireLogin: boolean; allowPublicManage: boolean; updatedAt: string }>(`/tools/${toolCode}/settings`, payload),

  questionnaires: (params?: { toolCode?: ServiceToolCode; manage?: "1" }) =>
    request.get<Questionnaire[]>("/tools/questionnaires", params),
  questionnaire: (slug: string, options?: RequestOptions) => request.get<Questionnaire>(`/tools/questionnaires/${slug}`, undefined, options),
  createQuestionnaire: (payload: {
    toolCode: ServiceToolCode;
    title: string;
    description?: string;
    status?: QuestionnaireStatus;
    visibility?: QuestionnaireVisibility;
    allowAnonymous?: boolean;
    oneResponsePerUser?: boolean;
    fields: QuestionnaireField[];
  }) => request.post<Questionnaire>("/tools/questionnaires", payload),
  updateQuestionnaire: (id: number, payload: Partial<{
    toolCode: ServiceToolCode;
    title: string;
    description: string;
    status: QuestionnaireStatus;
    visibility: QuestionnaireVisibility;
    allowAnonymous: boolean;
    oneResponsePerUser: boolean;
    fields: QuestionnaireField[];
  }>) => request.patch<Questionnaire>(`/tools/questionnaires/${id}`, payload),
  deleteQuestionnaire: (id: number) => request.delete<{ ok: true }>(`/tools/questionnaires/${id}`),
  submitResponse: (slug: string, answers: Record<string, string | string[]>, options?: RequestOptions) =>
    request.post<{ id: number; createdAt: string }>(`/tools/questionnaires/${slug}/responses`, { answers }, options),
  responses: (id: number) =>
    request.get<{ questionnaire: Questionnaire; list: QuestionnaireResponse[] }>(`/tools/questionnaires/${id}/responses`),

  gradeChecks: (params?: { manage?: "1" }) =>
    request.get<GradeCheckTable[]>("/tools/grade-checks", params),
  relatedGradeChecks: () =>
    request.get<GradeCheckTable[]>("/tools/grade-checks/related"),
  gradeCheck: (slug: string) =>
    request.get<GradeCheckLookup>(`/tools/grade-checks/${slug}`),
  createGradeCheck: (payload: GradeCheckPayload) =>
    request.post<GradeCheckTable>("/tools/grade-checks", payload),
  updateGradeCheck: (id: number, payload: Partial<GradeCheckPayload>) =>
    request.patch<GradeCheckTable>(`/tools/grade-checks/${id}`, payload),
  deleteGradeCheck: (id: number) =>
    request.delete<{ ok: true }>(`/tools/grade-checks/${id}`),
};
