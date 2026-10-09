import { config } from "../config";

/** The shop is a confidential client, with one exact HTTPS callback. */
export function isShopOAuthClient(clientId: string) {
  return config.shopIntegrationSecret.length >= 32 && clientId === config.shopOAuthClientId;
}

export function oauthClientIsValid(clientId: string, redirectUri: string) {
  let url: URL;
  try { url = new URL(redirectUri); } catch { return false; }
  if (url.username || url.password || url.hash) return false;
  if (isShopOAuthClient(clientId)) {
    const localDevelopment = config.nodeEnv !== "production" && url.protocol === "http:"
      && ["localhost", "127.0.0.1"].includes(url.hostname);
    return (url.protocol === "https:" || localDevelopment)
      && redirectUri === `${config.shopOrigin}/api/v1/auth/cputime/callback`;
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
  const allowed = new Set(isShopOAuthClient(clientId) ? ["openid", "profile"] : ["openid", "profile", "ai"]);
  return scopes.length > 0 && scopes.every(scope => allowed.has(scope));
}
