# CPU-web

药大拾间是面向中国药科大学学生的校园互助与服务聚合站点。项目把校园公告、论坛讨论、课程点评、二手信息、教务数据和常用校园服务整理到一个 Web 入口，重点解决“信息分散、移动端查看不顺手、常用入口难找”的问题。

仓库地址：[https://github.com/sx120609/CPU-web](https://github.com/sx120609/CPU-web)

> 说明：本站为学生自发聚合站，非中国药科大学官方平台。教务数据通过学校统一身份认证授权读取；学号 / 工号会用于创建或关联站内账号，本站不保存学校密码和验证码。校园卡、电费充值等外部业务均跳转学校官方页面，交易与本站无关。

## 功能概览

| 模块 | 路径 | 说明 |
|---|---|---|
| 首页 | `/home` | 汇总热帖、最新公告、校园服务与常用入口 |
| 校园公告 | `/announcements`、`/forum/topic/:id` | 定时同步学校公开公告源，正文展示失败时提供原文入口 |
| 论坛 | `/forum`、`/forum/b/:slug` | 普通讨论、提问、只读公告板块，支持发帖、回复、点赞、置顶、锁帖 |
| 教务数据 | `/jwxt` | 通过统一身份认证授权后查看课表、成绩、考试、培养方案、门户应用等 |
| 课程表 | `/schedule` | 独立全屏课表，支持日 / 周视图、翻周、回到当日 / 本周、离线缓存、添加到桌面和客户端编辑同步 |
| 课程点评 | `/coursereview` | 课程搜索、教师关联、课程评价与评分维度 |
| 二手市场 | `/market` | 二手信息列表和交易字段展示 |
| 校园服务 | `/services` | 融合门户应用、图书馆、就业、心理援助、宿舍电费查询等常用服务入口 |
| 文件收集 | `/services/tools/filestore`、`/filestore` | 嵌入 Filestore 文件收集系统，支持任务创建、提交链接、缺交统计和批量下载 |
| 消息中心 | `/messages` | 回复、全站公告、学校公告订阅设置 |
| 个人中心 | `/profile`、`/u/:id` | 昵称、简介、个人发帖记录 |
| 管理后台 | `/admin` | 用户、帖子、公告源、全站公告、功能开关管理 |

## 当前特性

- 移动端优先的响应式布局，包含底部导航、快捷入口抽屉、触屏按钮和禁用页面缩放相关体验优化。
- 课表支持周 / 日双视图、左右滑动翻周、本地缓存与相邻周预热，并提供 PWA 清单与 Service Worker，可"添加到桌面"独立打开。
- 课表编辑数据会按学期云同步；编辑能力仅限安卓客户端和 iOS 桌面端，网页版只负责查看，不提供编辑入口。
- 站点功能开关支持关闭论坛、二手市场、课程点评、宿舍电费等入口；搜索接口会同步尊重这些开关。
- 学校公告爬虫会同步公开来源，自动处理学校 CMS 页面、微信跳转壳、表格和相对链接。
- 教务授权会在内存中保存短期会话，支持自动授权、退出授权、调试快照和多项教务数据解析。
- 教务接入支持本地直连 / 远端代理两种模式：通过独立的代理服务承担与校内系统的网络出口，主服务无需暴露在校园网内（详见"教务代理"章节）。
- 宿舍电费查询走站内代理；充值入口跳转官方页面，并在跳转前提示校园网、默认密码、交易边界等注意事项。
- 管理端支持用户管理、内容管理、公告源运行、全站公告发布和功能开关。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vue 3、Vite、TypeScript、Element Plus、Vue Router、Pinia、Axios、ECharts |
| 后端 | Node.js、Express、TypeScript、Prisma、SQLite |
| 内容解析 | Cheerio、Turndown、iconv-lite、DOMPurify、marked |
| 鉴权 | JWT、bcryptjs、学校统一认证授权会话 |
| 校验与工具 | Zod、dayjs、tsx、pm2 部署脚本 |

## 目录结构

```text
CPU-web/
├── android/               # Android WebView APK 壳工程，默认打开移动端课表
├── deploy.sh              # Debian / Ubuntu 一键部署与更新脚本（含教务代理）
├── package.json           # 根脚本：安装、开发、构建、数据库初始化
├── server/
│   ├── prisma/            # Prisma schema、迁移与种子数据
│   ├── filestore/         # 嵌入的 Filestore Python 文件收集系统
│   └── src/
│       ├── app.ts         # Express 应用组装
│       ├── index.ts       # 主服务入口（含公告爬虫调度）
│       ├── proxy.ts       # 教务代理入口（独立部署时使用）
│       ├── routes/        # REST API 路由（auth/forum/jwxt/admin 等）
│       ├── services/      # 教务客户端、公告爬虫、电费查询、站点配置等
│       ├── middleware/    # 鉴权、校验、错误处理
│       └── utils/         # 响应、JWT 等工具
└── web/
    ├── public/            # PWA manifest / service worker / 图标
    └── src/
        ├── api/           # 前端 API 封装
        ├── components/    # 通用组件与业务组件（含 install 引导）
        ├── layouts/       # 主布局、导航、页脚
        ├── router/        # 路由与功能开关守卫
        ├── stores/        # Pinia 状态
        ├── styles/        # 全局样式
        ├── utils/         # 凭证加密、Markdown、应用内浏览器探测等
        └── views/         # 页面视图（含独立的 /schedule 全屏课表）
```

## 快速开始

### 环境要求

- Node.js >= 18（建议 20+，生产环境与部署脚本更稳）
- npm >= 9

### 安装依赖

```bash
npm install
```

根目录 `postinstall` 会自动安装 `server/` 和 `web/` 的依赖；也可以直接用 `npm run install:all`。

### 初始化数据库

首次运行前需要准备 `server/.env`：

```env
DATABASE_URL="file:./dev.db"
JWT_SECRET="please-change-this-in-production"
PORT=3000
```

然后执行：

```bash
npm run db:setup
```

如需清空并重建数据库：

```bash
npm run db:reset
```

### 启动开发环境

```bash
npm run dev
```

- 前端：<http://localhost:5173>
- 后端：<http://localhost:3000>
- 健康检查：<http://localhost:3000/api/health>
- 文件收集：<http://localhost:5173/filestore>（默认管理员密码 `admin123`，生产环境请设置 `FILESTORE_ADMIN_PASSWORD`）

Vite 已配置 `/api`、`/uploads` 和 `/filestore` 代理到后端，开发时不需要额外处理跨域。

## 常用脚本

| 命令 | 说明 |
|---|---|
| `npm run install:all` | 安装根目录、后端和前端依赖 |
| `npm run dev` | 同时启动后端和前端开发服务器 |
| `npm run dev:server` | 只启动后端 |
| `npm run dev:web` | 只启动前端 |
| `npm run build` | 构建后端和前端 |
| `npm run typecheck` | 后端构建 + 前端类型检查 |
| `npm run db:setup` | 执行 Prisma migration 并写入种子数据 |
| `npm run db:reset` | 重置数据库并重新写入种子数据 |
| `npm run start` | 启动已构建的后端服务 |
| `npm run proxy --prefix server` | 启动教务代理（生产，需先 build） |
| `npm run proxy:dev --prefix server` | 启动教务代理（开发，热重载） |

## 配置项

后端读取 `server/.env`（参考根目录 `.env.example` 或 `server/.env.example`）：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DATABASE_URL` | 无 | Prisma 数据库地址，开发默认使用 SQLite |
| `JWT_SECRET` | `cpu-web-dev-secret` | JWT 签名密钥，生产环境必须改为强随机值 |
| `JWT_EXPIRES_IN` | `7d` | 站内登录 token 有效期 |
| `PORT` | `3000` | 后端服务端口（`deploy.sh` 部署时默认 `23333`） |
| `NODE_ENV` | `development` | 生产环境应设为 `production` |
| `DORM_ELECTRIC_BASE` | `http://sz.weicheng.wang:8899` | 宿舍电费查询代理地址 |
| `JWXT_PROXY_URL` | 空 | 设置后主服务通过该地址访问教务代理；留空则本地直连 |
| `JWXT_PROXY_AUTH` | 空 | 主服务调用代理时携带的共享密钥，需与代理端 `PROXY_AUTH` 一致 |
| `JWXT_PROXY_TIMEOUT_MS` | `15000` | 主服务调用代理的超时（毫秒） |
| `PROXY_AUTH` | 空 | 代理端校验调用方时使用的共享密钥 |
| `PROXY_PORT` | `23334` | 代理服务监听端口（仅运行代理时生效） |
| `FILESTORE_ENABLED` | `true` | 是否启用嵌入的 Filestore 代理；设为 `false` 可关闭 |
| `FILESTORE_PORT` | `8964` | Filestore Python 服务监听端口，Node 后端会按需启动并反向代理 |
| `FILESTORE_PYTHON` | 自动选择 | Python 可执行文件路径；Windows 默认 `python`，其他系统默认 `python3` |
| `FILESTORE_ADMIN_PASSWORD` | `admin123` | Filestore 初始管理员密码，首次登录后会写入其 SQLite 数据库 |

## 教务代理

教务系统位于校园网内，公网部署的主服务直接访问会受 IP 限制。仓库提供"主服务 + 教务代理"双服务模式：

```text
浏览器 ──HTTPS──► 主服务 (server/src/index.ts)
                       │
                       │ JWXT_PROXY_URL（带 JWXT_PROXY_AUTH）
                       ▼
              校内机器 / frp 隧道
                       │
                       ▼
              教务代理 (server/src/proxy.ts) ──► 教务系统 / 学校 CMS
```

- 不配置 `JWXT_PROXY_URL` 时，主服务退回到本地直连模式，整套行为与单实例部署一致。
- 配置后，主服务不再持有教务 cookie 或拉取学校 CMS 页面；教务登录、课表、成绩查询以及公告爬虫的 HTML 抓取全部走代理。
- 主服务与代理之间通过共享密钥 (`JWXT_PROXY_AUTH` ↔ `PROXY_AUTH`) 鉴权，建议用 `openssl rand -hex 32` 生成。
- 代理端只暴露 JSON 接口，生产建议通过 HTTPS 或 frp 隧道访问，避免对公网开放明文端口。

`deploy.sh` 已经内置代理生命周期管理：

```bash
./deploy.sh proxy-init      # 代理端首次部署
./deploy.sh proxy-update    # 代理端 git pull + 重装 + 重建 + 重启
./deploy.sh proxy-restart   # 重启代理
./deploy.sh proxy-logs      # 查看代理日志
```

## 账号与角色

种子数据会创建普通用户、管理员、机器人账号、课程、服务卡片、板块和公告源。具体账号以 `server/prisma/seed.ts` 为准。

站内登录分两类：

- 普通站内账号：用于开发、管理和非学校身份账号。
- 学校统一认证账号：登录成功后创建或关联站内账号，后续用于发帖、课评、消息和教务授权。

## 部署

仓库提供 `deploy.sh`，面向 Debian / Ubuntu 服务器：

```bash
chmod +x deploy.sh
./deploy.sh          # 首次部署
./deploy.sh update   # 拉取代码、安装依赖、构建并重启
./deploy.sh restart  # 重启服务
./deploy.sh logs     # 查看日志
./deploy.sh status   # 查看状态
./deploy.sh reset-db # 重建数据库（会清空论坛数据，谨慎使用）
```

部署脚本默认使用端口 `23333`，可用环境变量覆盖：

```bash
PORT=12345 ./deploy.sh
```

脚本会自动检查并安装 Node 20+、创建 `server/.env`、初始化数据库、构建前后端，并用 `pm2` 守护后端进程。教务代理部署用 `./deploy.sh proxy-init` 等命令（默认端口 `23334`，可通过 `PROXY_PORT` 覆盖），具体见上文"教务代理"一节。

## PWA / 添加到桌面

`web/public/` 提供 `manifest-v3.webmanifest` 和 `sw.js`，独立课表页 `/schedule` 已经按 PWA 配置：

- `start_url` 设为 `/schedule`，`display: standalone`，添加到桌面后以独立窗口打开。
- 课表页内有"添加到桌面"引导（`InstallPromptDialog.vue`）；检测到微信 / QQ 等应用内浏览器时，会提示先在系统浏览器打开。
- 课表数据走 localStorage 缓存（学期 + 周次为 key，12 小时 TTL），断网情况下也能直接展示上次内容。

## 课表功能说明

- 课表页支持日 / 周切换、回到当日、回到本周、周次选择和左右滑动翻页。
- 课表编辑仅在安卓客户端和 iOS 桌面端开放，网页版默认静默隐藏编辑能力。
- 编辑后的课程会同步到云端，页面内显示为“已编辑课程”；恢复编辑前会二次确认，减少误触。
- 若课程存在单双周或多个来源，编辑和删除会按同一课程组统一处理，避免出现“点一次删不干净”的情况。

## Android APK

`android/` 目录提供一个轻量 WebView 壳，默认打开：

```text
https://cpu.lizmt.cn/schedule
```

这个 APK 主要面向“把课表固定到桌面、快速打开查看”的移动端场景。它不会把教务数据打包进本地，实际数据仍由已部署的 Web 服务读取和缓存。

构建方式：

1. 安装 Android Studio 和 Android SDK Platform 35。
2. 用 Android Studio 打开 `android/` 目录，等待 Gradle 同步。
3. 运行 `app` 模块调试，或在安装 Gradle / 生成 Gradle Wrapper 后执行 `gradle :app:assembleDebug` 生成调试包。
4. 发布前配置自己的 Android 签名证书，再执行 `gradle :app:assembleRelease`。

可通过 Gradle 参数覆盖启动地址：

```bash
gradle :app:assembleRelease -PappUrl=https://cpu.lizmt.cn/schedule
```

## 开发注意事项

- 功能开关由 `server/src/services/siteSettings.ts` 管理；前端入口隐藏和后端搜索过滤需要同时尊重开关。
- 公告详情页顶部统一展示原文入口，爬虫不再向正文写入重复跳转链接。
- 教务授权会话保存在后端内存中，默认 30 分钟无活动失效；浏览器关闭后前端教务 token（存放在 `sessionStorage`）也会清空。
- 课表页（`/schedule` 和 `/jwxt` 内的课表 pane）采用 carousel 设计左右翻周；inner v-for 的 `:key` 必须带上 `weekValue`，否则跨周翻页可能复用相同 DOM 造成"每周都有的课"文字越翻越浓。
- 电费充值只提供官方页面跳转和风险提示，支付、交易和密码修改均不经过本站。
- `server npm run build` 会执行 `prisma generate`；Windows 下如果 Prisma DLL 被正在运行的服务占用，可能需要先停掉后端进程再构建。
- 配置教务代理时确保主服务与代理使用相同的 `JWXT_PROXY_AUTH` / `PROXY_AUTH`，不一致会被代理直接 401。

## 安全与边界

- 本项目不是学校官方系统，不应声称代表学校发布信息。
- 不保存学校密码和验证码；教务授权数据只用于当前会话。
- 用户内容仅代表发布者个人观点，管理端可隐藏、锁定、删除违规内容。
- 外部官方系统的可用性、登录、支付和交易记录由对应官方系统负责。

## License

仅供学习、交流和校园信息聚合实践使用。生产部署前请自行评估合规、隐私、安全和运维风险。
