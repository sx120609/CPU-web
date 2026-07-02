# CPU-web

药大拾间是一个面向中国药科大学学生的校园信息聚合站点。当前仓库已经不是单纯的 Web MVP，而是一个完整的多端项目，包含：

- `web/`：Vue 3 前端站点与 `/schedule` PWA 课表页
- `server/`：Express + Prisma + PostgreSQL 后端
- `android/`：Android WebView 壳与桌面课表小组件
- `harmony/`：HarmonyOS WebView 壳与 JS Bridge
- `server/filestore/`：嵌入式 Python 文件收集系统

仓库地址：[https://github.com/sx120609/CPU-web](https://github.com/sx120609/CPU-web)

> 说明
>
> - 本项目为学生自发聚合站，非中国药科大学官方平台。
> - 学校统一认证只用于用户授权后的教务数据获取；项目不保存学校密码和验证码。
> - 支付、充值、交易等动作发生在外部系统，本站只负责发起跳转、展示状态和记录结果。

## 当前能力

### 访问边界

| 模块 | 典型路径 | 访问要求 | 说明 |
|---|---|---|---|
| 首页 / 搜索 / 公告 | `/home` `/search` `/announcements` | 公开 | 展示站内聚合内容与公告源 |
| 论坛入口 / 板块 / 帖子 | `/forum` `/forum/b/:slug` `/forum/topic/:id` | 公开或受社区权限控制 | 公开入口可访问，具体社区内容仍会受服务端权限与功能开关拦截 |
| 热榜 / 最新 / 二手 / 课程点评 | `/forum/hot` `/forum/latest` `/market` `/coursereview` | 站内登录 + 社区权限 | 受 `forum` / `market` / `coursereview` 功能开关控制 |
| 发帖 / 编辑 / 回复 / 点赞 / 消息 | `/post` `/post/:id/edit` `/messages` | 站内登录 | 帖子正文支持 Markdown、匿名、图片上传与审核 |
| 教务页壳 | `/jwxt` `/schedule` | 页面可公开访问 | 真正拉取课表、成绩、考试等数据时需要学校 SSO 授权得到 `jwxtToken` |
| 校园服务导航 | `/services` | 公开 | 聚合校内外常用入口与说明 |
| 校园小工具入口 | `/services/tools` `/services/tools/:slug` | 公开 | 具体工具是否要求登录由工具配置决定 |
| 问卷填写 / 文件提交 | `/services/tools/questionnaires/:slug` `/filestore/submit/:slug` | 通常公开 | 支持按工具设置切换是否要求登录 |
| 成绩核对查询 | `/services/tools/grade-checks/:slug` | 默认需登录 | 登录后只看自己的学号记录 |
| 个人中心 / 赞助 / QQBot 绑定 | `/profile` `/u/:id` `/sponsor-wall` | 部分公开、部分登录 | 鸣谢墙公开；个人资料、赞助订单、QQBot 绑定需登录 |
| 管理后台 | `/admin` | `mod` / `admin` | 含用户、板块、站务、AI 审核、支付、QQBot、数据库等后台 |

### 功能摘要

- 校园公告聚合：多公告源定时抓取，自动同步到只读公告板块。
- 论坛社区：支持普通讨论、提问、树洞、二手、课程点评、匿名发帖、点赞、消息通知。
- 社区风控：支持文本 AI 审核、图片审核、人工复核、编辑相似度拦截、用户信誉与匿名额度控制。
- 教务系统：支持学校统一认证登录、课表、成绩、期中成绩、考试、培养方案、教务应用聚合。
- 课表增强：支持周/日视图、PWA 离线打开、本地背景定制、客户端云同步编辑、iOS Scriptable / Android 小组件。
- 校园服务：聚合教务、就业、图书馆、心理、信息化等常用入口，并内置宿舍电费查询代理。
- 校园小工具：当前内置需求反馈、在线问卷、成绩表核对、文件收集。
- 文件收集：`server/filestore/` 只承载静态工作台页面，任务、提交、模板与文件记录统一写入主站 PostgreSQL。
- 支付与赞助：支持易支付配置、赞助下单、订单状态管理、鸣谢墙展示、过期订单自动关闭。
- QQBot：支持绑定 QQ、私聊/群投稿、Webhook 接入、通知派发、审核提醒。
- 多端容器：内置 Android 与 HarmonyOS WebView 壳，便于直接打包课表与站点能力。

## 技术栈

| 层级 | 技术 |
|---|---|
| 前端 | Vue 3、Vite、TypeScript、Vue Router、Pinia、Element Plus、Axios、ECharts |
| 后端 | Node.js、Express、TypeScript、Prisma 5、PostgreSQL |
| 内容处理 | marked、DOMPurify、Cheerio、Turndown、iconv-lite、`@resvg/resvg-js` |
| 文件与表格 | multer、xlsx、viewerjs、html-to-image |
| 鉴权与安全 | JWT、bcryptjs、学校统一认证会话、Zod |
| 辅助子系统 | Filestore 静态工作台、Android WebView、HarmonyOS ArkUI Web 容器 |

## 目录结构

```text
CPU-web/
├── android/                 # Android WebView 壳 + 课表桌面小组件
├── harmony/                 # HarmonyOS Stage 工程 + JS Bridge
├── server/
│   ├── filestore/           # 文件收集静态工作台页面
│   ├── prisma/              # Prisma schema、迁移、种子数据
│   ├── scripts/             # 调试脚本与数据修复脚本
│   └── src/
│       ├── routes/          # auth / forum / jwxt / payments / tools / admin 等接口
│       ├── services/        # 公告抓取、教务、QQBot、赞助、AI 审核、Filestore 等服务
│       ├── middleware/      # 鉴权、参数校验、错误处理
│       └── utils/           # JWT、密码、响应格式、客户端识别等工具
├── web/
│   ├── public/              # PWA manifest、图标、离线缓存脚本、静态资源
│   └── src/
│       ├── api/             # 前端 API 封装
│       ├── components/      # 通用组件、论坛组件、教务组件等
│       ├── data/            # 服务工具元数据
│       ├── layouts/         # 主布局
│       ├── router/          # 路由与守卫
│       ├── stores/          # Pinia 状态
│       ├── styles/          # 全局样式
│       ├── utils/           # 客户端桥接、Markdown、缓存与格式化工具
│       └── views/           # 页面视图
├── deploy.sh                # Debian / Ubuntu 一键部署脚本（主站 + 教务代理）
├── package.json             # 根目录脚本入口
└── README.md
```

## 快速开始

### 环境要求

- Node.js `>= 18`
- npm `>= 9`
- PostgreSQL `>= 14`
- 建议本地和生产统一使用 Node 20+；`deploy.sh` 会按 Node 20 处理

### 1. 安装依赖

```bash
npm install
```

根目录 `postinstall` 会自动安装 `server/` 和 `web/` 的依赖；如需手动执行：

```bash
npm run install:all
```

### 2. 创建后端环境变量

当前仓库没有 `server/.env.example`，请直接新建 `server/.env`：

```env
PORT=3000
NODE_ENV=development
DATABASE_URL="postgresql://user:password@127.0.0.1:5432/cpu_web?schema=public"
JWT_SECRET="please-change-this-in-production"
JWT_EXPIRES_IN="7d"

JWXT_PROXY_URL=""
JWXT_PROXY_AUTH=""
PROXY_AUTH=""
PROXY_PORT=23334

FILESTORE_ENABLED=true
FILESTORE_PORT=8974
FILESTORE_PYTHON=""

MEDIA_STORAGE_PROVIDER="local"
MEDIA_STORAGE_IMAGE_PROVIDER="local"
MEDIA_STORAGE_VIDEO_PROVIDER="local"
MEDIA_STORAGE_REMOTE_PREFIXES="forum"
ONEDRIVE_CN_TENANT_ID=""
ONEDRIVE_CN_CLIENT_ID=""
ONEDRIVE_CN_CLIENT_SECRET=""
ONEDRIVE_CN_DRIVE_ID=""
ONEDRIVE_CN_ROOT_PATH="cpu-web-media"
```

### 3. 初始化数据库

```bash
npm run db:setup
```

该命令会：

- 执行 `prisma db push`
- 写入种子数据

如需清空并重建：

```bash
npm run db:reset
```

### 4. 启动开发环境

```bash
npm run dev
```

默认地址：

- 前端：<http://localhost:5173>
- 后端：<http://localhost:3000>
- 健康检查：<http://localhost:3000/api/health>
- Filestore 嵌入入口：<http://localhost:5173/filestore>

Vite 已代理以下路径到后端：

- `/api`
- `/uploads`
- `/filestore`

### 5. 默认种子账号

| 账号 | 密码 | 说明 |
|---|---|---|
| `alice` | `123456` | 普通测试用户 |
| `bob` | `123456` | 普通测试用户 |
| `carol` | `123456` | 普通测试用户 |
| `admin` | `admin123` | 管理员 |
| Filestore 管理员 | `admin123` | 嵌入式文件收集系统初始密码 |

补充说明：

- `school-bot` 为种子机器人账号，不用于手动登录。
- 生产环境默认关闭公开注册；`/api/auth/register` 仅在开发模式开放。
- 学校统一认证登录走 `/api/auth/sso-begin` 与 `/api/auth/sso-login`。

## 常用脚本

### 根目录

| 命令 | 说明 |
|---|---|
| `npm run install:all` | 安装根目录、后端和前端依赖 |
| `npm run dev` | 同时启动前后端 |
| `npm run dev:server` | 只启动后端 |
| `npm run dev:web` | 只启动前端 |
| `npm run build` | 构建后端与前端 |
| `npm run typecheck` | 后端构建 + 前端类型检查 |
| `npm run db:setup` | 推送 schema 并写入种子数据 |
| `npm run db:reset` | 重建数据库并重新写入种子数据 |
| `npm run start` | 启动构建后的后端服务 |

### `server/`

| 命令 | 说明 |
|---|---|
| `npm run dev --prefix server` | 后端热重载 |
| `npm run build --prefix server` | `prisma generate` + TypeScript 编译 |
| `npm run start --prefix server` | 启动主服务 |
| `npm run proxy:dev --prefix server` | 教务代理开发模式 |
| `npm run proxy --prefix server` | 教务代理生产运行 |
| `npm run db:studio --prefix server` | Prisma Studio |
| `npm run prisma:generate --prefix server` | 手动生成 Prisma Client |
| `npm run forum:recount-stats --prefix server` | 重新统计论坛数据 |

### `web/`

| 命令 | 说明 |
|---|---|
| `npm run dev --prefix web` | 启动前端开发服务器 |
| `npm run build --prefix web` | 前端类型检查 + 生产构建 |
| `npm run preview --prefix web` | 预览构建结果 |
| `npm run type-check --prefix web` | 仅做前端类型检查 |

## 环境变量

后端主要读取 `server/.env`：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3000` | 主服务端口 |
| `NODE_ENV` | `development` | 生产环境请设为 `production` |
| `DATABASE_URL` | 无 | PostgreSQL 连接串 |
| `JWT_SECRET` | `cpu-web-dev-secret` | 站内 JWT 签名密钥 |
| `JWT_EXPIRES_IN` | `7d` | 站内登录 token 有效期 |
| `DORM_ELECTRIC_BASE` | `http://sz.weicheng.wang:8899` | 宿舍电费代理地址 |
| `JWXT_PROXY_URL` | 空 | 配置后主服务通过教务代理访问教务/CMS |
| `JWXT_PROXY_AUTH` | 空 | 主服务访问代理时使用的共享密钥 |
| `JWXT_PROXY_TIMEOUT_MS` | `15000` | 主服务调用代理的超时（毫秒） |
| `PROXY_AUTH` | 空 | 教务代理端校验密钥 |
| `PROXY_PORT` | `23334` | 教务代理监听端口 |
| `FILESTORE_ENABLED` | `true` | 是否启用嵌入式 Filestore |
| `FILESTORE_PORT` | `8974` | Filestore 静态页面服务端口 |
| `FILESTORE_PYTHON` | 自动探测 | 指定 Python 可执行文件 |
| `MEDIA_STORAGE_PROVIDER` | `local` | 媒体资源默认存储后端；可设为 `local` 或 `onedrive-cn`，未单独指定图片/视频时作为回退值 |
| `MEDIA_STORAGE_IMAGE_PROVIDER` | 空 | 图片资源存储后端；可单独设为 `local` 或 `onedrive-cn` |
| `MEDIA_STORAGE_VIDEO_PROVIDER` | 空 | 视频资源存储后端；可单独设为 `local` 或 `onedrive-cn` |
| `MEDIA_STORAGE_REMOTE_PREFIXES` | `forum` | 哪些 `/uploads/...` 前缀走远端存储，逗号分隔 |
| `ONEDRIVE_CN_TENANT_ID` | 空 | 世纪互联版 Microsoft 365 / Entra 租户 ID |
| `ONEDRIVE_CN_CLIENT_ID` | 空 | 世纪互联应用注册的客户端 ID |
| `ONEDRIVE_CN_CLIENT_SECRET` | 空 | 世纪互联应用注册的客户端密钥 |
| `ONEDRIVE_CN_DRIVE_ID` | 空 | SharePoint 文档库或 OneDrive 对应的 Drive ID |
| `ONEDRIVE_CN_ROOT_PATH` | 空 | 远端根目录下的存储子路径，例如 `cpu-web-media` |
| `PG_DUMP_BIN` | `pg_dump` | 后台数据库备份使用的命令路径 |

补充说明：

- AI 文本审核、图片审核、匿名信誉阈值、站点域名等配置现在主要保存在数据库 `site_settings` 中，通过管理后台维护。
- 生产部署时无需额外 Nginx 才能跑起来；构建后的前端静态资源会直接由 Express 提供。
- 世纪互联版 OneDrive / SharePoint 媒体存储现在支持直接在管理后台配置：填写 Azure 应用 ID、密钥、SharePoint 站点地址后，点击“登录授权”完成回调授权，再选择文档库即可。
- 管理后台支持按媒体类型分别切换后端，例如“图片走本地、视频走世纪互联”。切换后会立刻影响后续新上传文件；历史远端文件仍可继续读取，不会因切换而失效。
- 回调地址固定为 `https://你的站点域名/api/storage/onedrive-cn/callback`；如果你在后台配置了“网站域名”，系统会优先用它生成回调地址。
- 推荐在世纪互联环境给该应用授予 Microsoft Graph 委托权限 `offline_access`、`User.Read`、`Files.ReadWrite.All`、`Sites.ReadWrite.All`，并完成管理员同意。
- `MEDIA_STORAGE_PROVIDER`、`MEDIA_STORAGE_IMAGE_PROVIDER`、`MEDIA_STORAGE_VIDEO_PROVIDER` 与 `ONEDRIVE_CN_*` 这些环境变量仍可作为后备方式使用，但新的后台授权流程优先面向管理后台配置。

## 教务代理模式

当主服务不在校内网络时，可以使用“主服务 + 教务代理”双节点模式：

```text
浏览器
  │
  ├── HTTPS ──► 主服务 server/src/index.ts
  │              │
  │              └── JWXT_PROXY_URL + JWXT_PROXY_AUTH
  │
  └────────────► 校内代理 server/src/proxy.ts
                   │
                   └── 教务系统 / 学校 CMS
```

特点：

- 不配置 `JWXT_PROXY_URL` 时，主服务会直接访问教务和公告源。
- 配置后，教务抓取与公告网页抓取都可以走远端代理。
- 主服务与代理通过 `JWXT_PROXY_AUTH` / `PROXY_AUTH` 做共享密钥校验。
- 推荐用 HTTPS、FRP 或其它隧道暴露代理，不建议直接裸露公网 HTTP 端口。

## 部署

仓库自带 `deploy.sh`，面向 Debian / Ubuntu：

```bash
chmod +x deploy.sh
./deploy.sh
./deploy.sh update
./deploy.sh restart
./deploy.sh logs
./deploy.sh status
./deploy.sh reset-db
```

### PostgreSQL 初始化

脚本可以直接帮你创建数据库与账号：

```bash
./deploy.sh postgres-init
./deploy.sh
```

如果你已有现成 PostgreSQL：

```bash
./deploy.sh postgres-config "postgresql://user:password@127.0.0.1:5432/cpu_web?schema=public"
./deploy.sh update
```

### 教务代理部署

```bash
./deploy.sh proxy-init
./deploy.sh proxy-update
./deploy.sh proxy-restart
./deploy.sh proxy-logs
```

部署脚本默认行为：

- 主服务端口：`23333`
- 教务代理端口：`23334`
- Node 版本：按 Node 20+ 处理
- 进程管理：`pm2`

## 多端与子项目说明

- Android 壳说明见 [android/README.md](./android/README.md)
- HarmonyOS 壳说明见 [harmony/README.md](./harmony/README.md)
- Filestore 详细说明见 [server/filestore/README.md](./server/filestore/README.md)

当前多端能力概览：

- `/schedule` 已配置 PWA，可离线打开最近一次课表缓存。
- Android 壳内置 `CPUAndroid` Bridge，并提供课表桌面小组件。
- Harmony 壳注入 `CPUHarmony` 与 `CPUAndroid` 兼容桥接。
- 后端提供 `/api/site/downloads/android-app`，会自动跳转到 `web/public/downloads/` 中版本号最高的 APK。

## 开发注意事项

- 当前主库仅支持 PostgreSQL；README 与部署脚本都以 PostgreSQL 为准。
- `web/public/sw.js` 当前只重点缓存 `/schedule` 相关静态资源，不是整站离线。
- 论坛、二手、课程点评、宿舍电费、赞助等能力都受站点功能开关控制。
- 学校 SSO 的教务 token 与站内 JWT 是两套独立会话。
- 课表编辑上云与部分客户端能力要求 Android / iOS / Harmony 容器环境。
- Windows 下如果 Prisma 的 DLL 被占用，`prisma generate` 或 `server` 构建可能失败；先停止正在运行的 Node 后端进程再试。
- 当前仓库没有统一的根级自动化测试脚本；日常校验主要依赖 `npm run build` 与 `npm run typecheck`，Filestore 另有独立 Python 测试目录。

## 安全与边界

- 项目不代表学校官方立场。
- 教务数据仅在用户授权后读取，不保存学校密码和验证码。
- 用户内容仅代表发布者本人观点；管理后台可对违规内容执行隐藏、锁帖、人工复核等操作。
- 外部系统的交易、支付、对账与结果正确性由对应服务提供方负责。

## 开源与商业化规划

CPU-web 的开源定位不是“出售源码”，而是通过开放核心代码建立信任、接受审计、吸引高校开发者参与，并降低早期试用和传播成本。更适合的长期路径是“开源核心 + 商业服务”：社区版保持可自部署、可二次开发；商业收入来自托管运维、私有化部署、商业授权、定制集成和高级模块。

建议的版本边界：

| 版本 | 面向对象 | 主要内容 |
|---|---|---|
| 社区版 | 学生开发者、非商业团队、开源社区 | 开放核心平台代码，支持自部署、自维护和二次开发 |
| 托管版 | 学生组织、学院、社团、实验室 | 提供服务器、升级、备份、监控、安全加固和技术支持 |
| 私有化版 | 学校部门、机构客户、独立校园社区 | 独立部署、数据隔离、品牌配置、权限配置、迁移和长期维护 |
| 商业授权 | 不希望受开源协议义务约束的机构 | 在单独协议下使用、修改或集成本项目代码 |
| 增值模块 | 有更高管理和合规要求的组织 | 高级数据报表、通知集成、AI 审核、组织工作台、定制流程 |

商业化应优先围绕低风险、高频刚需能力展开，例如文件收集、问卷报名、通知发布、名单核对、数据导出、资料归档和组织后台。论坛、树洞、二手、课程点评、AI 互动等公开内容和社区能力更适合作为可选模块，并配套实名后台、内容审核、举报处理、日志留存和管理制度。

开源范围仅限平台代码本身。站点品牌、Logo、域名、生产配置、密钥、用户数据、学校标识、第三方素材、客户数据和客户定制内容不属于开源授权范围。任何商业部署都应根据实际业务形态自行完成 ICP/APP/教育移动应用备案、个人信息保护、内容安全、支付与数据安全等合规评估。

对本项目感兴趣，或希望讨论托管部署、私有化部署、商业授权与定制合作，可联系 <sx120609@gmail.com>。

## License

本项目建议采用 `AGPL-3.0-or-later` 作为代码开源协议；正式发布时请以仓库顶层 `LICENSE` 文件为准。

选择 AGPL 的原因是本项目主要以 Web 服务形式运行。社区可以自由学习、部署、修改和贡献代码；如果修改后的版本通过网络向用户提供服务，也应向相应用户开放对应源码。对于不希望受 AGPL 义务约束的商业客户，可通过单独商业授权获得不同使用条件。

除代码外，站点名称、视觉标识、域名、学校相关标识、用户数据、生产环境配置、密钥、第三方素材和部署数据均不随本协议授权。正式部署前请自行评估合规、隐私、安全和运维风险。
