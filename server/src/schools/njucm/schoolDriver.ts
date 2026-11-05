import type { SchoolDriver } from "../drivers";
import * as academic from "./driver";
import { isNjucmToken } from "./client";

/** 南中医：树维教务 + 统一认证（ids.njucm.edu.cn，没有扫码二次验证）。 */
export const njucmDriver: SchoolDriver = {
  schoolId: "njucm",
  ownsToken: isNjucmToken,
  academic,
  beginLogin: (signal) => academic.beginLogin(signal),
  submitLogin: (args, signal) => academic.submitLogin(args, signal),
};
