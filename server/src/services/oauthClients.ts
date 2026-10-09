import { config } from "../config";

/** The shop is a confidential client, with one exact HTTPS callback. */
export function isShopOAuthClient(clientId: string) {
  return config.shopIntegrationSecret.length >= 32 && clientId === config.shopOAuthClientId;
}

export function isServiceOAuthClientId(clientId: string) {
  return clientId === config.shopOAuthClientId || clientId === config.payOAuthClientId;
}

export function serviceOAuthClient(clientId: string) {
  if (isShopOAuthClient(clientId)) return { secret: config.shopIntegrationSecret, callback: `${config.shopOrigin}/api/v1/auth/cputime/callback` };
  if (clientId === config.payOAuthClientId && config.payIntegrationSecret.length >= 32) {
    return { secret: config.payIntegrationSecret, callback: `${config.payOrigin}/api/auth/cputime/callback` };
  }
  return null;
}

export function oauthClientIsValid(clientId: string, redirectUri: string) {
  let url: URL;
  try { url = new URL(redirectUri); } catch { return false; }
  if (url.username || url.password || url.hash) return false;
  if (isServiceOAuthClientId(clientId)) {
    const service = serviceOAuthClient(clientId);
    if (!service) return false;
    const localDevelopment = config.nodeEnv !== "production" && url.protocol === "http:"
      && ["localhost", "127.0.0.1"].includes(url.hostname);
    return (url.protocol === "https:" || localDevelopment)
      && redirectUri === service.callback;
  }
  if (clientId !== config.oauthClientId) return false;
  return config.oauthAllowedRedirectUris.some((allowed) => {
    try {
      const target = new URL(allowed);
      if (target.origin === url.origin) return true;
      return target.protocol === "http:"
        && ["localhost", "127.0.0.1"].includes(target.hostname)
        && url.protocol === "http:"
        && ["localhost", "127.0.0.1"].includes(url.hostname);
    } catch { return false; }
  });
}

export function oauthScopesAllowed(clientId: string, scopes: string[]) {
  if (isServiceOAuthClientId(clientId) && !serviceOAuthClient(clientId)) return false;
  const allowed = new Set(isServiceOAuthClientId(clientId) ? ["openid", "profile"] : ["openid", "profile", "ai"]);
  return scopes.length > 0 && scopes.every(scope => allowed.has(scope));
}
