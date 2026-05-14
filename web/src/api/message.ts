import { request } from "./request";

export const messageApi = {
  list: (category?: string) => request.get<any[]>("/messages", category ? { category } : {}),
  read: (id: number) => request.post<any>(`/messages/${id}/read`),
  readAll: () => request.post<any>("/messages/read-all"),
  settings: () => request.get<any>("/messages/settings"),
  updateSettings: (payload: Record<string, unknown>) => request.patch<any>("/messages/settings", payload),
};
