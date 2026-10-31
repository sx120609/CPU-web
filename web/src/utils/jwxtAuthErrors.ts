/** 服务端给教务授权失效统一打的错误码（server/src/services/jwxtErrors.ts）。 */
export const JWXT_AUTH_EXPIRED_CODE = 4011;
/** 站内登录失效的错误码；它不是教务授权的事，不能拿来清教务会话。 */
const SITE_AUTH_CODE = 4001;

/**
 * 是不是教务授权失效。服务端会给这类错误带上 4011；
 * 没有错误码的 401（旧服务端、节点直接回的）才看文字，站内登录的 4001 和其他错误码一律不算。
 */
export function isJwxtAuthExpiredResponse(status: number, message = "", code?: number) {
  if (code === JWXT_AUTH_EXPIRED_CODE) return true;
  if (code === SITE_AUTH_CODE || (code && code !== 0)) return false;
  return status === 401 || /请先登录教务|教务会话已失效|统一认证会话已失效|重新授权/.test(message);
}

export type JwxtRequestError = Error & {
  status?: number;
  code?: number;
  response?: unknown;
  /** 教务授权失效。 */
  jwxtAuthExpired?: boolean;
  /** 发出请求时的会话代次。 */
  authGeneration?: number;
};

/** 统一判断一个错误是不是教务授权失效，课表加载、原生桥、刷新提示都用它。 */
export function isJwxtAuthFailure(error: unknown) {
  const candidate = error as JwxtRequestError | null | undefined;
  if (!candidate || typeof candidate !== "object") return false;
  if (typeof candidate.jwxtAuthExpired === "boolean") return candidate.jwxtAuthExpired;
  const response = candidate.response as { status?: number; data?: { code?: number; message?: string } } | undefined;
  return isJwxtAuthExpiredResponse(
    Number(candidate.status || response?.status || 0),
    String(candidate.message || response?.data?.message || ""),
    Number(candidate.code ?? response?.data?.code) || undefined,
  );
}
