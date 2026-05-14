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

export const servicesApi = {
  list: (category?: string) => request.get<ServiceCard[]>("/services", category ? { category } : {}),
};
