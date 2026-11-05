import type { SchoolDriver } from "../drivers";
import * as academic from "./driver";
import { forgetNjmuDevice, isNjmuToken } from "./client";
import { loadLibraryHistory, loadLibraryOpenHours, loadLibraryOverview } from "./library";

/** 南医：正方教务 + 统一认证（新设备要用微信扫码确认）+ 图书馆。 */
export const njmuDriver: SchoolDriver = {
  schoolId: "njmu",
  ownsToken: isNjmuToken,
  academic,
  beginLogin: (signal) => academic.beginLogin(signal),
  submitLogin: (args, signal) => academic.submitLogin(args, signal),
  mfa: {
    guide: { kind: "qr", app: { name: "微信", androidPackage: "com.tencent.mm", iosUrl: "weixin://" } },
    poll: (pendingId, signal) => academic.pollMfa(pendingId, signal),
    refreshQr: (pendingId, signal) => academic.refreshMfaQr(pendingId, signal),
  },
  library: {
    overview: loadLibraryOverview,
    history: loadLibraryHistory,
    openHours: loadLibraryOpenHours,
  },
  forgetAccount: forgetNjmuDevice,
};
