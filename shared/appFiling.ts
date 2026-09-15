export const APP_FILING_NUMBER = "粤ICP备2026117069号-3A";
export const APP_FILING_URL = "https://beian.miit.gov.cn/";

/** Only our mobile app shells qualify; browser/PWA and URL overrides do not. */
export function isRegisteredMobileApp(userAgent: string): boolean {
  return /\b(?:CPUWebScheduleApp|CPUWebIOSApp|CPUWebHarmonyApp|CPUWebFlutterApp|CPUTimeNative)\//i.test(userAgent);
}
