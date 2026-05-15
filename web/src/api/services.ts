import { request } from "./request";

export interface ServiceCard {
  id: number;
  code: string;
  name: string;
  category: string;
  owner: string;
  icon?: string;
  description?: string;
  url: string;
  materials?: string;
  duration?: string;
  contact?: string;
  needSso: boolean;
  order: number;
}

export interface DormElectricResult {
  /** 剩余金额（元） */
  balance: number | null;
  /** 剩余电量（度） */
  remainKwh: number | null;
  /** 累计已用电量（度） */
  usedKwh: number | null;
  /** 电价（元/度） */
  price: number | null;
  /** 房间名，如 "0313房间" */
  room: string | null;
  /** 楼栋，如 "H6" */
  building: string | null;
  /** 楼层，如 "第3层" */
  floor: string | null;
  /** 校区 */
  area: string | null;
  /** 抄表时间 */
  lastUpdate: string | null;
}

export const servicesApi = {
  list: (category?: string) => request.get<ServiceCard[]>("/services", category ? { category } : {}),
  dormElectric: () => request.get<DormElectricResult>("/services/dorm-electric"),
};
