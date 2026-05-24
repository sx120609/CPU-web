import { request } from "./request";

export type ServiceToolCode = "feedback" | "questionnaire";
export type QuestionnaireStatus = "draft" | "open" | "closed";
export type QuestionnaireVisibility = "public" | "login";
export type QuestionnaireFieldType = "text" | "textarea" | "single" | "multiple";

export interface ToolMeta {
  code: ServiceToolCode;
  name: string;
  description: string;
  requireLogin: boolean;
  canManage: boolean;
}

export interface QuestionnaireField {
  id: string;
  label: string;
  type: QuestionnaireFieldType;
  required?: boolean;
  placeholder?: string;
  options?: string[];
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
  myPermissions: () => request.get<{ toolCodes: ServiceToolCode[] }>("/tools/permissions/me"),
  managers: (toolCode: ServiceToolCode) => request.get<ToolManager[]>(`/tools/${toolCode}/managers`),
  addManager: (toolCode: ServiceToolCode, payload: { userId?: number; username?: string }) =>
    request.post<ToolManager>(`/tools/${toolCode}/managers`, payload),
  removeManager: (toolCode: ServiceToolCode, userId: number) =>
    request.delete<{ ok: true }>(`/tools/${toolCode}/managers/${userId}`),
  updateToolSetting: (toolCode: ServiceToolCode, payload: { requireLogin?: boolean }) =>
    request.patch<{ toolCode: ServiceToolCode; requireLogin: boolean; updatedAt: string }>(`/tools/${toolCode}/settings`, payload),

  questionnaires: (params?: { toolCode?: ServiceToolCode; manage?: "1" }) =>
    request.get<Questionnaire[]>("/tools/questionnaires", params),
  questionnaire: (slug: string) => request.get<Questionnaire>(`/tools/questionnaires/${slug}`),
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
  submitResponse: (slug: string, answers: Record<string, string | string[]>) =>
    request.post<{ id: number; createdAt: string }>(`/tools/questionnaires/${slug}/responses`, { answers }),
  responses: (id: number) =>
    request.get<{ questionnaire: Questionnaire; list: QuestionnaireResponse[] }>(`/tools/questionnaires/${id}/responses`),
};
