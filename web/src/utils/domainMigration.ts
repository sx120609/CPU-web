export const LEGACY_SITE_HOSTNAME = "cpu.lizmt.cn";
export const PRIMARY_SITE_ORIGIN = "https://cputime.cn";
export const LEGACY_DOMAIN_NOTICE_STORAGE_KEY = "cpu:legacy-domain-notice-snooze-until:v1";
export const LEGACY_DOMAIN_NOTICE_SNOOZE_MS = 24 * 60 * 60 * 1000;

type SiteLocation = Pick<Location, "pathname" | "search" | "hash">;

export type MigrationAudience = "android-app" | "android-web" | "ios" | "desktop-app" | "other";

type MigrationAudienceSignals = {
  androidNative: boolean;
  desktopNative: boolean;
  iosDevice: boolean;
  androidDevice: boolean;
};

export function isLegacySiteHostname(hostname: string) {
  return hostname.trim().toLowerCase().replace(/\.$/, "") === LEGACY_SITE_HOSTNAME;
}

export function shouldShowLegacyDomainNotice(
  hostname: string,
  snoozeUntil: string | null,
  now = Date.now(),
) {
  if (!isLegacySiteHostname(hostname)) return false;
  if (!snoozeUntil) return true;

  const timestamp = Number(snoozeUntil);
  return !Number.isFinite(timestamp) || timestamp <= now;
}

export function resolveMigrationAudience({
  androidNative,
  desktopNative,
  iosDevice,
  androidDevice,
}: MigrationAudienceSignals): MigrationAudience {
  if (androidNative) return "android-app";
  if (desktopNative) return "desktop-app";
  if (iosDevice) return "ios";
  if (androidDevice) return "android-web";
  return "other";
}

export function buildPrimarySiteUrl(location: SiteLocation) {
  const pathname = location.pathname.startsWith("/") ? location.pathname : `/${location.pathname}`;
  return new URL(`${pathname}${location.search}${location.hash}`, PRIMARY_SITE_ORIGIN).toString();
}
