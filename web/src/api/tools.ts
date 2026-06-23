import { request, type RequestOptions } from "./request";

export type ServiceToolCode = "feedback" | "questionnaire" | "grade_check" | "file_collect" | "cloud_drive" | "pdf_tools";
export type QuestionnaireStatus = "draft" | "open" | "closed";
export type QuestionnaireVisibility = "public" | "login";
export type QuestionnaireFieldType = "text" | "textarea" | "single" | "multiple" | "number" | "date" | "rating";
export type QuestionnaireBranchAction = "end" | "jump";
export type GradeCheckStatus = "draft" | "open" | "closed";
export type FileCollectStatus = "draft" | "open" | "closed";
export type FileCollectVisibility = "public" | "login";

export interface ToolMeta {
  code: ServiceToolCode;
  name: string;
  description: string;
  isVisible: boolean;
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
  branching?: Record<string, QuestionnaireBranchRule>;
}

export interface QuestionnaireBranchRule {
  action: QuestionnaireBranchAction;
  targetId?: string;
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

export interface FileCollectField {
  id: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  pattern?: string;
}

export interface FileCollectRules {
  allowedTypes: string[];
  maxSizeMb: number;
  maxCount: number;
}

export interface FileCollectTask {
  id: number;
  slug: string;
  title: string;
  description?: string | null;
  status: FileCollectStatus;
  visibility: FileCollectVisibility;
  fields: FileCollectField[];
  fileRules: FileCollectRules;
  renameTemplate: string;
  folderTemplate: string;
  expectedEntries: string;
  submissionCount: number;
  fileCount: number;
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

export interface FileCollectTemplate {
  id: number;
  name: string;
  description?: string | null;
  visibility: FileCollectVisibility;
  fields: FileCollectField[];
  fileRules: FileCollectRules;
  renameTemplate: string;
  folderTemplate: string;
  expectedEntries: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: {
    id: number;
    username: string;
    nickname: string;
    role: string;
  } | null;
}

export interface FileCollectSubmission {
  id: number;
  taskId: number;
  identity: string;
  data: Record<string, string>;
  ip?: string | null;
  createdAt: string;
  submitter?: {
    id: number;
    username: string;
    nickname: string;
    role: string;
  } | null;
  files: Array<{
    id: number;
    originalName: string;
    storedName: string;
    mimeType: string;
    size: number;
    createdAt: string;
  }>;
}

export interface FileCollectFilenameRepairResult {
  total: number;
  updated: number;
  unchanged: number;
  unrecoverable: number;
  samples: Array<{
    id: number;
    beforeOriginalName: string;
    afterOriginalName: string;
    beforeStoredName: string;
    afterStoredName: string;
  }>;
}

export interface FileCollectPayload {
  title: string;
  description?: string;
  status?: FileCollectStatus;
  visibility?: FileCollectVisibility;
  fields: FileCollectField[];
  fileRules: FileCollectRules;
  renameTemplate: string;
  folderTemplate: string;
  expectedEntries?: string;
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

export interface CloudDriveEntry {
  name: string;
  relativePath: string;
  kind: "folder" | "file";
  sizeBytes: number | null;
  updatedAt: string;
  extension: string;
  previewable: boolean;
  webUrl: string;
}

export interface CloudDriveDirectory {
  backend: "local" | "onedrive-cn";
  remoteReady: boolean;
  currentPath: string;
  rootName: string;
  rootStoragePath: string;
  siteName: string;
  driveName: string;
  breadcrumbs: Array<{ name: string; path: string }>;
  entries: CloudDriveEntry[];
}

export interface CloudDriveUploadInitResult {
  backend: "local" | "onedrive-cn";
  mode: "direct" | "proxy";
  relativePath: string;
  uploadUrl?: string;
  uploadToken?: string;
  expiresAt?: string;
}

export const toolsApi = {
  tools: (options?: RequestOptions) => request.get<ToolMeta[]>("/tools", undefined, options),
  myPermissions: (options?: RequestOptions) =>
    request.get<{ toolCodes: ServiceToolCode[]; adminToolCodes: ServiceToolCode[] }>("/tools/permissions/me", undefined, options),
  managers: (toolCode: ServiceToolCode) => request.get<ToolManager[]>(`/tools/${toolCode}/managers`),
  addManager: (toolCode: ServiceToolCode, payload: { userId?: number; username?: string }) =>
    request.post<ToolManager>(`/tools/${toolCode}/managers`, payload),
  removeManager: (toolCode: ServiceToolCode, userId: number) =>
    request.delete<{ ok: true }>(`/tools/${toolCode}/managers/${userId}`),
  updateToolSetting: (toolCode: ServiceToolCode, payload: { isVisible?: boolean; requireLogin?: boolean; allowPublicManage?: boolean }) =>
    request.patch<{ toolCode: ServiceToolCode; isVisible: boolean; requireLogin: boolean; allowPublicManage: boolean; updatedAt: string }>(`/tools/${toolCode}/settings`, payload),

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
  gradeCheck: (slug: string, options?: RequestOptions) =>
    request.get<GradeCheckLookup>(`/tools/grade-checks/${slug}`, undefined, options),
  createGradeCheck: (payload: GradeCheckPayload) =>
    request.post<GradeCheckTable>("/tools/grade-checks", payload),
  updateGradeCheck: (id: number, payload: Partial<GradeCheckPayload>) =>
    request.patch<GradeCheckTable>(`/tools/grade-checks/${id}`, payload),
  deleteGradeCheck: (id: number) =>
    request.delete<{ ok: true }>(`/tools/grade-checks/${id}`),

  fileCollections: (params?: { manage?: "1" }) =>
    request.get<FileCollectTask[]>("/tools/file-collections", params),
  fileCollectionTemplates: () =>
    request.get<FileCollectTemplate[]>("/tools/file-collection-templates"),
  createFileCollectionTemplate: (payload: Omit<FileCollectTemplate, "id" | "createdAt" | "updatedAt" | "createdBy">) =>
    request.post<FileCollectTemplate>("/tools/file-collection-templates", payload),
  deleteFileCollectionTemplate: (id: number) =>
    request.delete<{ ok: true }>(`/tools/file-collection-templates/${id}`),
  fileCollection: (slug: string, options?: RequestOptions) =>
    request.get<FileCollectTask>(`/tools/file-collections/${slug}`, undefined, options),
  createFileCollection: (payload: FileCollectPayload) =>
    request.post<FileCollectTask>("/tools/file-collections", payload),
  updateFileCollection: (id: number, payload: Partial<FileCollectPayload>) =>
    request.patch<FileCollectTask>(`/tools/file-collections/${id}`, payload),
  deleteFileCollection: (id: number) =>
    request.delete<{ ok: true }>(`/tools/file-collections/${id}`),
  fileCollectionSubmissions: (id: number) =>
    request.get<{ task: FileCollectTask; list: FileCollectSubmission[] }>(`/tools/file-collections/${id}/submissions`),
  repairFileCollectionFilenames: (id: number) =>
    request.post<FileCollectFilenameRepairResult>(`/tools/file-collections/${id}/repair-filenames`),
  submitFileCollection: (slug: string, form: FormData, options?: RequestOptions) =>
    request.post<{ id: number; createdAt: string; files: string[] }>(`/tools/file-collections/${slug}/submissions`, form, options),
  deleteFileCollectionSubmission: (id: number) =>
    request.delete<{ ok: true }>(`/tools/file-collection-submissions/${id}`),
  deleteFileCollectionFile: (id: number) =>
    request.delete<{ ok: true }>(`/tools/file-collection-files/${id}`),
  cloudDrive: (path = "", options?: RequestOptions) =>
    request.get<CloudDriveDirectory>("/tools/cloud-drive", { path }, options),
  createCloudDriveFolder: (data: { path?: string; name: string }) =>
    request.post<CloudDriveEntry>("/tools/cloud-drive/folders", data),
  renameCloudDriveEntry: (data: { path: string; name: string }) =>
    request.patch<CloudDriveEntry>("/tools/cloud-drive/rename", data),
  deleteCloudDriveEntry: (path: string) =>
    request.delete<{ ok: true }>("/tools/cloud-drive", { params: { path } }),
  cloudDriveAccessUrl: (data: { path: string; download?: boolean }, options?: RequestOptions) =>
    request.post<{ url: string }>("/tools/cloud-drive/access", data, options),
  initCloudDriveUpload: (data: {
    path?: string;
    fileName: string;
    mimeType?: string;
    fileSize: number;
  }) => request.post<CloudDriveUploadInitResult>("/tools/cloud-drive/upload/init", data, { timeout: 30000 }),
  completeCloudDriveUpload: (uploadToken: string) =>
    request.post<{ entry: CloudDriveEntry }>("/tools/cloud-drive/upload/complete", { uploadToken }, { timeout: 180000 }),
  uploadCloudDriveFile: (formData: FormData, options?: RequestOptions) =>
    request.post<CloudDriveEntry>("/tools/cloud-drive/upload", formData, options),
};
