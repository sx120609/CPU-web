export type NativeAppBridge = {
  getVersionCode?: () => number;
  getVersionName?: () => string;
  supportsScheduleWidget?: () => boolean;
  supportsInAppApkDownload?: () => boolean;
  copyText?: (text: string) => boolean;
  openExternalUrl?: (url: string) => void;
  downloadAndInstallApk?: (url: string, fileName?: string) => boolean;
  saveImage?: (dataUrl: string, fileName?: string) => boolean;
  installScheduleWidget?: (payload: string) => void;
};

export function getNativeBridge(): NativeAppBridge | null {
  if (typeof window === "undefined") return null;
  return ((window as any).CPUHarmony ?? (window as any).CPUAndroid ?? null) as NativeAppBridge | null;
}

export function hasNativeImageSaveBridge() {
  return typeof getNativeBridge()?.saveImage === "function";
}
