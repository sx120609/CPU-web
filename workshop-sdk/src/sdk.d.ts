export type JSONValue =
  null | boolean | number | string | JSONValue[] | { [key: string]: JSONValue };
export interface GameConfig {
  orientation: "portrait" | "landscape" | "any";
  controls: ("pointer" | "keyboard" | "touch")[];
  aspectRatio?: number;
}
export interface Environment {
  name: string;
  type: "game" | "tool" | "extension";
  version: string;
  theme: "light" | "dark";
  locale: "zh-CN";
  storageAvailable: boolean;
  slot: "page" | "splash" | "dialog";
  viewport: { width: number; height: number };
  capabilities: string[];
  motionSupported: boolean;
  game?: GameConfig;
}
export interface SiteInfo {
  name: string;
  locale: "zh-CN";
}
/** Public catalog fields only; no author, account or review metadata. */
export interface PublicWork {
  id: string;
  slug: string;
  name: string;
  description: string;
  type: "game" | "tool" | "extension";
  version: string;
}
export interface PublicWorkCatalog {
  items: PublicWork[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}
export interface ListWorksParams {
  q?: string;
  type?: "game" | "tool" | "extension";
  page?: number;
  pageSize?: number;
}
export interface ToastParams {
  message: string;
  type?: "info" | "success" | "warning";
}
export interface CapabilityResult {
  enabled: boolean;
  reason?: string;
}
export interface WorkshopEvents {
  pause: { reason?: string };
  resume: { reason?: string };
  show: Record<string, never>;
  hide: Record<string, never>;
  shake: Record<string, never>;
  themechange: { theme: "light" | "dark" };
  resize: { width: number; height: number };
}
export interface WorkshopSDK {
  ready: Promise<{ appId: string }>;
  getEnvironment(): Promise<Environment>;
  getSiteInfo(): Promise<SiteInfo>;
  listWorks(params?: ListWorksParams): Promise<PublicWorkCatalog>;
  showToast(params: ToastParams): Promise<unknown>;
  confirm(params: {
    title: string;
    message: string;
  }): Promise<{ confirmed: boolean }>;
  openPage(target: "workshop" | "games" | "tools"): Promise<unknown>;
  requestFullscreen(): Promise<CapabilityResult>;
  close(): Promise<unknown>;
  requestShake(): Promise<CapabilityResult>;
  getSave(): Promise<JSONValue>;
  setSave(value: JSONValue): Promise<unknown>;
  removeSave(): Promise<unknown>;
  /** Serializes mutations within this SDK instance; not a server transaction. */
  updateSave(
    update: (value: JSONValue) => JSONValue | Promise<JSONValue>,
  ): Promise<JSONValue>;
  on<E extends keyof WorkshopEvents>(
    event: E,
    listener: (data: WorkshopEvents[E]) => void,
  ): () => void;
  destroy(): void;
}
export function createWorkshopSDK(options?: {
  timeout?: number;
  interactionTimeout?: number;
}): WorkshopSDK;
export function createLocalPreviewSDK(options: {
  appId: string;
  name?: string;
  type?: "game" | "tool" | "extension";
  version?: string;
  game?: GameConfig;
}): WorkshopSDK;
