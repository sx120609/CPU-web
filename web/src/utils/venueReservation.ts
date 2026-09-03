export const VENUE_RESERVATION_URL = "https://cgtst.cpu.edu.cn/wap";
export const WECHAT_LAUNCH_URL = "weixin://";

export type VenueLaunchMode = "wechat" | "mobile" | "desktop";

export type VenueLaunchEnvironment = {
  userAgent?: string;
  maxTouchPoints?: number;
  viewportWidth?: number;
};

type VenueReservationLink = Pick<HTMLAnchorElement, "href" | "target" | "rel" | "referrerPolicy">;

export function isVenueIosDevice(environment: VenueLaunchEnvironment) {
  const userAgent = String(environment.userAgent || "");
  return /iPhone|iPad|iPod/iu.test(userAgent)
    || (/Macintosh/iu.test(userAgent) && Number(environment.maxTouchPoints || 0) > 1);
}

export function detectVenueLaunchMode(environment: VenueLaunchEnvironment): VenueLaunchMode {
  const userAgent = String(environment.userAgent || "");
  if (/MicroMessenger/iu.test(userAgent)) return "wechat";

  const mobileUserAgent = /Android|webOS|iPhone|iPad|iPod|HarmonyOS|Mobile|CPUWebHarmonyApp/iu.test(userAgent);
  const touchMac = isVenueIosDevice(environment);
  const compactTouchDevice = Number(environment.maxTouchPoints || 0) > 0
    && Number(environment.viewportWidth || 0) > 0
    && Number(environment.viewportWidth) <= 900;

  return mobileUserAgent || touchMac || compactTouchDevice ? "mobile" : "desktop";
}

export function configureVenueReservationLink<T extends VenueReservationLink>(link: T): T {
  link.href = VENUE_RESERVATION_URL;
  link.target = "_self";
  link.rel = "noreferrer";
  link.referrerPolicy = "no-referrer";
  return link;
}

export function openVenueReservationWithoutReferrer() {
  const link = configureVenueReservationLink(document.createElement("a"));
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function createVenueReservationShareData() {
  return { text: VENUE_RESERVATION_URL };
}
