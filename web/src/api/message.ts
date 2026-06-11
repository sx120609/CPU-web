import { request, type RequestOptions } from "./request";

export const messageApi = {
  list: (category?: string, options?: RequestOptions) => request.get<any[]>("/messages", category ? { category } : {}, options),
  read: (id: number) => request.post<any>(`/messages/${id}/read`),
  readAll: () => request.post<any>("/messages/read-all"),
  settings: (options?: RequestOptions) => request.get<any>("/messages/settings", undefined, options),
  updateSettings: (payload: Record<string, unknown>) => request.patch<any>("/messages/settings", payload),
};
