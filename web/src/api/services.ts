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
  balance: number | null;
  room?: string | null;
  building?: string | null;
  lastUpdate?: string | null;
  raw?: Record<string, unknown>;
}

export const servicesApi = {
  list: (category?: string) => request.get<ServiceCard[]>("/services", category ? { category } : {}),
  dormElectric: () => request.get<DormElectricResult>("/services/dorm-electric"),
};
