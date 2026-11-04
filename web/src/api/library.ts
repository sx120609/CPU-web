import { request } from "./request";

export interface LibraryLoan {
  title: string;
  author?: string;
  publisher?: string;
  callNo?: string;
  location?: string;
  loanDate?: string;
  dueDate?: string;
  renewTimes: number;
  renewLeft?: number;
  status?: string;
}

export interface LibraryOverview {
  loans: LibraryLoan[];
  quota: { borrowed: number; limit: number } | null;
  fines: Array<{ title: string; amount?: number; reason?: string }>;
}

export interface LibraryHistoryPage {
  page: number;
  total: number;
  list: Array<{ title: string; author?: string; callNo?: string; loanDate?: string; returnDate?: string }>;
}

/** 图书馆「我的借阅」：用学校统一认证登录时的会话换票进图书馆（目前只有南医）。 */
export const libraryApi = {
  overview: () => request.get<LibraryOverview>("/library/overview", undefined, { suppressErrorMessage: true, cacheTtlMs: 0 }),
  history: (page: number) => request.get<LibraryHistoryPage>("/library/history", { page }, { suppressErrorMessage: true, cacheTtlMs: 0 }),
};
