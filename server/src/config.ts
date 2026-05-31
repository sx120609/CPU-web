import dotenv from "dotenv";
dotenv.config();

export const config = {
  port: Number(process.env.PORT ?? 3000),
  jwtSecret: process.env.JWT_SECRET ?? "cpu-web-dev-secret",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  nodeEnv: process.env.NODE_ENV ?? "development",
  jwxtProxyUrl: process.env.JWXT_PROXY_URL ?? "",
  jwxtProxyAuth: process.env.JWXT_PROXY_AUTH ?? "",
  proxyAuth: process.env.PROXY_AUTH ?? "",
  proxyTimeoutMs: Number(process.env.JWXT_PROXY_TIMEOUT_MS ?? 15000),
  filestoreEnabled: process.env.FILESTORE_ENABLED !== "false",
  filestorePort: Number(process.env.FILESTORE_PORT ?? 8974),
  filestorePython: process.env.FILESTORE_PYTHON ?? "",
  filestoreAdminPassword: process.env.FILESTORE_ADMIN_PASSWORD ?? "admin123",
};

export const isDev = config.nodeEnv !== "production";
