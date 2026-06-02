# CPU-web

药大拾间是一个面向中国药科大学学生的校园信息聚合站点。它把校园公告、论坛讨论、课程点评、二手信息、教务数据、问卷 / 成绩核对 / 文件收集等工具，以及宿舍电费等常用入口整合到同一个 Web 站点里，重点解决“信息分散、移动端不好用、常用入口不好找”的问题。

仓库地址：[https://github.com/sx120609/CPU-web](https://github.com/sx120609/CPU-web)

> 说明
>
> - 本项目为学生自发聚合站，非中国药科大学官方平台。
> - 学校统一认证只用于获取用户授权后的教务数据；项目不保存学校密码和验证码。
> - 校园卡、电费充值、赞助支付等交易均在外部系统完成，本站只负责跳转、展示和状态记录。

## 功能地图

### 公开内容

| 模块 | 路径 | 说明 |
|---|---|---|
| 首页 | `/home` | 聚合热帖、最新帖子、校园公告和服务入口 |
| 校园公告 | `/announcements` | 展示学校公开公告源，同步内容支持原文入口 |
| 论坛 | `/forum`、`/forum/b/:slug`、`/forum/topic/:id` | 普通讨论、提问、树洞、二手、课程点评等社区内容 |
| 课程点评 | `/coursereview`、`/coursereview/:id` | 课程检索、评分、教师维度聚合 |
| 二手市场 | `/market` | 二手信息列表与详情展示 |
| 校园服务 | `/services` | 聚合门户应用、宿舍电费、常用校内入口 |
| 鸣谢墙 | `/sponsor-wall` | 公开 / 匿名赞助展示 |

### 需登录功能

| 模块 | 路径 | 说明 |
|---|---|---|
| 发帖 / 编辑 | `/post`、`/post/:id/edit` | 支持正文编辑、匿名、图片上传与审核 |
| 教务数据 | `/jwxt` | 课表、成绩、期中成绩、考试、培养方案、教务门户应用 |
| 独立课表页 | `/schedule` | 全屏课表，支持 PWA、离线缓存、客户端编辑同步 |
| 消息中心 | `/messages` | 回复、点赞、系统 / 站务通知、公告订阅 |
| 个人中心 | `/profile`、`/u/:id` | 个人资料、发帖记录、信誉与匿名、QQBot、赞助记录 |
| 校园小工具 | `/services/tools` | 问卷、成绩核对、文件收集等工具入口 |
| 问卷填写 | `/services/tools/questionnaires/:slug` | 在线填写问卷 |
| 成绩核对 | `/services/tools/grade-checks/:slug` | 只展示本人记录的成绩核对页 |
| 文件收集提交 | `/services/tools/file-collections/:slug` | 面向提交者的文件上传页 |
| Filestore 嵌入页 | `/services/tools/filestore`、`/filestore` | 文件收集系统嵌入与代理入口 |

### 管理与运维

| 模块 | 路径 | 说明 |
|---|---|---|
| 管理后台 | `/admin` | 用户、帖子、板块、同步源、站务公告、支付、赞助、QQBot、AI 审核、功能开关 |
| 分享页 | `/share/topic/:id` | 帖子分享卡片、二维码等公开分享能力 |
| 健康检查 | `/api/health` | 服务存活检查 |

## 当前特性

- 移动端优先，但桌面端保留高信息密度阅读能力；适合操作的列表会走卡片化视图，适合对比的数据仍保留表格。
- 论坛支持匿名积分、AI 文本审核、图片审核、人工复核、置顶、锁帖、点赞、消息通知。
- 教务数据支持学校统一认证、自动授权、会话缓存、本地直连 / 远端代理两种模式。
- 课表支持周 / 日视图、PWA、离线打开、客户端编辑同步。
- 校园公告支持多公告源定时同步、正文解析、微信跳转壳处理、原文回退。
- 校园小工具目前覆盖问卷、成绩核对、文件收集。
- QQBot 支持绑定、私聊 / 群投稿、通知派发、管理群审核提醒。
- 赞助 / 支付支持易支付接入、订单管理、赞助鸣谢墙；待支付订单会在 3 小时后自动关闭。
- 管理后台支持站务公告、QQBot、AI 审核、赞助、支付、功能开关等一体化管理。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vue 3、Vite、TypeScript、Element Plus、Vue Router、Pinia、Axios、ECharts |
| 后端 | Node.js、Express、TypeScript、Prisma 5、PostgreSQL |
| 内容处理 | Cheerio、Turndown、marked、DOMPurify、iconv-lite |
| 鉴权 | JWT、bcryptjs、学校统一认证会话 |
| 工具与运行 | Zod、dayjs、tsx、pm2、嵌入式 Filestore（Python） |

## 目录结构

```text
CPU-web/
├── android/               # Android WebView 壳，默认打开独立课表页
├── deploy.sh              # Debian / Ubuntu 一键部署脚本（主服务 + 教务代理）
├── package.json           # 根脚本：安装、开发、构建、数据库初始化
├── server/
│   ├── prisma/            # Prisma schema、迁移、种子数据
│   ├── filestore/         # 嵌入式 Python 文件收集系统
│   └── src/
│       ├── app.ts         # Express 组装、轮询器挂载
│       ├── index.ts       # 主服务入口
│       ├── proxy.ts       # 教务代理入口
│       ├── routes/        # auth / forum / jwxt / payments / tools / admin 等路由
│       ├── services/      # 公告爬虫、教务、QQBot、赞助、图片审核、Filestore 等服务
│       ├── middleware/    # 鉴权、校验、错误处理
│       └── utils/         # JWT、响应、公共用户格式化等工具
└── web/
    ├── public/            # PWA manifest、图标、静态资源
    └── src/
        ├── api/           # 前端 API 封装
        ├── components/    # 业务组件与通用组件
        ├── layouts/       # 主布局
        ├── router/        # 路由与守卫
        ├── stores/        # Pinia 状态
        ├── styles/        # 全局样式
        ├── utils/         # Markdown、凭据加密、客户端桥接等工具
        └── views/         # 页面视图
```

## 快速开始

### 环境要求

- Node.js `>= 18`，建议直接使用 Node 20+
- npm `>= 9`
- PostgreSQL `>= 14`

### 1. 安装依赖

```bash
npm install
```

根目录 `postinstall` 会自动安装 `server/` 和 `web/` 的依赖；也可以手动执行：

```bash
npm run install:all
```

### 2. 配置后端环境变量

新建 `server/.env`：

```env
PORT=3000
NODE_ENV=development
DATABASE_URL="postgresql://user:password@127.0.0.1:5432/cpu_web?schema=public"
JWT_SECRET="please-change-this-in-production"
JWT_EXPIRES_IN="7d"
```

如果需要其它变量，可参考 `server/.env.example` 和下文“配置项”章节。

### 3. 初始化数据库

```bash
npm run db:setup
```

这会：

- 推送 Prisma schema 到 PostgreSQL
- 写入种子数据

如需清空并重建数据库：

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
- 文件收集：<http://localhost:5173/filestore>

Vite 已代理 `/api`、`/uploads`、`/filestore` 到后端，开发时不需要额外处理跨域。

### 5. 默认种子账号

开发环境常用账号：

| 账号 | 密码 | 说明 |
|---|---|---|
| `alice` | `123456` | 普通测试用户 |
| `bob` | `123456` | 普通测试用户 |
| `carol` | `123456` | 普通测试用户 |
| `admin` | `admin123` | 管理员 |
| Filestore 管理员 | `admin123` | 仅用于嵌入文件收集系统 |

## 常用脚本

### 根目录

| 命令 | 说明 |
|---|---|
| `npm run install:all` | 安装根目录、后端和前端依赖 |
| `npm run dev` | 同时启动前后端 |
| `npm run dev:server` | 只启动后端 |
| `npm run dev:web` | 只启动前端 |
| `npm run build` | 构建后端和前端 |
| `npm run typecheck` | 后端构建 + 前端类型检查 |
| `npm run db:setup` | 推送 schema 并写入种子数据 |
| `npm run db:reset` | 重建数据库并重新写入种子数据 |
| `npm run start` | 启动已构建的后端服务 |

### `server/`

| 命令 | 说明 |
|---|---|
| `npm run dev --prefix server` | 后端热重载 |
| `npm run build --prefix server` | `prisma generate` + TypeScript 编译 |
| `npm run proxy:dev --prefix server` | 教务代理开发模式 |
| `npm run proxy --prefix server` | 教务代理生产运行 |
| `npm run db:studio --prefix server` | 打开 Prisma Studio |

## 配置项

后端主要读取 `server/.env`：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3000` | 主服务端口 |
| `NODE_ENV` | `development` | 生产环境应设为 `production` |
| `DATABASE_URL` | 无 | PostgreSQL 连接串 |
| `JWT_SECRET` | `cpu-web-dev-secret` | JWT 签名密钥，生产必须更换 |
| `JWT_EXPIRES_IN` | `7d` | 站内登录 token 有效期 |
| `DORM_ELECTRIC_BASE` | `http://sz.weicheng.wang:8899` | 宿舍电费代理地址 |
| `JWXT_PROXY_URL` | 空 | 配置后主服务通过教务代理访问校内系统 |
| `JWXT_PROXY_AUTH` | 空 | 主服务调用代理的共享密钥 |
| `JWXT_PROXY_TIMEOUT_MS` | `15000` | 主服务调用代理超时（毫秒） |
| `PROXY_AUTH` | 空 | 教务代理端共享密钥 |
| `PROXY_PORT` | `23334` | 教务代理监听端口 |
| `FILESTORE_ENABLED` | `true` | 是否启用嵌入式 Filestore 代理 |
| `FILESTORE_PORT` | `8974` | Filestore Python 服务端口 |
| `FILESTORE_PYTHON` | 自动选择 | Python 可执行文件路径 |
| `FILESTORE_ADMIN_PASSWORD` | `admin123` | Filestore 初始管理员密码 |

## 教务代理

公网部署时，教务系统和学校 CMS 往往需要校内网络环境。项目支持“主服务 + 教务代理”模式：

```text
浏览器 ──HTTPS──► 主服务 (server/src/index.ts)
                     │
                     │ JWXT_PROXY_URL + JWXT_PROXY_AUTH
                     ▼
               校内机器 / frp / 隧道
                     ▼
               教务代理 (server/src/proxy.ts)
                     ▼
              教务系统 / 学校 CMS
```

特点：

- 不配置 `JWXT_PROXY_URL` 时，主服务会本地直连。
- 配置后，教务登录、成绩、课表、公告网页抓取都走代理。
- 主服务和代理通过 `JWXT_PROXY_AUTH` / `PROXY_AUTH` 做共享密钥鉴权。
- 推荐通过 HTTPS 或隧道暴露代理，不建议直接裸露公网 HTTP 端口。

代理相关命令：

```bash
./deploy.sh proxy-init
./deploy.sh proxy-update
./deploy.sh proxy-restart
./deploy.sh proxy-logs
```

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

如果你使用脚本托管部署，推荐：

```bash
./deploy.sh postgres-init
./deploy.sh
```

如果你已经有现成 PostgreSQL：

```bash
./deploy.sh postgres-config "postgresql://user:password@127.0.0.1:5432/cpu_web?schema=public"
./deploy.sh update
```

脚本默认：

- 主服务端口：`23333`
- 教务代理端口：`23334`
- 进程管理：`pm2`

## PWA / 客户端壳

- `/schedule` 已按 PWA 方式配置，可添加到桌面并离线重开。
- `web/public/sw.js` 会缓存课表页壳和最近使用过的静态资源。
- `android/` 提供 Android WebView 壳，默认打开线上课表页。

## 开发注意事项

- 当前主站数据库已统一切到 PostgreSQL；README 以 PostgreSQL 为准。
- 论坛、二手、课程点评、宿舍电费、赞助等功能都受站点功能开关控制。
- 教务授权会话只保存在后端短期内存里；浏览器关闭后前端 `sessionStorage` 中的教务 token 也会清掉。
- 赞助待支付订单会在创建后 3 小时自动关闭；手动改回 `pending` 会重新计算有效期。
- QQBot 支持私聊 / 群投稿、管理群审核提醒，但群通知只会转发真正需要站务处理的提醒。
- Windows 下如果 Prisma DLL 被正在运行的后端占用，`server npm run build` / `prisma generate` 可能失败；先停掉 `tsx watch` 或 `node dist/index.js` 再执行即可。

## 安全与边界

- 项目不代表学校官方立场。
- 教务数据仅在用户授权后读取，不保存学校密码和验证码。
- 用户内容仅代表发布者本人观点；管理后台可对违规内容执行隐藏、锁帖、驳回等操作。
- 外部系统的登录、支付、交易、对账与数据正确性由对应官方系统负责。

## License

仅供学习、交流和校园信息聚合实践使用。正式部署前请自行评估合规、隐私、安全和运维风险。
