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
  if [ ! -f server/.env ]; then
    log "首次部署，创建 server/.env"
    cat > server/.env <<EOF
PORT=$PORT
DATABASE_URL="file:./dev.db"
JWT_SECRET="$(openssl rand -hex 32 2>/dev/null || echo "please-change-me-$(date +%s)")"
JWT_EXPIRES_IN="7d"
NODE_ENV=production
EOF
    log "已生成随机 JWT_SECRET"
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
  warn "⚠️  将删除所有论坛数据！5 秒内 Ctrl+C 取消..."
  sleep 5
  rm -f server/prisma/dev.db server/prisma/dev.db-journal
  rm -rf server/prisma/migrations
  npm run db:setup
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
