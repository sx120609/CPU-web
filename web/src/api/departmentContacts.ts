import { request } from "./request";

export interface DepartmentSource {
  sourceId: string; title: string; url: string | null; publishedDate: string; checkedAt: string; note: string;
}
export interface DepartmentContact {
  id: string; category: string; department: string; office: string; purpose: string; campus: string;
  phones: Array<{ number: string; dialUrl: string | null }>; emails: string[]; fax: string;
  address: string; serviceHours: string; contactName: string; sourceDate: string | null;
  checkedAt: string; evidenceStatus: string; verification: string; note: string;
  recordType: string; onlineUrl: string | null; detailUrl: string; warnings: string[]; status: string;
  sources: DepartmentSource[]; suggestedDefaultDisplay: boolean; lastLiveTestedAt: string | null;
}
export interface DepartmentQueryResult {
  query: string; intent: string | null; campus: string; clarification: string | null;
  total: number; offset: number; limit: number; hiddenSpecialCount: number;
  contacts: DepartmentContact[]; categories: string[]; campuses: string[];
  gaps: Array<{ unit: string; status: string; url: string | null; finding: string; action: string; checkedAt: string }>;
  meta: { asOf: string; actualRecordCount: number; actualSourceCount: number; actualGapCount: number;
    scope: string; limits: string; defaultDisplayWarning: string; suggestedDefaultDisplayCount: number };
}
export const departmentContactsApi = {
  query: (params: { q?: string; campus?: string; category?: string; includeSpecial?: "0" | "1"; offset?: number }) =>
    request.get<DepartmentQueryResult>("/tools/department-contacts", params, { suppressErrorMessage: true, cacheTtlMs: 0 }),
  detail: (id: string) => request.get<DepartmentContact>(`/tools/department-contacts/${encodeURIComponent(id)}`,
    undefined, { suppressErrorMessage: true }),
};
