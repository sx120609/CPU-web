import dotenv from "dotenv";
dotenv.config();

const nodeEnv = process.env.NODE_ENV ?? "development";
const isProd = nodeEnv === "production";

const jwtSecret = process.env.JWT_SECRET;
if (isProd && !jwtSecret) {
  throw new Error("JWT_SECRET 环境变量必须在生产环境中设置");
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  jwtSecret: jwtSecret ?? "cpu-web-dev-secret",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  nodeEnv,
  jwxtProxyUrl: process.env.JWXT_PROXY_URL ?? "",
  jwxtProxyAuth: process.env.JWXT_PROXY_AUTH ?? "",
  proxyAuth: process.env.PROXY_AUTH ?? "",
  proxyTimeoutMs: Number(process.env.JWXT_PROXY_TIMEOUT_MS ?? 15000),
};

export const isDev = !isProd;
