# 教务 Agent 独立网关

网站后端的蓝绿进程不再持有 Agent WebSocket。常驻的 `cpu-jwxt-gateway` 持有两台 Agent 的连接、并发计数和加密身份；新旧网站后端通过带独立密钥的 loopback RPC 使用同一份状态。请求不自动重试，避免重复登录或写入。

普通网站部署不更新、不重启网关。网关自身升级必须单独安排，不能把它加入网站进程的 PM2 删除、内存阈值重启或清理列表。其源码目录和 `server/runtime` 必须保留。独立进程仍可能发生主机或网络故障，本改动解决的是网站发布引起的连接归属分裂。

## 首次迁移

旧版运行进程没有 RPC，已建立的 WebSocket 不能搬到另一个进程。仅改 nginx 不会迁移现有连接；直接停旧进程会中断请求。不得以强杀连接或临时缩小 requiredAgents 基线来通过发布门禁。

1. 等待精确 SHA 的 GitHub Linux 制品成功，按正常清单校验下载制品。设置 `CPU_WEB_DEPLOY_ROOT`、`DEPLOY_TARGET_COMMIT`、`DEPLOY_ARTIFACT_DIR`，运行 `node ops/deploy/prepare-agent-gateway.mjs`。默认 loopback 端口 23633，可用 `DEPLOY_AGENT_GATEWAY_PORT` 指定。此命令只准备常驻网关，不改 nginx，不重启已有网站或 Agent。再次执行遇到已有网关会停止。
2. 保存原 nginx 文件、原发布状态和两台 Agent 的在线/身份基线。完成迁移方案审核前，不改生产 Agent 路由。首次迁移包含连接重建，必须明确其对正在登录请求的影响；准备网关不代表迁移完成。
3. 完成迁移后，所有承载 Agent 域名的 server 块中应有以下精确路径规则。保留现有 TLS、来源地址和超时设置；新规则不能嵌套进其他 location。先 `nginx -t` 再 reload，保留旧 worker 和旧网站进程。

```nginx
location = /api/internal/jwxt-agent/connect {
    proxy_pass http://127.0.0.1:23633;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection upgrade;
    proxy_set_header Host $host;
    proxy_read_timeout 86400s;
}
```

4. 在 `.deploy/blue-green/agent-gateway.json` 保存实际端口、路径、所有包含上述规则的绝对文件路径及原有 Agent ID 基线。密钥由准备命令写入同目录的 `agent-gateway.secret`（0600），不得写进 git、nginx、公网页面或日志。

```json
{
  "port": 23633,
  "agentPath": "/api/internal/jwxt-agent/connect",
  "nginxConfigs": ["/actual/site/proxy.conf"],
  "requiredAgents": ["CPU-Sever-01", "CPU-Sever-02"]
}
```

5. 两台 Agent 在网关全部 ready、身份公钥存在后，才运行常规 `deploy.sh update`。部署在启动候选前、切换前、切换验证和退休旧进程前校验网关实例和基线；缺失、离线或变更会停止切换。网站后端的 `/api/ready` 也检查网关可达性。

## 发布排空

使用常驻网关的候选版本直接使用同一网关处理 API，不再把业务 HTTP 转回旧版本。nginx 旧 worker 可以因网关长连接继续存在；只在旧网站 upstream 连续 5 秒没有 established 连接后退休旧网站进程。旧网站仍有流式请求或其他 WebSocket 时继续保留；超时仍报告部署未完成。旧版未迁移的排空恢复保留原规则。

验证覆盖两个网站实例共享真实 Agent 连接、旧网站退出后登录继续、RPC 鉴权/失败不重试/状态失效、迁移基线门禁，以及 Ubuntu CI 的真实 nginx reload 与 Agent 长连接保持。
