import { app } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  CampusMode,
  Carrier,
  DEFAULT_INTERVAL_SEC,
  DEFAULT_TEST_CODE,
  DEFAULT_TEST_URL,
  MAX_INTERVAL_SEC,
  MIN_INTERVAL_SEC
} from "./campus-net/constants";
import type { CampusNetSettings } from "./campus-net/service";

// 非敏感的应用设置。凭据一律不放这里 —— 那些走 safeStorage（OAuth 会话在
// oauth-store.ts，校园网学号密码在 campus-net/credential-store.ts，
// 学习通账号密码在 chaoxing-credentials.ts）。
export type Preferences = {
  /** 首启引导是否已走完。未走完时主进程不创建任何标签，好让引导页不被内容视图压住。 */
  onboarded: boolean;
  launchOnLogin: boolean;
  startMinimized: boolean;
  closeToTray: boolean;
  /** 学习通「记住密码」开关。这里只存开关；凭据本体在 chaoxing-credentials.ts，关掉即删。 */
  rememberChaoxing: boolean;
  campusNet: CampusNetSettings;
  // 学习辅助脚本的运行配置。客户端是唯一的真相来源：注入时喂给脚本，
  // 脚本改了再回传存这里。脚本自带的配置面板已被隐藏，用户改不到，
  // 配置必须由客户端界面接管，否则那些开关等于不存在。
  scriptConfig: Record<string, unknown>;
};

const DEFAULTS: Preferences = {
  onboarded: false,
  launchOnLogin: false,
  startMinimized: false,
  closeToTray: true,
  rememberChaoxing: false,
  campusNet: {
    enabled: false,
    autoReconnect: true,
    mode: "auto",
    carrier: "",
    intervalSec: DEFAULT_INTERVAL_SEC,
    testUrl: DEFAULT_TEST_URL,
    testCode: DEFAULT_TEST_CODE
  },
  // 空对象表示"沿用脚本自己的默认值"。客户端界面只覆盖用户显式改过的项，
  // 不把脚本的整套默认值抄一份过来 —— 抄了就得跟着脚本升级同步维护。
  scriptConfig: {}
};

const MODES: CampusMode[] = ["pppoe", "campus", "auto"];
const CARRIERS: Carrier[] = ["", "cmcc", "unicom", "telecom"];

const asEnum = <T extends string>(value: unknown, allowed: T[], fallback: T): T =>
  typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : fallback;

const asInterval = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.round(parsed), MIN_INTERVAL_SEC), MAX_INTERVAL_SEC);
};

const asUrl = (value: unknown, fallback: string): string =>
  typeof value === "string" && /^https?:\/\/\S+$/.test(value.trim()) ? value.trim() : fallback;

const asText = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

const mergeCampusNet = (raw: unknown, current: CampusNetSettings): CampusNetSettings => {
  const patch = (raw ?? {}) as Partial<CampusNetSettings>;
  return {
    enabled: asBoolean(patch.enabled, current.enabled),
    autoReconnect: asBoolean(patch.autoReconnect, current.autoReconnect),
    mode: asEnum(patch.mode, MODES, current.mode),
    // 运营商可以被清空（改回校园网模式时），所以显式判断 undefined 而不是靠真值
    carrier: patch.carrier === undefined ? current.carrier : asEnum(patch.carrier, CARRIERS, current.carrier),
    intervalSec: asInterval(patch.intervalSec, current.intervalSec),
    testUrl: asUrl(patch.testUrl, current.testUrl),
    testCode: asText(patch.testCode, current.testCode)
  };
};

const filePath = (): string => path.join(app.getPath("userData"), "preferences.json");

let cache: Preferences | undefined;

const asBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

// 脚本配置的形状由脚本决定，这里不校验字段，只保证是个普通对象
const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? { ...value as Record<string, unknown> } : {};

export const readPreferences = async (): Promise<Preferences> => {
  if (cache) return cache;
  try {
    const raw = JSON.parse(await readFile(filePath(), "utf8")) as Partial<Preferences>;
    cache = {
      onboarded: asBoolean(raw.onboarded, DEFAULTS.onboarded),
      launchOnLogin: asBoolean(raw.launchOnLogin, DEFAULTS.launchOnLogin),
      startMinimized: asBoolean(raw.startMinimized, DEFAULTS.startMinimized),
      closeToTray: asBoolean(raw.closeToTray, DEFAULTS.closeToTray),
      rememberChaoxing: asBoolean(raw.rememberChaoxing, DEFAULTS.rememberChaoxing),
      campusNet: mergeCampusNet(raw.campusNet, DEFAULTS.campusNet),
      scriptConfig: asRecord(raw.scriptConfig)
    };
  } catch {
    cache = { ...DEFAULTS, campusNet: { ...DEFAULTS.campusNet }, scriptConfig: {} };
  }
  return cache;
};

// 整体覆盖写。原版是字段级 merge（空串取旧值、0 取旧值、a||b），
// 结果 false 关不掉、数值设不回 0、运营商清不空 —— 这里 false / 0 / "" 必须能存下去。
export const writePreferences = async (patch: Partial<Preferences>): Promise<Preferences> => {
  const current = await readPreferences();
  const next: Preferences = {
    onboarded: asBoolean(patch.onboarded, current.onboarded),
    launchOnLogin: asBoolean(patch.launchOnLogin, current.launchOnLogin),
    startMinimized: asBoolean(patch.startMinimized, current.startMinimized),
    closeToTray: asBoolean(patch.closeToTray, current.closeToTray),
    rememberChaoxing: asBoolean(patch.rememberChaoxing, current.rememberChaoxing),
    campusNet: patch.campusNet === undefined ? current.campusNet : mergeCampusNet(patch.campusNet, current.campusNet),
    // 逐键合并：客户端界面只提交它改动的那几项，不该把没提交的项抹成默认
    scriptConfig: patch.scriptConfig === undefined
      ? current.scriptConfig
      : { ...current.scriptConfig, ...asRecord(patch.scriptConfig) }
  };
  cache = next;
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(filePath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
};

// 开机自启走 Electron 自己的接口：Windows 写当前用户的 Run 键、macOS 走登录项，
// 都不需要管理员权限。--startup 会被 main.ts 读到并静默启动。
export const applyLaunchOnLogin = (enabled: boolean, startMinimized: boolean): void => {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({
    openAtLogin: enabled,
    args: startMinimized ? ["--startup", "--minimized"] : ["--startup"]
  });
};
