# 在线更新与蓝绿切换

`bash deploy.sh update` 默认使用蓝绿更新。只接受当前完整 SHA 的 GitHub Linux 制品；不在运行目录安装依赖、覆盖后端代码或执行 `pm2 restart`。推送和 CI 不会自动执行生产部署。

## 正常流程

1. `flock` 串行化更新，拉取代码并验证精确 SHA 制品及各组件 SHA-256。
2. 在 `.deploy/blue-green/releases/<sha>-<attempt>/` 提取源文件和制品，安装独立依赖、生成 Prisma 客户端。上传目录、运行数据、VoiceHub 头像和备份继续共享；不会删除旧版本目录。
3. 将网页资源同步到已配置的存储，保留本地旧哈希资源。先验证入口 JS/CSS 的 HTTP 状态和 Content-Type，再替换入口 HTML。
4. 后端/VoiceHub 有变化时，在备用的本机端口启动新实例。后端必须完成配置加载、数据库检查及已配置 Redis 的可用性检查。`/api/ready` 返回就绪状态及实例完整 SHA。
5. 保存恢复记录和 Nginx 原始配置，检查配置并平滑 reload。通过公网 `/api/ready` 核对新 SHA，并检查实际页面入口及资源。
6. 等待切换前的 Nginx worker 退出。此时旧连接仍由旧版本完成；新实例暂时把业务 HTTP API 转交旧实例，以保留旧实例的连接状态。不会自动重试 POST。
7. 排空后，将新的 API 请求交给新实例，再等转交中的请求完成。删除旧 PM2 进程之后才允许新实例启动后台轮询任务，最后保存 PM2 状态及成功部署 SHA。

**纯前端更新**在完成首次蓝绿接管后只替换入口，不重启后端。后端会按文件身份/修改时间重新读取 HTML 和静态资源清单；回退 HTML 也无需重启。首次接管仍需启动包含这些能力的后端。

## 前提与配置

服务器需要 Node.js 24、PM2、Nginx、Git、tar、npm 和 util-linux 的 `flock`。更新不会在线升级 Node、杀掉 PM2 或安装操作系统依赖。执行用户需要管理现有 PM2 实例、写入所选 Nginx 配置并测试/reload Nginx 的权限。

| 变量 | 默认值/用途 |
| --- | --- |
| `NGINX_SITE_CONFIG` | `/www/server/panel/vhost/nginx/cpu.lizmt.cn.conf` |
| `NGINX_BIN` | `/www/server/nginx/sbin/nginx` |
| `DEPLOY_NGINX_CONFIG` | 可选。指定实际包含主站 `proxy_pass http://127.0.0.1:<当前端口>` 的文件 |
| `DEPLOY_BLUE_PORT` / `DEPLOY_GREEN_PORT` | `PORT + 100` / `PORT + 101`，默认 23433 / 23434 |
| `DEPLOY_VOICE_BLUE_PORT` / `DEPLOY_VOICE_GREEN_PORT` | `PORT + 200` / `PORT + 201`，默认 23533 / 23534 |
| `DEPLOY_VERIFY_URL` | `https://cputime.cn`，用于验证公网切换 |
| `DEPLOY_INTERNAL_ORIGIN` | `https://cputime.cn`，VoiceHub 调用主站的稳定入口，不能指向会退役的实例端口 |
| `DEPLOY_DRAIN_SECONDS` | 每阶段默认等 120 秒；超时保留实例，而非强制关闭连接 |

默认在站点配置和其所在目录下的绝对路径 include 中寻找唯一的主站代理文件。间接 upstream、多个匹配文件、外部配置或不明确的匹配会停止更新，需明确指定 `DEPLOY_NGINX_CONFIG`。检测到配置被其他操作修改时不覆盖。不要同时通过宝塔或另一个工具修改同一代理配置。

Nginx 不能配置非零 `worker_shutdown_timeout` 强制终止旧连接；检测到该设置时更新会停止。保留 Nginx 默认的优雅退出行为。

外部访问及内部调用应使用稳定的 Nginx 入口。旧的 `23333` 是首次接管前的进程端口，不再作为之后的稳定直连地址。若另有服务硬编码了该端口，应先改为稳定入口。新实例只监听 `127.0.0.1`，无需开放备用端口到公网。

更新期间需要同时容纳两个后端（若 VoiceHub 更新则也需要两个 VoiceHub）及隔离依赖。端口占用、依赖准备失败或健康检查失败均不停止旧实例。旧目录不自动清理；确认没有运行实例、恢复记录或资源仍引用旧目录后再安排清理。

## 失败、长连接与恢复

状态保存在 `.deploy/blue-green/state.json`，配置和 HTML 备份在对应 release 目录，权限限制为部署用户可读。

- `active`：实例接管及旧进程回收均完成。
- `preparing` / `switching`：中断在准备或切换期间。再次执行更新会先验证旧实例、检查配置快照并恢复旧路由，然后等候候选实例连接排空。
- `rollback-draining`：已恢复旧路由，但保留候选实例完成可能已收到的请求。
- `recovery-required`：恢复配置失败，例如配置被别人改过。再次更新只在当前配置与已保存的原始/候选配置一致时继续，不会覆盖未知配置。
- `draining`：新页面和入口已切换，但旧连接或转交请求尚未结束。命令以未完成退出，不记录新的成功部署 SHA。再次执行 `update` 会先完成排空和接管，不能直接开始第三个版本。

WebSocket、教务 Agent、流式响应可能长期保持连接。脚本会保留旧实例，**不承诺这些连接必须在 120 秒内完成迁移，也不会为了报告成功强制断开它们**。这些客户端自然重连、旧连接结束后，再次执行更新即可完成回收。排空期间可能暂时仍由旧 API 处理请求，因此新旧前后端接口必须兼容；不能在一次发布中删除旧页面正在调用的接口。

`logs`、`voicehub-logs`、`restart` 会识别当前受管实例。手动 `restart` 是有意重启，不具有在线 `update` 的不中断保证。恢复中的状态会拒绝不明确的运行实例操作。

项目自启动单元在蓝绿接管后使用 `pm2 resurrect` 恢复已保存的实例和独立目录，不再从旧的 `server/dist` 启动另一个主服务。

## 数据库变更

普通更新不会猜测数据库变更是否向后兼容。发现 schema/迁移变化，或执行强制全量更新时，默认先停止，旧服务继续运行。

只有审查过向后兼容的扩展迁移后，才使用：

```bash
DEPLOY_ALLOW_SCHEMA_EXPAND=1 bash deploy.sh update
```

该开关是迁移兼容性的人工确认，不是自动验证证明。删除/重命名字段、收紧约束、重写数据等需要分阶段发布或安排维护窗口。数据库写入不随文件回退自动撤销。

`DEPLOY_UPDATE_MODE=maintenance` 仅保留给尚未接管蓝绿的旧安装，明确允许短暂中断；已有蓝绿状态时拒绝混用旧式运行目录更新。

## 验证范围

GitHub Actions 在 Ubuntu 24.04 / Node.js 24 下运行准备失败、配置冲突、错误 SHA、切换/回退失败、排空超时、前端热更新/回退及请求转交测试，并使用真实 Nginx 持续请求和正在传输的旧响应验证平滑 reload。测试不能代替生产接入验收；第一次生产接管仍需实际核对代理文件、稳定内部入口、资源容量和长连接状态。

此流程消除的是正常部署停止唯一后端造成的空窗，不覆盖 CDN 停服、主机断电、数据库不兼容、外部网络故障等独立故障。
