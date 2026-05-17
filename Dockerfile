# ---- Stage 1: Build ----
FROM node:20-slim AS builder

WORKDIR /app

# 安装系统依赖（Prisma 引擎需要）
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 先复制 package 文件，利用 Docker 层缓存
COPY package.json package-lock.json* ./
COPY server/package.json server/package-lock.json* server/
COPY web/package.json web/package-lock.json* web/

# 安装全部依赖
RUN npm install --prefix server && npm install --prefix web

# 复制源码
COPY server/ server/
COPY web/ web/

# 生成 Prisma Client（linux 二进制）
RUN npx prisma generate --schema=server/prisma/schema.prisma

# 构建后端 TypeScript
RUN npm run build --prefix server

# 构建前端
RUN npm run build --prefix web

# ---- Stage 2: Runtime ----
FROM node:20-slim AS runtime

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# 复制后端构建产物 + 依赖
COPY --from=builder /app/server/dist server/dist
COPY --from=builder /app/server/node_modules server/node_modules
COPY --from=builder /app/server/package.json server/package.json
COPY --from=builder /app/server/prisma server/prisma

# 复制前端构建产物
COPY --from=builder /app/web/dist web/dist

# SQLite 数据目录（可通过 volume 持久化）
RUN mkdir -p /app/data

# 数据库 URL — 默认指向容器内持久化路径
ENV DATABASE_URL="file:/app/data/prod.db"
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# 数据库迁移 + 启动
CMD ["sh", "-c", "npx prisma migrate deploy --schema=server/prisma/schema.prisma && node server/dist/index.js"]
