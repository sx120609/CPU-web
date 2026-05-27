import dotenv from "dotenv";
dotenv.config();

const nodeEnv = process.env.NODE_ENV ?? "development";
const isDev = nodeEnv !== "production";

const jwtSecret = process.env.JWT_SECRET ?? (isDev ? "cpu-web-dev-secret" : "");
if (!isDev && !jwtSecret) {
  console.error("❌ JWT_SECRET 环境变量未设置，生产环境不允许使用默认密钥");
  process.exit(1);
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  nodeEnv,
  jwxtProxyUrl: process.env.JWXT_PROXY_URL ?? "",
  jwxtProxyAuth: process.env.JWXT_PROXY_AUTH ?? "",
  proxyAuth: process.env.PROXY_AUTH ?? "",
  proxyTimeoutMs: Number(process.env.JWXT_PROXY_TIMEOUT_MS ?? 15000),
  siteOrigin: process.env.SITE_ORIGIN ?? "",
};

export { isDev };
