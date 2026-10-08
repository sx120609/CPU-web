import { request, type RequestOptions } from "./request";

export interface AnnouncementPreference {
  /** 用户是否自己选过；没选过时 selected 是默认部门。 */
  customized: boolean;
  /** 出现在“全部”里的公告板块 slug。 */
  selected: string[];
  /** 这个用户没选过时默认显示的板块（全站默认的，加上自己学院的）。 */
  defaults: string[];
}

export const announcementsApi = {
  preference: (options?: RequestOptions) =>
    request.get<AnnouncementPreference>("/announcements/preference", undefined, options),
  savePreference: (selected: string[], options?: RequestOptions) =>
    request.put<AnnouncementPreference>("/announcements/preference", { selected }, options),
  resetPreference: (options?: RequestOptions) =>
    request.delete<AnnouncementPreference>("/announcements/preference", options),
};
