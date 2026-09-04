export const APP_NAME = '药大拾间';
export const APP_URL = 'https://cputime.cn/schedule?client=harmony-app&appVersionCode=18&appVersionName=2.0.9';
export const APP_HOST = 'cputime.cn';
export const VERSION_CODE = 18;
export const VERSION_NAME = '2.0.9';
export const USER_AGENT_SUFFIX = `CPUWebHarmonyApp/${VERSION_CODE} CPUWebHarmonyAppVersion/${VERSION_NAME}`;
const PAYMENT_HOST = 'pay.kaipay.cn';

function protocolOf(input: string): string {
  const trimmed = input.trim().toLowerCase();
  const schemeEnd = trimmed.indexOf('://');
  return schemeEnd > 0 ? trimmed.substring(0, schemeEnd + 1) : '';
}

function hostOf(input: string): string {
  const trimmed = input.trim();
  const schemeEnd = trimmed.indexOf('://');
  if (schemeEnd <= 0) return '';
  const rest = trimmed.substring(schemeEnd + 3);
  let end = rest.length;
  const slash = rest.indexOf('/');
  const query = rest.indexOf('?');
  const hash = rest.indexOf('#');
  if (slash >= 0 && slash < end) end = slash;
  if (query >= 0 && query < end) end = query;
  if (hash >= 0 && hash < end) end = hash;
  const authority = rest.substring(0, end);
  const colon = authority.indexOf(':');
  return (colon >= 0 ? authority.substring(0, colon) : authority).toLowerCase();
}

export function isInternalUrl(url: string): boolean {
  const host = hostOf(url);
  return protocolOf(url) === 'https:' && (host === APP_HOST || host === PAYMENT_HOST);
}

export function isAppOrigin(url: string): boolean {
  return protocolOf(url) === 'https:' && hostOf(url) === APP_HOST;
}

export function isHttpUrl(url: string): boolean {
  const protocol = protocolOf(url);
  return protocol === 'http:' || protocol === 'https:';
}

export function isSupportedExternalUrl(url: string): boolean {
  if (isHttpUrl(url)) return true;
  const normalized = (url ?? '').trim().toLowerCase();
  return normalized.startsWith('tel:') || normalized.startsWith('mailto:') || normalized.startsWith('sms:');
}

function queryValue(input: string, name: string): string {
  const question = input.indexOf('?');
  if (question < 0) return '';
  const hash = input.indexOf('#', question);
  const query = input.substring(question + 1, hash >= 0 ? hash : input.length);
  const pairs = query.split('&');
  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index];
    const equals = pair.indexOf('=');
    let key = '';
    try {
      key = decodeURIComponent(equals >= 0 ? pair.substring(0, equals) : pair);
    } catch (_) {
      continue;
    }
    if (key !== name) continue;
    try {
      return decodeURIComponent(equals >= 0 ? pair.substring(equals + 1) : '');
    } catch (_) {
      return '';
    }
  }
  return '';
}

export function destinationUrlForDeepLink(uri?: string): string {
  const raw = (uri ?? '').trim();
  if (protocolOf(raw) !== 'cpuweb:' || hostOf(raw) !== 'schedule') return '';

  let target = APP_URL;
  target += '&source=widget&week=current';
  const semester = queryValue(raw, 'widgetSemester').trim();
  if (/^\d{4}-\d{4}-[12]$/.test(semester)) {
    target += `&widgetSemester=${encodeURIComponent(semester)}`;
  }
  const week = Number(queryValue(raw, 'widgetWeek'));
  if (Number.isInteger(week) && week >= 1 && week <= 64) {
    target += `&widgetWeek=${week}`;
  }
  return target;
}
