# CPU-web

药大拾间是一个面向中国药科大学学生的校园信息聚合站点。当前仓库已经不是单纯的 Web MVP，而是一个完整的多端项目，包含：

- `web/`：Vue 3 前端站点与 `/schedule` PWA 课表页
- `server/`：Express + Prisma + PostgreSQL 后端
- `voicehub/`：药苑之声 Nuxt 全栈子应用（完整保留 VoiceHub 点歌系统）
- `android/`：Android WebView 壳与桌面课表小组件
- `harmony/`：HarmonyOS WebView 壳与 JS Bridge
- `desktop/`：Windows / macOS 桌面端（Electron，OAuth2 登录 + 受控学习平台窗口）

仓库地址：[https://github.com/sx120609/CPU-web](https://github.com/sx120609/CPU-web)

> 说明
>
> - 本项目为学生自发聚合站，非中国药科大学官方平台。
> - 学校统一认证只用于用户授权后的教务数据获取；项目不保存学校密码和验证码。
> - 商城订单、议价、交付、退款申请与结算状态由本站记录；在线收款通过管理员配置的易支付网关完成。

## 当前能力

### 访问边界

| 模块 | 典型路径 | 访问要求 | 说明 |
|---|---|---|---|
| 首页 / 搜索 / 公告 | `/home` `/search` `/announcements` | 公开 | 展示站内聚合内容与公告源 |
| 论坛入口 / 板块 / 帖子 | `/forum` `/forum/b/:slug` `/forum/topic/:id` | 公开或受社区权限控制 | 公开入口可访问，具体社区内容仍会受服务端权限与功能开关拦截 |
| 热榜 / 最新 / 校园商城 / 课程点评 | `/forum/hot` `/forum/latest` `/market` `/coursereview` | 商城交易需登录并通过学校统一认证 | 受 `forum` / `market` / `coursereview` 功能开关与社区权限控制 |
| 发帖 / 编辑 / 回复 / 点赞 / 消息 | `/post` `/post/:id/edit` `/messages` | 站内登录 | 帖子正文支持 Markdown、匿名、图片上传与审核 |
| 教务页壳 | `/jwxt` `/schedule` | 页面可公开访问 | 真正拉取课表、成绩、考试等数据时需要学校 SSO 授权得到 `jwxtToken` |
| 校园服务导航 | `/services` | 公开 | 聚合校内外常用入口与说明 |
| 校园小工具入口 | `/services/tools` `/services/tools/:slug` | 公开 | 具体工具是否要求登录由工具配置决定 |
| 药苑之声 | `/voicehub/` | 排期与歌曲公开，投稿/投票/后台需登录 | 复用本站会话，无需在 VoiceHub 二次注册或登录 |
| 问卷填写 / 文件提交 | `/services/tools/questionnaires/:slug` `/services/tools/filestore/submit/:slug` | 通常公开 | 支持按工具设置切换是否要求登录 |
| 成绩核对查询 | `/services/tools/grade-checks/:slug` | 默认需登录 | 登录后只看自己的学号记录 |
| 个人中心 / 赞助 / QQBot 绑定 | `/profile` `/u/:id` `/sponsor-wall` | 部分公开、部分登录 | 鸣谢墙公开；个人资料、赞助订单、QQBot 绑定需登录 |
| 管理后台 | `/admin` | `mod` / `admin` | 含用户、板块、站务、AI 审核、支付、QQBot、数据库等后台 |

### 功能摘要

- 校园公告聚合：多公告源定时抓取，自动同步到只读公告板块。
- 论坛社区：支持普通讨论、提问、树洞、课程点评、匿名发帖、点赞、消息通知。
- 校园商城：支持实体商品与电子资料、分类检索、收藏、议价、站内沟通、订单支付、交付确认、评价、举报、退款与卖家结算。
- 社区风控：支持文本 AI 审核、图片审核、人工复核、编辑相似度拦截、用户信誉与匿名额度控制。
- 教务系统：支持学校统一认证登录、课表、成绩、期中成绩、考试、培养方案、教务应用聚合。
- 课表增强：支持周/日视图、PWA 离线打开、本地背景定制、客户端云同步编辑、iOS Scriptable / Android 小组件。
- 校园服务：聚合教务、就业、图书馆、心理、信息化等常用入口，并内置宿舍电费查询代理。
- 校园小工具：当前内置药苑之声、需求反馈、在线问卷、成绩表核对、文件收集。
- 药苑之声：完整保留 VoiceHub 的点歌、投票、播出排期、重播申请、评论、通知、歌词播放器和广播站管理后台；原账号系统已替换为本站会话桥接。
- 文件收集：Vue 正式工作台与 Express API 集成在主站，任务、提交、模板与文件记录统一写入 PostgreSQL。
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
| 辅助子系统 | Filestore 文件收集、Android WebView、HarmonyOS ArkUI Web 容器 |
| 药苑之声 | Nuxt 4、Nitro、Drizzle ORM、独立 PostgreSQL、WebSocket 音乐状态同步 |

## 目录结构

```text
CPU-web/
├── android/                 # Android WebView 壳 + 课表桌面小组件
├── harmony/                 # HarmonyOS Stage 工程 + JS Bridge
├── desktop/                 # Electron 桌面端（不参与主站部署链路，单独构建）
├── server/
│   ├── prisma/              # Prisma schema、迁移、种子数据
│   ├── scripts/             # 调试脚本与数据修复脚本
│   └── src/
│       ├── routes/          # auth / forum / jwxt / payments / tools / admin 等接口
│       ├── services/        # 公告抓取、教务、QQBot、赞助、AI 审核、Filestore 等服务
│       ├── middleware/      # 鉴权、参数校验、错误处理
│       └── utils/           # JWT、密码、响应格式、客户端识别等工具
├── voicehub/                # 药苑之声：原 VoiceHub 全量源码 + CPU-web 用户桥接
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
├── deploy-agent.ps1         # Windows 出站教务 Agent 部署脚本
├── deploy-agent.cmd         # Windows 命令行入口（自动绕过脚本执行策略）
├── package.json             # 根目录脚本入口
└── README.md
```

## 快速开始

### 环境要求

- Node.js `>= 18`
- npm `>= 9`
- PostgreSQL `>= 14`
- 建议本地和生产统一使用 Node 22+；部署脚本会按 Node 22 处理

### 1. 安装依赖

```bash
npm install
```

根目录 `postinstall` 会自动安装 `server/`、`web/` 和 `voicehub/` 的依赖；如需手动执行：

```bash
npm run install:all
```

### 2. 创建后端环境变量

复制示例配置并按部署环境修改：

```bash
cp server/.env.example server/.env
```

核心配置示例：

```env
PORT=3000
NODE_ENV=development
DATABASE_URL="postgresql://user:password@127.0.0.1:5432/cpu_web?schema=public"
VOICEHUB_DATABASE_URL="postgresql://user:password@127.0.0.1:5432/cpu_web_voicehub"
VOICEHUB_ORIGIN="http://127.0.0.1:3001"
VOICEHUB_PORT=3001
JWT_SECRET="please-change-this-in-production"
JWT_EXPIRES_IN="7d"

JWXT_PROXY_URL=""
JWXT_PROXY_AUTH=""
# 首次保存“管理后台 -> 教务节点”后，节点配置改由数据库接管
# SSO_LOGIN_LOCAL_ENABLED=false
SSO_LOGIN_LOCAL_WEIGHT=1
SSO_LOGIN_TIMEOUT_MS=15000
PROXY_AUTH=""
PROXY_PORT=23334

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
- 在 `VOICEHUB_DATABASE_URL` 指向的独立数据库中执行 VoiceHub 原始 Drizzle 迁移

`VOICEHUB_DATABASE_URL` 不能和 `DATABASE_URL` 指向同一个数据库。VoiceHub 保留了自己的业务表；用户进入药苑之声时，服务端会用 CPU-web 的 HttpOnly 会话确认身份，再在独立库中自动建立/更新不可登录的映射资料。原 VoiceHub 注册、密码登录和 OAuth 接口已停用。

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
- 药苑之声：<http://localhost:5173/voicehub/>（Nuxt 本机端口为 `3001`）
- 健康检查：<http://localhost:3000/api/health>
- Filestore 工作台：<http://localhost:5173/services/tools/filestore>

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

补充说明：

- `school-bot` 为种子机器人账号，不用于手动登录。
- 生产环境默认关闭公开注册；`/api/auth/register` 仅在开发模式开放。
- 学校统一认证登录走 `/api/auth/sso-begin` 与 `/api/auth/sso-login`。

## Electron OAuth2 接口

主站为 Electron 等公开客户端提供 Authorization Code + PKCE（S256）认证流程。Electron 不需要保存 `client_secret`，应使用系统浏览器打开授权地址，并使用本机回调地址接收授权结果。

### 配置

OAuth 客户端配置位于服务端环境变量：

```env
OAUTH_CLIENT_ID=cpu-electron
OAUTH_ALLOWED_REDIRECT_URIS=http://127.0.0.1,http://localhost
```

`OAUTH_ALLOWED_REDIRECT_URIS` 使用逗号分隔。对于 `http://127.0.0.1` 和 `http://localhost`，服务端允许 Electron 使用随机本机端口，例如 `http://127.0.0.1:43127/callback`。其他地址应配置完整且固定的 origin，生产环境应只配置实际需要的回调 origin。

AI 接口复用站点设置中的 `ai.review.apiUrl`、`ai.review.apiKey` 和 `ai.review.model`，不新增单独的 OAuth AI 密钥配置。AI API 密钥始终只保存在服务端，不能下发给 Electron。

### 授权流程

1. Electron 使用密码学安全随机数生成 `state` 和 `code_verifier`。
2. 使用 SHA-256 和 Base64URL 编码生成 `code_challenge`。
3. 通过系统浏览器打开 `/api/oauth/authorize`。
4. 用户在主站完成登录后，服务端将 `code` 和原始 `state` 重定向到 Electron 回调地址。
5. Electron 校验 `state`，然后调用 `/api/oauth/token` 并提交 `code_verifier`。
6. 服务端返回 OAuth2 access token，Electron 使用 `Authorization: Bearer <access_token>` 调用其他接口。

授权码有效期为 60 秒且只能使用一次。access token 当前有效期为 30 天。Electron 应使用系统安全存储，例如 Electron `safeStorage`，不要将 token 写入渲染进程的 `localStorage`。

### `GET /api/oauth/authorize`

授权端点要求用户已经登录。请求参数：

| 参数 | 必填 | 说明 |
|---|---|---|
| `response_type` | 是 | 固定为 `code` |
| `client_id` | 是 | 默认 `cpu-electron` |
| `redirect_uri` | 是 | 已配置的回调 origin 下的地址 |
| `scope` | 是 | 空格分隔，支持 `openid profile ai` |
| `state` | 是 | Electron 生成的随机状态值 |
| `code_challenge` | 是 | PKCE S256 challenge |
| `code_challenge_method` | 是 | 固定为 `S256` |

示例：

```text
GET /api/oauth/authorize?response_type=code&client_id=cpu-electron&redirect_uri=http%3A%2F%2F127.0.0.1%3A43127%2Fcallback&scope=openid%20profile%20ai&state=...&code_challenge=...&code_challenge_method=S256
```

授权成功后回调：

```text
http://127.0.0.1:43127/callback?code=...&state=...
```

失败时回调会携带 `error` 和 `state` 参数。Electron 必须先校验 `state`，再处理 `code`。

### `POST /api/oauth/token`

使用 `application/x-www-form-urlencoded` 或 JSON 提交：

```json
{
  "grant_type": "authorization_code",
  "code": "授权回调中的 code",
  "redirect_uri": "http://127.0.0.1:43127/callback",
  "client_id": "cpu-electron",
  "code_verifier": "发起授权时生成的原始 verifier"
}
```

成功响应遵循 OAuth2 标准格式，不使用站内通用响应包装：

```json
{
  "access_token": "...",
  "token_type": "Bearer",
  "expires_in": 2592000,
  "scope": "openid profile ai"
}
```

### `GET /api/oauth/userinfo`

请求头：

```http
Authorization: Bearer <access_token>
```

需要 `profile` scope。返回用户基础信息、用户等级、AI 每日额度、今日已用次数和剩余次数。`aiBalance` 表示当前自然日剩余的校园 AI 请求次数，不是金额余额，也不是 Token 余额。

### `POST /api/oauth/revoke`

Electron 可以主动撤销 access token：

```json
{
  "token": "需要撤销的 access_token",
  "client_id": "cpu-electron"
}
```

接口始终返回 HTTP 200，避免通过响应差异泄露 token 是否存在。撤销后的 token 不能继续调用 OAuth 接口。

### `POST /api/oauth/v1/responses`

这是面向外部客户端新增的 OpenAI Responses 兼容代理接口，不是 `/api/search/assistant` 的直接复用。它复用站点 AI 上游配置和校园 AI 每日额度系统，但只接受 `user` 和 `assistant` 输入，不允许客户端提交 `system`、`developer` 或未知扩展字段；服务端仍会执行敏感话题拦截。

当站点 AI URL 配置为 `/v1/responses` 时，服务端使用 Responses API 的 `input` 格式；配置为 `/v1/chat/completions` 时，会将 Responses 请求转换为 Chat Completions 的 `messages` 格式。服务端始终使用后台配置的模型和 API Key，并检查 `ai.review.enabled`。

流式与非流式调用都会按 OAuth 客户端和服务端模型生成稳定的 `prompt_cache_key`，并在上游支持时请求 24 小时提示缓存保留。若兼容上游拒绝缓存保留参数或缓存键，服务端会自动降级并重试；接入本代理的聊天与后续 AI 解答功能无需在客户端保存或传递上游缓存参数。

请求头：

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

请求体接受常用 Responses 字段，仅支持非流式请求，`stream` 只能为 `false` 或省略：

```json
{
  "model": "客户端可传入，但服务端始终使用站点配置中的模型",
  "input": [
    {
      "role": "user",
      "content": [
        { "type": "input_text", "text": "请描述这张图片" },
        {
          "type": "input_image",
          "image_url": "data:image/png;base64,...",
          "detail": "auto"
        }
      ]
    }
  ],
  "temperature": 0.7,
  "stream": false
}
```

纯文本也支持简写形式：`"content": "你好"`，服务端会在发送到 Responses API 前自动转换为 `input_text` 内容项。图片支持 `data:image/jpeg|png|webp|gif;base64,...`、`http://` 和 `https://` URL；HTTP URL 会在转发前自动规范化编码。

需要 `ai` scope。每次请求最多消耗 1 次当日额度，当前按请求次数计费，不按 Token 数量、字符数或响应长度计费：

- 参数校验失败、令牌无效、scope 不足或额度不足：不扣额度。
- 请求已扣额度后，上游 AI 返回失败或网络异常：退还本次额度。
- 上游 AI 返回成功：保留本次扣减。
- `stream: true` 不受支持。

非流式成功响应使用 Responses 格式，并只保留模型文本：

```json
{
  "output_text": "回答内容",
  "output": [
    {
      "type": "message",
      "role": "assistant",
      "content": [
        { "type": "output_text", "text": "回答内容", "annotations": [] }
      ]
    }
  ]
}
```

每日额度由站点设置中的 `assistant.dailyQuotas` 根据用户等级决定。上游失败状态码和错误内容会转发给 Electron；成功响应会裁剪为上述格式，服务端不会把上游 API Key 返回给客户端。

### Scope

| Scope | 权限 |
|---|---|
| `openid` | 表示使用本站 OAuth2 身份 |
| `profile` | 调用 `/api/oauth/userinfo` 获取用户等级、额度等信息 |
| `ai` | 调用 `/api/oauth/v1/responses` |

建议 Electron 默认申请 `openid profile ai`，并在本地明确保存授权 scope。

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
| `JWT_SECRET` | `cpu-web-dev-secret` | 站内 JWT 签名密钥；生产环境强制至少 32 位，部署脚本会自动生成 |
| `JWT_EXPIRES_IN` | `7d` | 站内登录 token 有效期 |
| `MARKET_ENCRYPTION_SECRET` | 从 `JWT_SECRET` 派生 | 商城收款资料与电子交付内容的 AES-256-GCM 密钥；生产环境应单独设置、持久保存并谨慎轮换 |
| `BROWSER_SESSION_IDLE_MS` | `1800000` | 未勾选“保持登录”时的服务端会话空闲期，默认 30 分钟 |
| `BROWSER_SESSION_ABSOLUTE_MS` | `31536000000` | 勾选“保持登录”时的滑动有效期，默认 365 天；活跃使用会自动续期 |
| `JWXT_SESSION_IDLE_MS` | `31536000000` | 加密教务会话与跨 Agent 密文副本的空闲有效期，默认 365 天 |
| `CORS_ALLOWED_ORIGINS` | 空 | 额外允许的同源 Web 地址，逗号分隔；不要填写通配符 `*` |
| `DORM_ELECTRIC_CAMPUS_BASE` | `http://10.200.13.18:8899` | 仅 Agent 使用的校内宿舍电费接口地址；主服务不读取 |
| `JWXT_PROXY_URL` | 空 | 配置后主服务通过教务代理访问教务/CMS |
| `JWXT_PROXY_AUTH` | 空 | 主服务访问代理时使用的共享密钥 |
| `JWXT_PROXY_TIMEOUT_MS` | `15000` | 主服务调用代理的超时（毫秒） |
| `JWXT_AGENTS` | 空 | 首次启动用的 Agent JSON 配置；后台保存后由数据库配置接管 |
| `JWXT_CRAWL_AGENT_ID` | 空 | 初始公告抓取 Agent；公告抓取不参与负载均衡 |
| `JWXT_AGENT_PATH` | `/api/internal/jwxt-agent/connect` | Agent 主动连接主服务的 WebSocket 路由 |
| `JWXT_AGENT_SERVER` | 空 | Agent 节点连接的主服务 `ws(s)` 地址 |
| `JWXT_AGENT_ID` | 空 | Agent ID，必须与后台一致 |
| `JWXT_AGENT_TOKEN` | 空 | Agent 密钥，必须与后台生成值一致 |
| `JWXT_AGENT_KEY_FILE` | `.jwxt-agent-identity.json` | Agent 的 RSA 加密身份文件；必须持久化并限制为运行账户可读 |
| `JWXT_LOCAL_AGENT_KEY_FILE` | `.jwxt-local-agent-identity.json` | 本机参与教务池时使用的 RSA 加密身份文件 |
| `JWXT_SESSION_SYNC_KEYS` | 空 | 本地敏感会话缓存的轮换密钥环，按“新密钥,旧密钥”排列，每项至少 32 位 |
| `JWXT_SESSION_SYNC_KEY` | 从 `JWT_SECRET` 派生 | 单密钥兼容配置；新部署优先使用 `JWXT_SESSION_SYNC_KEYS` |
| `SSO_LOGIN_NODES` | 空 | 统一认证登录远端节点 JSON 数组；节点字段为 `id`、可选 `name`、`url`、可选 `auth`、`enabled`、`weight` |
| `SSO_LOGIN_LOCAL_ENABLED` | `false` | 兼容环境变量：本机是否参与完整教务服务池（登录与查询绑定） |
| `SSO_LOGIN_LOCAL_WEIGHT` | `1` | 本机教务服务节点权重，范围 `1..100` |
| `SSO_LOGIN_TIMEOUT_MS` | `JWXT_PROXY_TIMEOUT_MS` | 登录池单节点请求超时（毫秒） |
| `PROXY_AUTH` | 空 | 教务代理端校验密钥 |
| `PROXY_PORT` | `23334` | 教务代理监听端口 |
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

## 出站教务 Agent 与负载均衡

推荐使用出站 Agent 替代 FRP。主服务只暴露一个 WebSocket 路由，校内机器主动连接主服务，因此 Agent 机器不需要公网 IP 或入站端口。

```text
浏览器 ──HTTPS──► 主服务
                   ▲
                   │ WSS（Agent 主动发起）
          ┌────────┼────────┐
       校内 Agent A     校内 Agent B     其它 Agent
          │                │
          └──────► 统一认证 / 教务系统
```

在“管理后台 → 教务节点”中完成配置：

- “教务服务”是一项完整能力，统一包含统一认证登录、教务登录、会话建立、课表/成绩等后续查询，以及校内宿舍电费查询，不能分别开关。
- 多台启用“教务服务”的 Agent 与可选的本机组成加权负载均衡池；正常查询粘在创建会话的节点，节点离线、超时或丢失内存会话后，主服务会把加密快照恢复到另一节点。
- 宿舍电费查询不依赖教务会话，会在可用的远程校园 Agent 之间负载均衡并自动换节点重试；主服务保留 30 秒结果缓存，不需要再暴露 FRP HTTP 地址。
- “公告抓取”是独立能力。具有该能力的 Agent 可以有多台，但实际抓取只走后台明确指定的一台，不参与负载均衡；不指定时回退到旧 HTTP 代理或本机。
- Agent 首次部署到支持远程更新的版本后，可在管理后台直接点击对应节点的“远程更新”。节点会先确认指令，再由独立进程拉取代码、构建并重启，完成后自动重连；日志写入 `server/logs/agent-remote-update.log`。
- Agent 成功启动后会自动从 PM2 中注销已被取代的 `cpu-jwxt-proxy`，宿舍电费与教务访问均不再需要该入站代理。
- 管理接口不会返回已有密钥明文。新增或重置密钥时只显示一次，需立即复制到 Agent 机器。

Agent 机器使用与主服务相同版本的 `server` 代码，构建后配置：

```env
JWXT_AGENT_SERVER=wss://your-main-site.example.com/api/internal/jwxt-agent/connect
JWXT_AGENT_ID=campus-a
JWXT_AGENT_TOKEN=后台生成的密钥
JWXT_AGENT_KEY_FILE=.jwxt-agent-identity.json
NODE_ENV=production
REDIS_ENABLED=false
# 校园侧地址不是默认值时才需要设置
DORM_ELECTRIC_CAMPUS_BASE=http://10.200.13.18:8899
```

然后运行：

```bash
./deploy.sh agent-init
# 后续更新
./deploy.sh agent-update
# 查看连接日志
./deploy.sh agent-logs
# 开启、查看或关闭 Linux 开机自启
./deploy.sh agent-autostart
./deploy.sh agent-autostart-status
./deploy.sh agent-autostart-off
```

Windows Agent 使用仓库根目录的脚本：

```powershell
# 首次部署
.\deploy-agent.cmd init
# 后续更新
.\deploy-agent.cmd update
# 查看连接日志
.\deploy-agent.cmd logs -Lines 200
# 查看状态
.\deploy-agent.cmd status
# 开启当前用户登录后的自动启动
.\deploy-agent.cmd autostart
# 查看自动启动状态
.\deploy-agent.cmd autostart-status
# 关闭自动启动
.\deploy-agent.cmd autostart-off
```

Windows 脚本会检查并安装 Node.js 22+ 与 PM2；更新前会停止 Agent，避免运行中的 Prisma DLL 阻止构建，失败时会尝试恢复原进程。执行 `autostart` 后，脚本会为当前 Windows 用户注册登录启动项，并以隐藏窗口启动 Agent，无需管理员权限；启动失败原因会写入 `server\logs\jwxt-agent-autostart.log`。仓库路径变化后重新执行一次 `autostart` 即可更新启动项。

只配置了 `JWXT_AGENT_*` 且没有 `DATABASE_URL` 的 Agent 机器，也可以继续执行 `./deploy.sh update`，脚本会自动识别并切换到 Agent 更新流程。旧部署使用 `proxy-update` 时，如果检测到 `JWXT_AGENT_*`，也会自动迁移到 Agent 流程。

如果主服务前面有 Nginx，需要允许 WebSocket Upgrade：

```nginx
location /api/internal/jwxt-agent/connect {
    proxy_pass http://127.0.0.1:23333;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 90s;
}
```

`JWXT_AGENTS`、`JWXT_CRAWL_AGENT_ID`、`SSO_LOGIN_LOCAL_ENABLED` 和 `SSO_LOGIN_LOCAL_WEIGHT` 仍可用于首次启动。管理后台首次保存后，数据库中的配置成为权威配置。旧 `LOGIN_AGENT_*` 变量、`login-agent` 命令、`JWXT_PROXY_URL` 和 `SSO_LOGIN_NODES` 路径保留用于平滑迁移，但新部署无需 FRP，也无需运行旧 `proxy` 服务。

安全与部署注意：

- 每台 Agent 使用不同的至少 32 位连接密钥并只通过 WSS 传输；Web 登录时，浏览器会用目标 Agent 的 RSA 公钥封装 AES-256-GCM 凭据，远程登录密码不会以明文经过主服务。启用本机教务服务时，主服务本身就是登录节点，因此仍会在该进程内处理密码。
- Agent 首次成功连接时会固定其 RSA-3072 公钥。后续公钥不匹配的连接会被拒绝；合法轮换时应先停止 Agent、备份并移走旧 `JWXT_AGENT_KEY_FILE`，再在后台“解除身份固定”，随后启动 Agent。Linux 部署脚本会设置 `0600`，Windows 脚本会收紧 ACL。
- 活动 CookieJar 由源 Agent 针对每个目标 Agent 分别使用 RSA-OAEP-SHA256 + AES-256-GCM 加密。主服务与 Redis 只保存目标节点可解密的密文，不能读取远程 Agent 的 CookieJar；空闲期由 `JWXT_SESSION_IDLE_MS` 控制，默认 365 天。
- 跨节点仅自动重试课表、成绩、日历等幂等查询，不会重放密码提交。若学校按出口 IP 绑定会话，迁移失败时仍会要求用户重新登录。
- 本科用户只登录一次 `id.cpu.edu.cn` 统一认证；服务端按旧教务“进入选课系统”的真实链路自动向 `jwxt.cpu.edu.cn/jsxsd/sso.jsp` 换取新版会话，不使用新版独立账号密码或验证码登录。最新学期课表固定从新版读取，成绩、考试和培养方案等能力继续复用 `jsxsd.cpu.edu.cn/zgykdx` 旧版会话；三个域的 Cookie 都只保存在加密 CookieJar 中。
- pending 登录、浏览器会话和本机教务会话在写入 Redis/内存缓存前使用 AES-256-GCM 加密。生产环境建议配置 `JWXT_SESSION_SYNC_KEYS=新密钥,旧密钥`；轮换时先把新密钥放到首位，等待超过最长会话有效期后再删除旧密钥。多主服务实例必须共享同一密钥环。
- 加密快照与凭据封装使用 Agent v2 协议，v1 Agent 会被明确拒绝。升级时先安排维护窗口，停止旧 Agent，更新主服务和所有 Agent 后再恢复连接，不能混跑 v1/v2。
- 多个主服务实例必须共享 `JWT_SECRET`。目前 Agent WebSocket 会话属于接收连接的主服务实例，网关层需保证相关教务请求到达同一主实例。

浏览器侧防护：

- 站内与教务 token 只保存在服务端加密会话中；浏览器仅持有 `HttpOnly`、`Secure`、`SameSite=Strict` 的不透明会话 Cookie，旧版 Local Storage token 会在首次迁移后删除。
- 所有 Cookie 认证的写请求必须同时通过同源/允许来源检查和双提交 CSRF 校验；登录入口另有按 IP 与账号散列计数的限流。
- 认证、用户和教务响应均发送 `Cache-Control: no-store`。前端启用强制 CSP、Trusted Types 与 DOMPurify；生产响应同时启用 HSTS、`nosniff`、点击劫持和权限策略防护。
- 浏览器不再保存学校账号密码，旧版保存的凭据和成绩等敏感离线缓存会被清理。课表仍可保留非凭据的离线展示缓存。

## 部署

仓库自带 `deploy.sh`，面向 Debian / Ubuntu：

```bash
chmod +x deploy.sh
./deploy.sh
./deploy.sh update
./deploy.sh update-all
./deploy.sh restart
./deploy.sh logs
./deploy.sh status
# 开启、查看或关闭主服务 Linux 开机自启
./deploy.sh autostart
./deploy.sh autostart-status
./deploy.sh autostart-off
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
# 远程数据库需显式提供第二个独立数据库；本机 PostgreSQL 会自动创建 cpu_web_voicehub
./deploy.sh voicehub-postgres-config "postgresql://user:password@127.0.0.1:5432/cpu_web_voicehub"
./deploy.sh update
```

部署脚本会同时构建并由 PM2 管理 `cpu-web` 与 `cpu-voicehub`。`./deploy.sh autostart` 会为这两个主服务生成独立的 systemd 启动单元；Agent 机器使用 `./deploy.sh agent-autostart`，两套单元互不代替，也不会通过全局 `pm2 resurrect` 拉起无关进程。请用实际运行对应 PM2 进程的同一个 Linux 账号执行自启命令，脚本会在需要写入 systemd 时自动调用 `sudo`。关闭自启不会停止当前正在运行的进程。

`./deploy.sh update` 会根据上次成功部署以来的变更路径，只安装、构建和重启受影响的子项目：只改主站不会重装、迁移、构建或重启药苑之声；只改药苑之声也不会重建主站。部署基线记录在 Git 元数据中，因此即使先手动执行 `git pull`，随后运行 `update` 也不会漏掉尚未部署的改动；首次启用基线记录时会安全地完整更新一次。依赖目录变更才会执行对应项目的 `npm ci`，Prisma 目录变更才会同步主站数据库。需要完整重建时，使用 `./deploy.sh update-all`。主站把 `/voicehub/`（含 WebSocket）反向代理到仅监听 `127.0.0.1:23335` 的 Nuxt/Nitro 进程；可用 `./deploy.sh voicehub-logs` 单独查看日志。

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
- 药苑之声内部端口：`23335`（仅本机）
- Node 版本：按 Node 22+ 处理
- 进程管理：`pm2`

## 多端与子项目说明

- Android 壳说明见 [android/README.md](./android/README.md)
- HarmonyOS 壳说明见 [harmony/README.md](./harmony/README.md)

当前多端能力概览：

- `/schedule` 已配置 PWA，可离线打开最近一次课表缓存。
- Android 壳内置 `CPUAndroid` Bridge，并提供课表桌面小组件。
- Harmony 壳注入 `CPUHarmony` 与 `CPUAndroid` 兼容桥接。
- 后端提供 `/api/site/downloads/android-app`，会自动跳转到 `web/public/downloads/` 中版本号最高的 APK。

## 开发注意事项

- 当前主库仅支持 PostgreSQL；README 与部署脚本都以 PostgreSQL 为准。
- `web/public/sw.js` 当前只重点缓存 `/schedule` 相关静态资源，不是整站离线。
- 论坛、校园商城、课程点评、宿舍电费、赞助等能力都受站点功能开关控制。
- 学校 SSO 的教务 token 与站内 JWT 是两套独立会话。
- 课表编辑上云与部分客户端能力要求 Android / iOS / Harmony 容器环境。
- Windows 下如果 Prisma 的 DLL 被占用，`prisma generate` 或 `server` 构建可能失败；先停止正在运行的 Node 后端进程再试。
- 当前仓库没有统一的根级自动化测试脚本；日常校验主要依赖后端构建、前端类型检查与前端构建。

## 安全与边界

- 项目不代表学校官方立场。
- 教务数据仅在用户授权后读取，不保存学校密码和验证码。
- 用户内容仅代表发布者本人观点；管理后台可对违规内容执行隐藏、锁帖、人工复核等操作。
- 商城会保存订单、支付回调、退款与结算状态；支付网关的资金通道和回调结果仍由对应服务提供方负责，运营方应定期对账并处理争议。

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

商业化应优先围绕低风险、高频刚需能力展开，例如文件收集、问卷报名、通知发布、名单核对、数据导出、资料归档和组织后台。论坛、树洞、校园商城、课程点评、AI 互动等公开内容和社区能力更适合作为可选模块，并配套实名后台、内容审核、举报处理、交易风控、日志留存和管理制度。

开源范围仅限平台代码本身。站点品牌、Logo、域名、生产配置、密钥、用户数据、学校标识、第三方素材、客户数据和客户定制内容不属于开源授权范围。任何商业部署都应根据实际业务形态自行完成 ICP/APP/教育移动应用备案、个人信息保护、内容安全、支付与数据安全等合规评估。

对本项目感兴趣，或希望讨论托管部署、私有化部署、商业授权与定制合作，可联系 <sx120609@gmail.com>。

## License

本项目建议采用 `AGPL-3.0-or-later` 作为代码开源协议；正式发布时请以仓库顶层 `LICENSE` 文件为准。

选择 AGPL 的原因是本项目主要以 Web 服务形式运行。社区可以自由学习、部署、修改和贡献代码；如果修改后的版本通过网络向用户提供服务，也应向相应用户开放对应源码。对于不希望受 AGPL 义务约束的商业客户，可通过单独商业授权获得不同使用条件。

除代码外，站点名称、视觉标识、域名、学校相关标识、用户数据、生产环境配置、密钥、第三方素材和部署数据均不随本协议授权。正式部署前请自行评估合规、隐私、安全和运维风险。
