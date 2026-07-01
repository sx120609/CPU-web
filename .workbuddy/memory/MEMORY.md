# CPU-web 项目长期记忆

## 项目概览
中国药科大学学生便捷服务站点。民间学生论坛 + 学校公告爬虫聚合 + 教务工具。
- 后端：server/ — Express + Prisma + PostgreSQL + JWT + Zod
- 前端：web/ — Vue3 + Element Plus + Vite
- 安卓：android/ — 原生 APK
- 鸿蒙：harmony/ — ArkTS
- 桌面：desktop/ — Electron + Vue3（刷课工具，2026-07 新增）

## 账号体系（重要）
- **站内只有学校 SSO 登录**，用户没有站内密码账号。登录流程两步：
  1. POST /auth/sso-begin → 返回 { pendingId, needCaptcha, captchaImage(base64) }
  2. POST /auth/sso-login → 提交 { pendingId, username(学号), password, captcha? } → 返回 { siteToken(JWT), jwxtToken, user }
- SSO 登的是学校教务系统(id.cpu.edu.cn)，拿 JWT。学习通(超星)是独立平台需单独登录
- JWT 中间件：authRequired（src/middleware/auth.ts），req.user 注入 { userId, studentId, role }
- 响应规范：{ code:0, data, message:'' }，错误用 Errors 工具（src/utils/response.ts）

## 刷课工具模块（2026-07-02 新增）
- 定位：学习通/知到视频自动播放，针对水课通识课。视频免费 / AI答题计费
- 后端：/course-bot 路由组（quota/heartbeat/ai-answer），CourseBotQuota + CourseBotUsageLog 表
- 客户端：desktop/，Electron + Vue3，SSO登录 + 内嵌学习通窗口 + executeJavaScript注入驱动视频
- 配置注意：desktop 开发用 vite(5174) + tsx watch electron/main.ts；生产用 electron-builder

## 环境配置注意
- server/.env 的 DATABASE_URL 曾被改成本地 SQLite(file:./dev.db)，但 schema 是 postgresql。正确格式见 .env.example
- prisma generate 会写 AppData，sandbox 下可能被拦，需用户本地跑

## 线上部署
- 后端地址：https://cpu.lizmt.cn
- **API 前缀 /api**：所有业务路由挂在 /api 下（app.ts: `app.use("/api", router)`）。前端/桌面端请求必须带 /api 前缀，否则命中 SPA fallback 返回 HTML
- 部署：deploy.sh update（db:migrate 实为 `prisma db push --skip-generate`，改 schema 后直接 update 即建表，无需手写 migration）
- 端口 23333，pm2 管理，服务名 cpu-web
