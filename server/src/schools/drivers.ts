import { njmuDriver } from "./njmu/schoolDriver";

/**
 * 接入一所学校时，把这所学校跟上游打交道的部分登记成一个驱动；路由、会话、课表缓存、
 * 原生壳都只认这里的接口，不再按学校名分支。默认学校（药大）走 services/jwxtFacade 那套老实现，
 * 不在这里登记。
 *
 * 新学校要做的：
 * 1. schools/<id>/ 下写教务查询（返回值和 jwxtFacade 同形）、统一认证登录；
 * 2. 教务令牌和登录 pendingId 带上本校前缀，ownsToken 据此认出来；
 * 3. 在 SCHOOL_DRIVERS 里登记，并在 schools/catalog.ts 的模块 implementedFor 里加上学校代号。
 */

/** 新设备要扫码确认时，告诉网页和原生登录页用哪个 App 扫、怎么说。 */
export type SchoolMfaGuide = {
  kind: "qr";
  /** 用来扫码的 App；原生登录页据此「保存二维码并打开 xx」。不填就只显示二维码。 */
  app?: {
    name: string;
    androidPackage?: string;
    /** iOS 上打开它的 URL，例如 weixin://（直接 open，不用先 canOpenURL，原生不用为每个 App 登记）。 */
    iosUrl?: string;
  };
  /** 二维码上方的说明；不填用通用说明。 */
  hint?: string;
};

export type SchoolMfaPollResult =
  | { status: "waiting" | "scanned" | "expired" }
  | { status: "done"; attempt: any };

export interface SchoolDriver {
  schoolId: string;
  /** 教务令牌或登录 pendingId 是不是本校驱动发的。 */
  ownsToken(token: string | null | undefined): boolean;
  /** 教务查询，函数签名和 services/jwxtFacade 相同。 */
  academic: unknown;
  beginLogin(signal?: AbortSignal): Promise<any>;
  submitLogin(args: { pendingId: string; username: string; password: string; captcha?: string }, signal?: AbortSignal): Promise<any>;
  /** 新设备扫码二次验证；没有这一步的学校不填。 */
  mfa?: {
    guide: SchoolMfaGuide;
    poll(pendingId: string, signal?: AbortSignal): Promise<SchoolMfaPollResult>;
    refreshQr(pendingId: string, signal?: AbortSignal): Promise<{ qrImage: string }>;
  };
  /** 图书馆「我的借阅」；接了图书馆的学校填。 */
  library?: {
    overview(token: string, signal?: AbortSignal): Promise<unknown>;
    history(token: string, page: number, signal?: AbortSignal): Promise<unknown>;
    openHours(): Promise<unknown>;
  };
  /** 删除账号时清掉本校为这个学号保存的设备凭据等。 */
  forgetAccount?(username: string): Promise<void>;
}

const SCHOOL_DRIVERS: readonly SchoolDriver[] = [njmuDriver];

export function schoolDriverForToken(token: string | null | undefined): SchoolDriver | undefined {
  if (!token) return undefined;
  return SCHOOL_DRIVERS.find((driver) => driver.ownsToken(token));
}

export function schoolDriverFor(schoolId: string | null | undefined): SchoolDriver | undefined {
  if (!schoolId) return undefined;
  return SCHOOL_DRIVERS.find((driver) => driver.schoolId === schoolId);
}

/** 学校给的扫码说明：二维码之外，网页和原生登录页都按这份显示。 */
export function schoolMfaGuideForToken(token: string | null | undefined): SchoolMfaGuide | undefined {
  return schoolDriverForToken(token)?.mfa?.guide;
}
