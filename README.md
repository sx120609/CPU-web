# 中国药科大学学生便捷服务站点 (CPU-web)

面向中国药科大学（China Pharmaceutical University）学生的一站式服务平台 MVP 原型。基于 `D:\OneDrive\Desktop\deep-research-report.md` 调研报告设计，将分散的教务、卡务、后勤、健康、就业等高频服务聚合到一个"按任务组织"的学生前台。

> ⚠️ 本项目是方案可视化与可交互的工程原型。所有教务、卡务、门诊等数据由 SQLite 内的种子数据模拟，**不连接学校真实业务系统**。接口与前台交互按真实链路设计，便于后续切换到真实接口。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vue 3 + Vite + TypeScript + Element Plus + Vue Router + Pinia + Axios + ECharts |
| 后端 | Node 18+ + Express 4 + TypeScript + Prisma + SQLite |
| 鉴权 | JWT（模拟统一身份认证） + bcryptjs |
| 校验 | Zod |

## 目录结构

```
CPU-web/
├── package.json          # 根脚本（dev / build / db:setup）
├── server/               # Express 后端（端口 3000）
│   ├── prisma/           # Prisma schema 与种子数据
│   └── src/              # 路由、中间件、工具
└── web/                  # Vue 3 前端（端口 5173）
    └── src/              # 视图、组件、路由、store、API 封装
```

## 部署到 Debian / Ubuntu 服务器

仓库根目录有一个 `deploy.sh` 一键脚本：

```bash
# 首次部署：装 Node + 装依赖 + 建数据库 + 构建 + 后台启动
chmod +x deploy.sh
./deploy.sh

# 后续更新代码：拉新代码 + 重建 + 平滑重启
./deploy.sh update

# 其他命令
./deploy.sh start | stop | restart | logs | status
./deploy.sh reset-db   # 重建数据库（会清空所有论坛数据）
```

- 端口默认 `23333`（避开 3000 / 8000 / 8080 等常见冲突），可通过环境变量 `PORT=12345 ./deploy.sh` 覆盖
- 进程由 `pm2` 守护，断开 SSH 后继续运行
- 开机自启：跑一次 `pm2 startup`（按提示执行返回的 sudo 命令）+ `pm2 save`
- 日志文件：`~/.pm2/logs/cpu-web-*.log`
- 首次会自动生成 `server/.env`，含随机 JWT_SECRET（请妥善保管）

## 快速开始（开发环境）

### 环境要求

- Node.js ≥ 18 （推荐 LTS 20 或 22）
- npm ≥ 9

### 1. 安装依赖

```bash
npm install
```

根目录的 `postinstall` 会自动同时安装 `server/` 与 `web/` 的依赖。

### 2. 初始化数据库

```bash
npm run db:setup
```

此命令会：

1. 在 `server/prisma/dev.db` 创建 SQLite 数据库
2. 应用 Prisma migration（自动生成 `migrations/` 目录与表）
3. 注入种子数据（账号、课程、卡务、报修、招聘、通知等）

如需重置数据库：

```bash
npm run db:reset
```

### 3. 启动开发服务器

```bash
npm run dev
```

- 前端：<http://localhost:5173>
- 后端：<http://localhost:3000>
- 健康检查：<http://localhost:3000/api/health>

Vite 已配置代理，前端的 `/api/*` 请求会转发到后端，无需关心跨域。

### 测试账号

| 学号 | 密码 | 身份 | 校区 |
|---|---|---|---|
| `20230001` | `123456` | 本科生（药学院·三年级） | 江宁 |
| `20230002` | `123456` | 研究生（中药学院·二年级） | 玄武门 |
| `admin` | `admin123` | 管理员 | — |

## 已实现模块

按报告推荐的 7 大 MVP 场景 + 跨场景能力：

| 模块 | 路径 | 关键能力 |
|---|---|---|
| 登录 | `/login` | 模拟统一身份认证 |
| 首页 | `/home` | 全局搜索、身份卡片、关键待办、九宫格服务、今日校园、通知 |
| 教务学业 | `/academic` | 课表周视图、成绩 |
| 校园卡 | `/card` | 余额、流水、充值、电费购买 |
| 图书馆 | `/library` | 馆藏检索、当前借阅、座位预约 |
| 宿舍后勤 | `/dorm` | 报修提交与进度查看 |
| 健康服务 | `/health` | 门诊预约、心理预约（敏感域脱敏）、医保入口 |
| 校园生活 | `/life` | 校车班次、食堂高峰、快递待取 |
| 就业发展 | `/career` | 药企岗位、投递记录、推荐表入口 |
| 消息中心 | `/messages` | 分级、分类、订阅偏好、静默时段 |
| 我的 | `/profile` | 个人信息、收藏、设置 |

## 设计要点

- **任务导向首页**：先任务、后服务、再资讯，对应报告 4.4 节的首页线框图
- **角色化展示**：按 `role / grade` 决定卡片优先级（新生/在校生/毕业生）
- **敏感域隔离**：心理咨询在列表与首页待办中弱化呈现；详情需二次确认
- **统一消息中心**：分强/普通/弱三级，默认 23:00–07:00 静默
- **服务目录与全局搜索**：50+ 服务条目，搜索结果分栏展示，每项含"所需材料 / 办理时长 / 咨询方式"

## 范围之外（后续阶段）

按报告分期规划，以下能力**不**在 MVP 内：原生 App、企业微信工作台、小程序、AI 助手、真实支付、人脸识别、复杂工作流引擎、多租户、SSR。

## 许可

仅供学习与方案验证使用，未授权用于生产环境。
