import { request, type RequestOptions } from "./request";

export const messageApi = {
  list: (category?: string, options?: RequestOptions) => request.get<any[]>("/messages", category ? { category } : {}, options),
  read: (id: number, options?: RequestOptions) => request.post<any>(`/messages/${id}/read`, undefined, options),
  readAll: (options?: RequestOptions) => request.post<any>("/messages/read-all", undefined, options),
  settings: (options?: RequestOptions) => request.get<any>("/messages/settings", undefined, options),
  updateSettings: (payload: Record<string, unknown>, options?: RequestOptions) => request.patch<any>("/messages/settings", payload, options),
};
