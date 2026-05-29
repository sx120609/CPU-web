export const APP_NAME = '药大拾间';
export const APP_URL = 'https://cpu.lizmt.cn/schedule?client=harmony-app&appVersionCode=17&appVersionName=2.0.8';
export const APP_HOST = 'cpu.lizmt.cn';
export const VERSION_CODE = 17;
export const VERSION_NAME = '2.0.8';
export const USER_AGENT_TOKEN = `Mozilla/5.0 (Linux; HarmonyOS; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 CPUWebHarmonyApp/${VERSION_CODE} CPUWebHarmonyAppVersion/${VERSION_NAME}`;

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
  return protocolOf(url) === 'https:' && hostOf(url) === APP_HOST;
}

export function isHttpUrl(url: string): boolean {
  const protocol = protocolOf(url);
  return protocol === 'http:' || protocol === 'https:';
}
