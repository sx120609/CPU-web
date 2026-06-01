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
#   ./deploy.sh reset-db         # 重建数据库（⚠️ 删除所有论坛数据）
#   ./deploy.sh postgres-config "postgresql://..."   # 写入 PostgreSQL 目标连接串并刷新后端环境
#   ./deploy.sh postgres-dry-run [batch]             # 在服务器上试跑 SQLite -> PostgreSQL 迁移
#   ./deploy.sh postgres-migrate [batch]             # 在服务器上正式迁移到 PostgreSQL
#   ./deploy.sh postgres-switch [url]                # 将运行库切到 PostgreSQL，重建并重启服务
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

is_sqlite_url() {
  [[ "$1" == file:* ]]
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

configured_postgres_target_url() {
  local from_file
  from_file="$(env_get POSTGRES_DATABASE_URL)"
  if [ -n "$from_file" ]; then
    printf '%s' "$from_file"
  else
    printf '%s' "${POSTGRES_DATABASE_URL:-}"
  fi
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

postgres_batch_size() {
  local candidate=""
  if [ -n "${CMD_ARG_1:-}" ] && is_postgres_url "$CMD_ARG_1"; then
    candidate="${CMD_ARG_2:-}"
  else
    candidate="${CMD_ARG_1:-}"
  fi
  if [ -n "$candidate" ]; then
    printf '%s' "$candidate"
  else
    printf '%s' "${POSTGRES_MIGRATE_BATCH_SIZE:-2000}"
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

ensure_env() {
  if [ ! -f "$ENV_FILE" ]; then
    log "首次部署，创建 server/.env"
    cat > "$ENV_FILE" <<EOF
PORT=$PORT
DATABASE_URL="file:./dev.db"
POSTGRES_DATABASE_URL=""
JWT_SECRET="$(openssl rand -hex 32 2>/dev/null || echo "please-change-me-$(date +%s)")"
JWT_EXPIRES_IN="7d"
NODE_ENV=production
EOF
    log "已生成随机 JWT_SECRET"
  elif ! grep -q '^POSTGRES_DATABASE_URL=' "$ENV_FILE" 2>/dev/null; then
    echo 'POSTGRES_DATABASE_URL=""' >> "$ENV_FILE"
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
  # 显式 prisma generate（npm install 不会触发 schema 变化的 generate）
  if runtime_uses_postgres; then
    log "检测到运行库为 PostgreSQL，生成 PostgreSQL Prisma Client"
    npm run prisma:generate:postgres --prefix server || err "PostgreSQL Prisma Client 生成失败，请检查 Prisma 环境"
  else
    log "生成 SQLite Prisma Client"
    npm run prisma:generate --prefix server || err "Prisma Client 生成失败，请检查 Prisma 环境"
  fi
}

do_build() {
  if runtime_uses_postgres; then
    log "构建 PostgreSQL 运行时后端"
    npm run build:postgres --prefix server
  else
    log "构建前再次生成 SQLite Prisma Client"
    npm run prisma:generate --prefix server || err "构建前 Prisma Client 生成失败"
    log "构建后端 TypeScript → server/dist"
    npm run build --prefix server
  fi
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
  if runtime_uses_postgres; then
    log "检测到运行库为 PostgreSQL，应用 PostgreSQL schema"
    npm run db:push:postgres --prefix server
    return
  fi
  if [ -f server/prisma/dev.db ]; then
    warn "已存在数据库 server/prisma/dev.db —— 跳过 seed，仅应用待执行的 migration"
    cd server
    if ! npx prisma migrate deploy; then
      warn "migrate deploy 失败（多半是历史遗留：旧 db push / 旧 init migration 与 git 来的 migration 冲突）"
      warn "调用 heal-migrations.js 自动修复 migration 历史 ..."
      node scripts/heal-migrations.js
    fi
    log "migration 完成后再次生成 Prisma Client"
    npm run prisma:generate
    cd ..
  else
    log "首次初始化数据库（migrate + seed）"
    npm run db:setup
    log "首次初始化后再次生成 Prisma Client"
    npm run prisma:generate --prefix server
  fi
}

do_db_reset() {
  if runtime_uses_postgres; then
    err "当前运行库是 PostgreSQL，reset-db 不再安全适用。请改用 PostgreSQL 自己的备份/清库流程。"
  fi
  warn "⚠️  将删除所有论坛数据！5 秒内 Ctrl+C 取消..."
  sleep 5
  rm -f server/prisma/dev.db server/prisma/dev.db-journal
  rm -rf server/prisma/migrations
  npm run db:setup
}

do_postgres_config() {
  ensure_env
  local input_url
  input_url="$(postgres_input_url)"
  if [ -n "$input_url" ]; then
    env_set POSTGRES_DATABASE_URL "$input_url"
    log "已写入 POSTGRES_DATABASE_URL：$(mask_postgres_url "$input_url")"
    maybe_restart_running_service
    return
  fi
  local current
  current="$(configured_postgres_target_url)"
  if [ -n "$current" ]; then
    log "当前 POSTGRES_DATABASE_URL：$(mask_postgres_url "$current")"
  else
    warn "当前尚未配置 POSTGRES_DATABASE_URL"
  fi
  echo ""
  echo "   可执行："
  echo "     ./deploy.sh postgres-config 'postgresql://user:password@127.0.0.1:5432/cpu_web?schema=public'"
  echo "   或者："
  echo "     POSTGRES_DATABASE_URL='postgresql://user:password@127.0.0.1:5432/cpu_web?schema=public' ./deploy.sh postgres-config"
}

do_postgres_dry_run() {
  ensure_node
  ensure_env
  local input_url batch
  input_url="$(postgres_input_url)"
  batch="$(postgres_batch_size)"
  if [ -n "$input_url" ]; then
    env_set POSTGRES_DATABASE_URL "$input_url"
    log "已写入 POSTGRES_DATABASE_URL：$(mask_postgres_url "$input_url")"
  fi
  log "开始 PostgreSQL 迁移 dry-run（batch size: $batch）"
  (cd server && npm run db:migrate:sqlite-to-postgres -- --dry-run --batch-size="$batch")
}

do_postgres_migrate() {
  ensure_node
  ensure_env
  local input_url batch
  input_url="$(postgres_input_url)"
  batch="$(postgres_batch_size)"
  if [ -n "$input_url" ]; then
    env_set POSTGRES_DATABASE_URL "$input_url"
    log "已写入 POSTGRES_DATABASE_URL：$(mask_postgres_url "$input_url")"
  fi
  local target
  target="$(configured_postgres_target_url)"
  [ -n "$target" ] || err "未配置 POSTGRES_DATABASE_URL。先运行 ./deploy.sh postgres-config 'postgresql://...'"
  log "目标 PostgreSQL：$(mask_postgres_url "$target")"
  warn "建议先在后台或命令行完成 SQLite 备份。"
  warn "正式迁移即将开始（batch size: $batch）。"
  (cd server && npm run db:migrate:sqlite-to-postgres -- --batch-size="$batch")
}

do_postgres_switch() {
  ensure_node
  ensure_env
  local target input_url
  input_url="$(postgres_input_url)"
  if [ -n "$input_url" ]; then
    env_set POSTGRES_DATABASE_URL "$input_url"
    log "已写入 POSTGRES_DATABASE_URL：$(mask_postgres_url "$input_url")"
  fi
  target="$(configured_postgres_target_url)"
  [ -n "$target" ] || err "未配置 POSTGRES_DATABASE_URL。先运行 ./deploy.sh postgres-config 'postgresql://...'"
  local current
  current="$(configured_database_url)"
  if is_sqlite_url "$current"; then
    env_set SQLITE_DATABASE_URL_BACKUP "$current"
  fi
  env_set DATABASE_URL "$target"
  log "已将运行库切换为 PostgreSQL：$(mask_postgres_url "$target")"
  do_install
  do_db_init
  do_build
  do_restart || do_start
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
    ensure_env
    do_install
    do_build
    do_db_init
    do_start
    ;;
  update)
    log "=== 更新部署 ==="
    ensure_node
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
  postgres-config)
    log "=== 配置 PostgreSQL 目标连接串 ==="
    do_postgres_config
    ;;
  postgres-dry-run)
    log "=== PostgreSQL 迁移 dry-run ==="
    do_postgres_dry_run
    ;;
  postgres-migrate)
    log "=== PostgreSQL 正式迁移 ==="
    do_postgres_migrate
    ;;
  postgres-switch)
    log "=== 切换运行库到 PostgreSQL ==="
    do_postgres_switch
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
