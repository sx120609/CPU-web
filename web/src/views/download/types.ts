export type DownloadPlatform = "android" | "harmony" | "ios" | "windows" | "macos";

export type PlatformCard = {
  key: DownloadPlatform;
  group: "mobile" | "desktop";
  tone: string;
  name: string;
  support: string;
  summary: string;
  features: string[];
  steps: string[];
  actionLabel: string;
  actionHint: string;
  versionLabel: string;
  loading: boolean;
  downloadUrl?: string;
  route?: string;
};

export const platformGroups = [
  { key: "mobile", label: "手机与平板" },
  { key: "desktop", label: "电脑" },
] as const;

export function platformIconName(card: PlatformCard) {
  return card.group === "mobile" ? "mobile" : "desktop";
}
