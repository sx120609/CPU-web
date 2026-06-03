#!/usr/bin/env bash
# 药大拾间 一键部署脚本（Debian / Ubuntu）
#
# 用法：
#   ./deploy.sh                  # 首次部署：装依赖 + 初始化 DB + 构建前端 + 启动
#   ./deploy.sh update           # 更新部署：git pull + 重装 + 重建 + 重启
#   ./deploy.sh start            # 仅启动
#   ./deploy.sh stop             # 停止
#   ./deploy.sh restart          # 重启
#   ./deploy.sh logs             # 查看日志
#   ./deploy.sh status           # 查看进程状态
#   ./deploy.sh reset-db         # 重置 PostgreSQL schema 并重新写入种子数据
#   ./deploy.sh postgres-init [db] [user]            # 安装 PostgreSQL、创建应用库和账号，并写入 server/.env
#   ./deploy.sh postgres-config "postgresql://..."   # 手动写入 PostgreSQL 连接串并刷新后端环境
#   ./deploy.sh redis-init [db-index]                # 安装 Redis 并写入 REDIS_URL
#   ./deploy.sh redis-config "redis://..."           # 手动写入 Redis 连接串并刷新后端环境
#   ./deploy.sh proxy-init       # 代理端首次部署：装依赖 + 构建后端 + 启动教务代理
#   ./deploy.sh proxy-update     # 代理端更新：git pull + 重装 + 重建后端 + 重启教务代理
#   ./deploy.sh proxy-start      # 启动教务代理
#   ./deploy.sh proxy-restart    # 重启教务代理
#   ./deploy.sh proxy-logs       # 查看教务代理日志
#
# 默认监听端口：23333（避开 3000 / 8000 / 8080 等常见端口冲突）
# 自定义端口：PORT=12345 ./deploy.sh
# 代理默认端口：23334；自定义端口：PROXY_PORT=12345 ./deploy.sh proxy-init
# 后台进程：pm2 管理；开机自启需要再跑一次 `pm2 startup` + `pm2 save`

set -euo pipefail

# ---------- 颜色与日志 ----------
if [ -t 1 ]; then
  R=$'\033[31m'; G=$'\033[32m'; Y=$'\033[33m'; B=$'\033[34m'; N=$'\033[0m'
else
  R= G= Y= B= N=
fi
log()  { echo "${G}[deploy]${N} $*"; }
warn() { echo "${Y}[deploy]${N} $*" >&2; }
err()  { echo "${R}[deploy]${N} $*" >&2; exit 1; }

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"
SERVICE_NAME="cpu-web"
PROXY_SERVICE_NAME="cpu-jwxt-proxy"
PORT="${PORT:-23333}"
PROXY_PORT="${PROXY_PORT:-23334}"
ENV_FILE="server/.env"
CMD_ARG_1="${2:-}"
CMD_ARG_2="${3:-}"

escape_env_value() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

env_get() {
  local key="$1"
  [ -f "$ENV_FILE" ] || return 0
  local line
  line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 || true)"
  [ -n "$line" ] || return 0
  local value="${line#*=}"
  value="${value%$'\r'}"
  if [[ "$value" =~ ^\".*\"$ ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
}

env_set() {
  local key="$1"
  local value="$2"
  local escaped tmp
  escaped="$(escape_env_value "$value")"
  tmp="$(mktemp)"
  if [ -f "$ENV_FILE" ]; then
    awk -v key="$key" -v val="$escaped" '
      BEGIN { done = 0 }
      $0 ~ "^" key "=" {
        print key "=\"" val "\""
        done = 1
        next
      }
      { print }
      END {
        if (!done) print key "=\"" val "\""
      }
    ' "$ENV_FILE" > "$tmp"
  else
    printf '%s="%s"\n' "$key" "$escaped" > "$tmp"
  fi
  mv "$tmp" "$ENV_FILE"
}

mask_postgres_url() {
  local url="$1"
  if [ -z "$url" ]; then
    echo "(未配置)"
    return
  fi
  echo "$url" | sed -E 's#(postgres(ql)?://[^:/@]+):[^@]*@#\1:***@#'
}

is_postgres_url() {
  [[ "$1" =~ ^postgres(ql)?:// ]]
}

configured_database_url() {
  local from_file
  from_file="$(env_get DATABASE_URL)"
  if [ -n "$from_file" ]; then
    printf '%s' "$from_file"
  else
    printf '%s' "${DATABASE_URL:-}"
  fi
}

mask_redis_url() {
  local url="$1"
  if [ -z "$url" ]; then
    echo "(未配置)"
    return
  fi
  echo "$url" | sed -E 's#(redis(s)?://[^:/@]+):[^@]*@#\1:***@#'
}

is_redis_url() {
  [[ "$1" =~ ^redis(s)?:// ]]
}

configured_redis_url() {
  local from_file
  from_file="$(env_get REDIS_URL)"
  if [ -n "$from_file" ]; then
    printf '%s' "$from_file"
  else
    printf '%s' "${REDIS_URL:-}"
  fi
}

redis_input_url() {
  if [ -n "${REDIS_URL:-}" ] && is_redis_url "${REDIS_URL:-}"; then
    printf '%s' "$REDIS_URL"
    return
  fi
  if [ -n "${CMD_ARG_1:-}" ] && is_redis_url "$CMD_ARG_1"; then
    printf '%s' "$CMD_ARG_1"
  fi
}

runtime_uses_redis() {
  local url
  url="$(configured_redis_url)"
  is_redis_url "$url"
}

postgres_input_url() {
  if [ -n "${POSTGRES_DATABASE_URL:-}" ]; then
    printf '%s' "$POSTGRES_DATABASE_URL"
    return
  fi
  if [ -n "${CMD_ARG_1:-}" ] && is_postgres_url "$CMD_ARG_1"; then
    printf '%s' "$CMD_ARG_1"
  fi
}

runtime_uses_postgres() {
  local url
  url="$(configured_database_url)"
  is_postgres_url "$url"
}

maybe_restart_running_service() {
  if command -v pm2 >/dev/null 2>&1 && pm2 describe "$SERVICE_NAME" >/dev/null 2>&1; then
    log "检测到 $SERVICE_NAME 正在运行，重启使新配置生效"
    pm2 restart "$SERVICE_NAME" --update-env
    pm2 save >/dev/null
  fi
}

postgres_init_db_name() {
  printf '%s' "${POSTGRES_DB_NAME:-${CMD_ARG_1:-cpu_web}}"
}

postgres_init_user() {
  printf '%s' "${POSTGRES_APP_USER:-${CMD_ARG_2:-cpu_web_app}}"
}

postgres_init_password() {
  if [ -n "${POSTGRES_APP_PASSWORD:-}" ]; then
    printf '%s' "$POSTGRES_APP_PASSWORD"
  else
    openssl rand -hex 24 2>/dev/null || echo "cpuweb-pg-$(date +%s)"
  fi
}

sql_ident() {
  printf '"%s"' "$(printf '%s' "$1" | sed 's/"/""/g')"
}

sql_literal() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/''/g")"
}

postgres_psql() {
  local sql="$1"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres -tAc "$sql"
}

ensure_postgres() {
  if command -v psql >/dev/null 2>&1; then
    log "PostgreSQL 客户端已安装：$(psql --version | head -n 1)"
  else
    if ! command -v sudo >/dev/null 2>&1; then
      err "需要 sudo 才能安装 PostgreSQL。请手动安装或以 root 运行此脚本"
    fi
    log "安装 PostgreSQL 服务端与客户端"
    sudo apt-get update
    sudo apt-get install -y postgresql postgresql-contrib
  fi

  if command -v systemctl >/dev/null 2>&1; then
    sudo systemctl enable postgresql >/dev/null 2>&1 || true
    sudo systemctl restart postgresql
  else
    sudo service postgresql restart
  fi

  sudo -u postgres psql -d postgres -c "SELECT 1" >/dev/null
}

ensure_redis() {
  if command -v redis-server >/dev/null 2>&1 && command -v redis-cli >/dev/null 2>&1; then
    log "Redis 已安装：$(redis-server --version | head -n 1)"
  else
    if ! command -v sudo >/dev/null 2>&1; then
      err "需要 sudo 才能安装 Redis。请手动安装 redis-server / redis-cli 或以 root 运行此脚本"
    fi
    log "安装 Redis 服务端与客户端"
    sudo apt-get update
    sudo apt-get install -y redis-server redis-tools
  fi

  if command -v systemctl >/dev/null 2>&1; then
    sudo systemctl enable redis-server >/dev/null 2>&1 || true
    sudo systemctl restart redis-server
  else
    sudo service redis-server restart
  fi

  redis-cli ping >/dev/null 2>&1 || warn "redis-cli ping 失败，请手动检查 Redis 服务状态"
}

# ---------- 环境检查与安装 ----------
NODE_MIN_MAJOR=20  # undici / 现代 fetch 依赖 Node 20+ 的 File 全局

ensure_node() {
  if command -v node >/dev/null 2>&1; then
    local v=$(node -v | sed 's/v//')
    local major=${v%%.*}
    if [ "$major" -lt "$NODE_MIN_MAJOR" ]; then
      warn "检测到 Node $v ，本项目需要 Node $NODE_MIN_MAJOR+（undici 依赖 File 全局，Node 18 默认不开启）"
      # 杀掉所有 pm2 进程（旧 Node 二进制要被替换）
      if command -v pm2 >/dev/null 2>&1; then
        log "停止现有 pm2 进程，准备升级 Node"
        pm2 kill || true
      fi
      install_node
    else
      log "Node $v ✓"
    fi
  else
    log "Node.js 未安装，使用 NodeSource 安装 20 LTS"
    install_node
  fi
}

install_node() {
  if ! command -v sudo >/dev/null 2>&1; then
    err "需要 sudo 才能安装/升级 Node.js。请手动安装 Node 20+ 或以 root 运行此脚本"
  fi
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
  log "Node 已安装：$(node -v)"
  # 升级 Node 后 pm2 也要重装到新 Node 下
  if command -v pm2 >/dev/null 2>&1; then
    log "重装 pm2 到新 Node 下"
    npm install -g pm2 2>/dev/null || sudo npm install -g pm2 || true
  fi
}

ensure_pm2() {
  if command -v pm2 >/dev/null 2>&1; then
    log "pm2 $(pm2 -v) ✓"
    return
  fi
  log "pm2 未安装，正在全局安装"
  # 优先用 npm，失败则尝试 sudo
  if npm install -g pm2 2>/dev/null; then :
  elif command -v sudo >/dev/null 2>&1 && sudo npm install -g pm2; then :
  else err "pm2 安装失败"
  fi
}

ensure_ffmpeg() {
  if command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1; then
    log "ffmpeg 已安装：$(ffmpeg -version 2>/dev/null | head -n 1)"
    return
  fi
  if ! command -v sudo >/dev/null 2>&1; then
    err "需要 sudo 才能安装 ffmpeg。请手动安装 ffmpeg / ffprobe 或以 root 运行此脚本"
  fi
  log "安装 ffmpeg（视频抽帧 / 转写预处理依赖）"
  sudo apt-get update
  sudo apt-get install -y ffmpeg
  log "ffmpeg 已安装：$(ffmpeg -version 2>/dev/null | head -n 1)"
}

ensure_env() {
  if [ ! -f "$ENV_FILE" ]; then
    log "首次部署，创建 server/.env"
    cat > "$ENV_FILE" <<EOF
PORT=$PORT
DATABASE_URL=""
POSTGRES_DATABASE_URL=""
JWT_SECRET="$(openssl rand -hex 32 2>/dev/null || echo "please-change-me-$(date +%s)")"
JWT_EXPIRES_IN="7d"
NODE_ENV=production
REDIS_ENABLED="true"
REDIS_URL=""
REDIS_PREFIX="cpu-web"
MEDIA_STORAGE_PROVIDER="local"
MEDIA_STORAGE_IMAGE_PROVIDER="local"
MEDIA_STORAGE_VIDEO_PROVIDER="local"
EOF
    log "已生成随机 JWT_SECRET"
  fi
  if ! grep -q '^POSTGRES_DATABASE_URL=' "$ENV_FILE" 2>/dev/null; then
    echo 'POSTGRES_DATABASE_URL=""' >> "$ENV_FILE"
  fi
  if ! grep -q '^REDIS_ENABLED=' "$ENV_FILE" 2>/dev/null; then
    echo 'REDIS_ENABLED="true"' >> "$ENV_FILE"
  fi
  if ! grep -q '^REDIS_URL=' "$ENV_FILE" 2>/dev/null; then
    echo 'REDIS_URL=""' >> "$ENV_FILE"
  fi
  if ! grep -q '^REDIS_PREFIX=' "$ENV_FILE" 2>/dev/null; then
    echo 'REDIS_PREFIX="cpu-web"' >> "$ENV_FILE"
  fi
  if ! grep -q '^MEDIA_STORAGE_PROVIDER=' "$ENV_FILE" 2>/dev/null; then
    echo 'MEDIA_STORAGE_PROVIDER="local"' >> "$ENV_FILE"
  fi
  if ! grep -q '^MEDIA_STORAGE_IMAGE_PROVIDER=' "$ENV_FILE" 2>/dev/null; then
    echo 'MEDIA_STORAGE_IMAGE_PROVIDER="local"' >> "$ENV_FILE"
  fi
  if ! grep -q '^MEDIA_STORAGE_VIDEO_PROVIDER=' "$ENV_FILE" 2>/dev/null; then
    echo 'MEDIA_STORAGE_VIDEO_PROVIDER="local"' >> "$ENV_FILE"
  fi
}

ensure_proxy_env() {
  if [ ! -f server/.env ]; then
    log "代理端首次部署，创建 server/.env"
    cat > server/.env <<EOF
NODE_ENV=production
PROXY_PORT=$PROXY_PORT
PROXY_AUTH="$(openssl rand -hex 32 2>/dev/null || echo "please-change-proxy-auth-$(date +%s)")"
EOF
    log "已生成随机 PROXY_AUTH；请把同一个值配置到主服务 JWXT_PROXY_AUTH"
  fi
  if ! grep -q '^PROXY_AUTH=' server/.env 2>/dev/null; then
    warn "server/.env 中未配置 PROXY_AUTH；代理会跳过鉴权，仅建议本地调试使用"
  fi
}

# ---------- 子步骤 ----------
do_install() {
  log "安装依赖（root + server + web）..."
  npm install --no-audit --no-fund
  log "生成 Prisma Client"
  npm run prisma:generate --prefix server || err "Prisma Client 生成失败，请检查 Prisma 环境"
}

do_build() {
  log "构建前再次生成 Prisma Client"
  npm run prisma:generate --prefix server || err "构建前 Prisma Client 生成失败"
  log "构建后端 TypeScript → server/dist"
  npm run build --prefix server
  log "构建前端 Vite → web/dist"
  npm run build --prefix web
}

do_build_proxy() {
  log "代理构建前再次生成 Prisma Client"
  npm run prisma:generate --prefix server || err "代理构建前 Prisma Client 生成失败"
  log "构建代理端后端 TypeScript → server/dist"
  npm run build --prefix server
}

do_db_init() {
  local db_url user_count
  db_url="$(configured_database_url)"
  is_postgres_url "$db_url" || err "当前 deploy.sh 仅支持 PostgreSQL。请先运行 ./deploy.sh postgres-init 或 ./deploy.sh postgres-config"
  log "同步 PostgreSQL schema"
  npm run db:migrate --prefix server
  user_count="$(
    cd server && node -e 'const { PrismaClient } = require("@prisma/client"); const p = new PrismaClient(); p.user.count().then((c) => { console.log(c); }).catch(() => { console.log(""); process.exitCode = 1; }).finally(() => p.$disconnect());' 2>/dev/null | tr -d '[:space:]'
  )"
  if [ -z "$user_count" ] || [ "$user_count" = "0" ]; then
    log "检测到空 PostgreSQL 库，写入种子数据"
    npm run db:seed --prefix server
  else
    log "检测到 PostgreSQL 已有数据（User: $user_count），跳过 seed"
  fi
  log "数据库初始化完成后再次生成 Prisma Client"
  npm run prisma:generate --prefix server
}

do_db_reset() {
  warn "⚠️  将重置当前 PostgreSQL schema 并删除所有论坛数据！5 秒内 Ctrl+C 取消..."
  sleep 5
  npm run db:reset --prefix server
}

do_postgres_config() {
  ensure_env
  local input_url
  input_url="$(postgres_input_url)"
  if [ -n "$input_url" ]; then
    env_set DATABASE_URL "$input_url"
    env_set POSTGRES_DATABASE_URL "$input_url"
    log "已写入 DATABASE_URL / POSTGRES_DATABASE_URL：$(mask_postgres_url "$input_url")"
    maybe_restart_running_service
    return
  fi
  local current
  current="$(configured_database_url)"
  if [ -n "$current" ]; then
    log "当前 DATABASE_URL：$(mask_postgres_url "$current")"
  else
    warn "当前尚未配置 PostgreSQL 连接串"
  fi
  echo ""
  echo "   可执行："
  echo "     ./deploy.sh postgres-config 'postgresql://user:password@127.0.0.1:5432/cpu_web?schema=public'"
  echo "   或者："
  echo "     POSTGRES_DATABASE_URL='postgresql://user:password@127.0.0.1:5432/cpu_web?schema=public' ./deploy.sh postgres-config"
}

do_postgres_init() {
  ensure_node
  ensure_env
  ensure_postgres

  local db_name app_user app_password host port url role_exists db_exists
  db_name="$(postgres_init_db_name)"
  app_user="$(postgres_init_user)"
  app_password="$(postgres_init_password)"
  host="${POSTGRES_HOST:-127.0.0.1}"
  port="${POSTGRES_PORT:-5432}"

  [[ "$db_name" =~ ^[a-zA-Z0-9_]+$ ]] || err "数据库名仅支持字母、数字和下划线：$db_name"
  [[ "$app_user" =~ ^[a-zA-Z0-9_]+$ ]] || err "数据库用户名仅支持字母、数字和下划线：$app_user"

  role_exists="$(postgres_psql "SELECT 1 FROM pg_roles WHERE rolname = $(sql_literal "$app_user")" | tr -d '[:space:]')"
  if [ "$role_exists" = "1" ]; then
    log "PostgreSQL 角色已存在：$app_user，更新密码"
    postgres_psql "ALTER ROLE $(sql_ident "$app_user") WITH LOGIN PASSWORD $(sql_literal "$app_password")"
  else
    log "创建 PostgreSQL 角色：$app_user"
    postgres_psql "CREATE ROLE $(sql_ident "$app_user") WITH LOGIN PASSWORD $(sql_literal "$app_password")"
  fi

  db_exists="$(postgres_psql "SELECT 1 FROM pg_database WHERE datname = $(sql_literal "$db_name")" | tr -d '[:space:]')"
  if [ "$db_exists" = "1" ]; then
    log "PostgreSQL 数据库已存在：$db_name，调整 owner 为 $app_user"
    postgres_psql "ALTER DATABASE $(sql_ident "$db_name") OWNER TO $(sql_ident "$app_user")"
  else
    log "创建 PostgreSQL 数据库：$db_name"
    postgres_psql "CREATE DATABASE $(sql_ident "$db_name") OWNER $(sql_ident "$app_user")"
  fi

  url="postgresql://${app_user}:${app_password}@${host}:${port}/${db_name}?schema=public"
  env_set DATABASE_URL "$url"
  env_set POSTGRES_DATABASE_URL "$url"
  env_set POSTGRES_DB_NAME "$db_name"
  env_set POSTGRES_APP_USER "$app_user"

  log "已写入 DATABASE_URL / POSTGRES_DATABASE_URL：$(mask_postgres_url "$url")"
  log "数据库账号：$app_user"
  log "数据库名称：$db_name"
  log "数据库密码：$app_password"
  warn "请妥善保存上面的数据库密码；脚本只会在当前输出里明文显示一次。"
  maybe_restart_running_service
}

do_redis_config() {
  ensure_env
  local input_url
  input_url="$(redis_input_url)"
  if [ -n "$input_url" ]; then
    env_set REDIS_ENABLED "true"
    env_set REDIS_URL "$input_url"
    if [ -z "$(env_get REDIS_PREFIX)" ]; then
      env_set REDIS_PREFIX "cpu-web"
    fi
    log "已写入 REDIS_URL：$(mask_redis_url "$input_url")"
    maybe_restart_running_service
    return
  fi
  local current
  current="$(configured_redis_url)"
  if [ -n "$current" ]; then
    log "当前 REDIS_URL：$(mask_redis_url "$current")"
  else
    warn "当前尚未配置 Redis 连接串"
  fi
  echo ""
  echo "   可执行："
  echo "     ./deploy.sh redis-config 'redis://127.0.0.1:6379/0'"
  echo "   或者："
  echo "     REDIS_URL='redis://127.0.0.1:6379/0' ./deploy.sh redis-config"
}

do_redis_init() {
  ensure_env
  ensure_redis
  local db_index
  db_index="${REDIS_DB_INDEX:-${CMD_ARG_1:-0}}"
  [[ "$db_index" =~ ^[0-9]+$ ]] || err "Redis DB index 必须是非负整数：$db_index"
  local url="redis://127.0.0.1:6379/${db_index}"
  env_set REDIS_ENABLED "true"
  env_set REDIS_URL "$url"
  if [ -z "$(env_get REDIS_PREFIX)" ]; then
    env_set REDIS_PREFIX "cpu-web"
  fi
  log "已写入 REDIS_URL：$(mask_redis_url "$url")"
  maybe_restart_running_service
}

do_start() {
  ensure_pm2
  log "通过 pm2 启动 $SERVICE_NAME（端口 $PORT）"
  # 用 ecosystem-less 模式：直接 start 命令
  cd server
  if pm2 describe "$SERVICE_NAME" >/dev/null 2>&1; then
    pm2 restart "$SERVICE_NAME" --update-env
  else
    NODE_ENV=production PORT=$PORT pm2 start "node dist/index.js" \
      --name "$SERVICE_NAME" \
      --time \
      --max-memory-restart 600M \
      --log-date-format "YYYY-MM-DD HH:mm:ss" \
      --merge-logs
  fi
  cd ..
  pm2 save >/dev/null
  echo ""
  log "✅ 部署完成"
  echo ""
  echo "   访问地址：${B}http://$(hostname -I 2>/dev/null | awk '{print $1}'):$PORT${N}"
  echo "   或者：    ${B}http://localhost:$PORT${N}"
  echo ""
  echo "   常用命令："
  echo "     pm2 status              查看进程状态"
  echo "     pm2 logs $SERVICE_NAME       查看实时日志"
  echo "     pm2 restart $SERVICE_NAME    重启服务"
  echo "     pm2 stop $SERVICE_NAME       停止服务"
  echo ""
  echo "   开机自启（一次性配置）："
  echo "     pm2 startup        # 按提示执行返回的 sudo 命令"
  echo "     pm2 save           # 保存当前进程列表"
  echo ""
}

do_proxy_start() {
  ensure_pm2
  log "通过 pm2 启动 $PROXY_SERVICE_NAME（端口 $PROXY_PORT）"
  cd server
  if pm2 describe "$PROXY_SERVICE_NAME" >/dev/null 2>&1; then
    pm2 restart "$PROXY_SERVICE_NAME" --update-env
  else
    NODE_ENV=production PROXY_PORT=$PROXY_PORT pm2 start "node dist/proxy.js" \
      --name "$PROXY_SERVICE_NAME" \
      --time \
      --max-memory-restart 600M \
      --log-date-format "YYYY-MM-DD HH:mm:ss" \
      --merge-logs
  fi
  cd ..
  pm2 save >/dev/null
  echo ""
  log "✅ 教务代理部署完成"
  echo ""
  echo "   健康检查：${B}http://$(hostname -I 2>/dev/null | awk '{print $1}'):$PROXY_PORT/health${N}"
  echo "   本机检查：${B}curl http://127.0.0.1:$PROXY_PORT/health${N}"
  echo ""
  echo "   主服务需配置："
  echo "     JWXT_PROXY_URL=http://代理或frp地址:$PROXY_PORT"
  echo "     JWXT_PROXY_AUTH=代理端 server/.env 里的 PROXY_AUTH"
  echo ""
}

do_stop()    { ensure_pm2; pm2 stop "$SERVICE_NAME"; }
do_restart() { ensure_pm2; pm2 restart "$SERVICE_NAME" --update-env; }
do_logs()    { ensure_pm2; pm2 logs "$SERVICE_NAME"; }
do_status()  { ensure_pm2; pm2 status; }

do_proxy_stop()    { ensure_pm2; pm2 stop "$PROXY_SERVICE_NAME"; }
do_proxy_restart() { ensure_pm2; pm2 restart "$PROXY_SERVICE_NAME" --update-env; }
do_proxy_logs()    { ensure_pm2; pm2 logs "$PROXY_SERVICE_NAME"; }

do_update() {
  if [ -d .git ]; then
    log "拉取最新代码"
    git pull --ff-only || warn "git pull 失败，继续部署当前代码"
  else
    warn "非 git 仓库，跳过 git pull"
  fi
  do_install
  do_db_init   # 自动应用新 migration（不会动既有数据）
  do_build
  do_restart || do_start
}

do_proxy_update() {
  if [ -d .git ]; then
    log "拉取最新代码"
    git pull --ff-only || warn "git pull 失败，继续部署当前代码"
  else
    warn "非 git 仓库，跳过 git pull"
  fi
  ensure_proxy_env
  do_install
  do_build_proxy
  do_proxy_restart || do_proxy_start
}

# ---------- 主入口 ----------
CMD="${1:-init}"
case "$CMD" in
  init|"")
    log "=== 首次部署模式 ==="
    ensure_node
    ensure_ffmpeg
    ensure_env
    if ! runtime_uses_postgres; then
      do_postgres_init
    fi
    if ! runtime_uses_redis; then
      do_redis_init
    fi
    do_install
    do_db_init
    do_build
    do_start
    ;;
  update)
    log "=== 更新部署 ==="
    ensure_node
    ensure_ffmpeg
    ensure_env
    runtime_uses_postgres || err "当前部署脚本已切换为 PostgreSQL-only。请先运行 ./deploy.sh postgres-init 或 ./deploy.sh postgres-config"
    do_update
    ;;
  proxy-init)
    log "=== 教务代理首次部署模式 ==="
    ensure_node
    ensure_proxy_env
    do_install
    do_build_proxy
    do_proxy_start
    ;;
  proxy-update)
    log "=== 教务代理更新部署 ==="
    ensure_node
    do_proxy_update
    ;;
  postgres-init)
    log "=== 安装并初始化 PostgreSQL ==="
    do_postgres_init
    ;;
  postgres-config)
    log "=== 配置 PostgreSQL 目标连接串 ==="
    do_postgres_config
    ;;
  redis-init)
    log "=== 安装并初始化 Redis ==="
    do_redis_init
    ;;
  redis-config)
    log "=== 配置 Redis 目标连接串 ==="
    do_redis_config
    ;;
  start)        do_start ;;
  stop)         do_stop ;;
  restart)      do_restart ;;
  logs)         do_logs ;;
  status)       do_status ;;
  proxy-start)   do_proxy_start ;;
  proxy-stop)    do_proxy_stop ;;
  proxy-restart) do_proxy_restart ;;
  proxy-logs)    do_proxy_logs ;;
  reset-db)     do_db_reset && do_restart ;;
  help|-h|--help)
    sed -n '2,20p' "$0"
    ;;
  *)
    err "未知命令: $CMD（运行 ./deploy.sh help 查看用法）"
    ;;
esac
