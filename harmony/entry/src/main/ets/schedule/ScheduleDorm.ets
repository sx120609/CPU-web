import { SharePublishBody } from './ScheduleSharing';

/*
 * 宿舍课表（docs/dorm-schedule.md）在原生壳里是网页 /dorm-schedule：宿舍、成员和空闲计算都在网页。
 * 原生只把当前学期的整学期课表（含个人修改）通过 window.CPUTimeNativeDorm 交给网页，
 * 由网页按网页课表的规则上传。
 */

export const DORM_SCHEDULE_PAGE: string = '/dorm-schedule';

export interface DormOfferRequest {
  action: string;
  snapshot: SharePublishBody;
  account?: string;
}

/** 宿舍码：去掉空白、转大写；不像宿舍码时返回空串。 */
export function dormInviteCode(value: string): string {
  const code = value.replace(/\s+/g, '').toUpperCase();
  return /^[A-Z0-9]{4,12}$/.test(code) ? code : '';
}

/** 宿舍课表页；有宿舍码时在页面里预先填好。 */
export function dormSchedulePage(code: string = ''): string {
  const value = dormInviteCode(code);
  return value ? `${DORM_SCHEDULE_PAGE}?code=${value}` : DORM_SCHEDULE_PAGE;
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch (_) {
    return value;
  }
}

/**
 * 应用内打开的宿舍邀请链接（/schedule?dorm=1&code=…）改去宿舍课表页，否则原生课表会把宿舍码吞掉；
 * 其他路径返回空串。
 */
export function dormPagePath(path: string): string {
  const target = path.split('#')[0];
  const mark = target.indexOf('?');
  if ((mark < 0 ? target : target.substring(0, mark)) !== '/schedule' || mark < 0) return '';
  let dorm = '';
  let code = '';
  target.substring(mark + 1).split('&').forEach((part: string) => {
    const index = part.indexOf('=');
    const key = decode(index < 0 ? part : part.substring(0, index));
    const value = index < 0 ? '' : decode(part.substring(index + 1));
    if (key === 'dorm') dorm = value;
    else if (key === 'code') code = value;
  });
  return dorm === '1' ? dormSchedulePage(code) : '';
}

/** 交给网页的请求：只给正在进行的学期，account 让网页确认这是同一个账号的课表。 */
export function dormOfferRequest(snapshot: SharePublishBody, account: string): DormOfferRequest {
  const request: DormOfferRequest = { action: 'offer', snapshot };
  if (account) request.account = account;
  return request;
}
