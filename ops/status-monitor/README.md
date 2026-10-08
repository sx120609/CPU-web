# 药大拾间状态监控

一个独立运行的小服务：定时从外部探测药大拾间的各个入口，记录 90 天可用率，提供公开的状态页，并在中断、恢复和证书临期时发通知。

它要部署在**主站以外的服务器**上，主站整机不可用时状态页和告警才还能工作。只用 Node.js 自带模块，没有任何 npm 依赖，不读写主站的数据库，也不需要主站的任何密钥。

## 探测什么

默认配置（`config.example.json`）包含：

| 检查项 | 探测方式 | 说明 |
| --- | --- | --- |
| 网站首页 | `GET /`，页面里要有 `id="app"` | 主要服务 |
| 页面资源 | 取回首页，再逐个请求它引用的脚本和样式 | 能发现发布后入口文件 404、CDN 不可用、资源被回退成 HTML |
| 接口服务 | `GET /api/health` | 主要服务 |
| 数据服务 | `GET /api/ready`，要求 `data.ready` 为真 | 主要服务；覆盖数据库、缓存和教务网关，同时读取主站当前版本 |
| 论坛 | `GET /api/boards` | 一次真实的数据库读取 |
| 药苑之声 | `GET /voicehub/` | 独立的 Nuxt 服务 |
| QQ 机器人 | `GET /api/ready`，要求 `data.qqbot.connected` 为真 | |
| www.cputime.cn、cpu.lizmt.cn | `GET /api/health` | 其他入口域名 |

每次 HTTPS 探测都会顺带读取证书到期时间，所以探测到的每个域名（包括静态资源域名）都会出现在“证书有效期”里，不用单独配置。

## 判定规则

- 每个检查项默认每 60 秒探测一次，每次都新建连接，各项错开启动。
- 一次探测失败后隔 3 秒重试，两次都失败才记为一次失败。
- 连续 2 次失败（约 2 分钟）判定为中断并发通知；之后第一次成功即恢复。
- 响应超过 3 秒记为“响应缓慢”，不算中断，也不发通知。
- 探测失败时会先确认监控机自己能不能上网（请求 `connectivity.urls`）。监控机断网期间的结果不计入可用率、不触发告警。
- 可用率按探测成功的次数计算。状态页上一天内失败不到 5% 标为“短暂异常”，否则标为“中断”。
- 证书剩余天数跌破 14、7、3、1 天时各提醒一次，证书换新后重新计。

这些数值都可以在配置里改，见下文。

## 部署

需要 Node.js 18 或更高版本。仓库是公开的，可以只取这个目录：

```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/sx120609/CPU-web.git cpu-status
cd cpu-status
git sparse-checkout set ops/status-monitor
cd ops/status-monitor
cp config.example.json config.json
```

先核对配置，每项探测一次并打印结果（不写数据、不发通知，有失败时退出码为 1）：

```bash
node bin/status-monitor.mjs --config config.json --once
```

确认无误后常驻运行。用 PM2：

```bash
pm2 start bin/status-monitor.mjs --interpreter node --name cpu-status -- --config config.json
pm2 save
```

或者用 systemd（`/etc/systemd/system/cpu-status.service`）。配置文件放在别处时，把其中的 `dataDir` 写成绝对路径：

```ini
[Unit]
Description=CPU-web status monitor
After=network-online.target
Wants=network-online.target

[Service]
User=cpu-status
WorkingDirectory=/opt/cpu-status/ops/status-monitor
EnvironmentFile=-/etc/cpu-status.env
ExecStart=/usr/bin/node bin/status-monitor.mjs --config /etc/cpu-status.json
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/cpu-status

[Install]
WantedBy=multi-user.target
```

服务默认只监听 `127.0.0.1:8787`，对外访问交给 Nginx（宝塔里是“添加站点 → 反向代理”，目标填 `http://127.0.0.1:8787`，不要开启代理缓存）：

```nginx
location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
}
```

想不经 Nginx 直接访问，把 `listen.host` 改成 `0.0.0.0` 并放行端口。

更新时在目录里 `git pull` 再重启进程；历史数据在 `dataDir`，不受影响。

## 配置

`config.json` 不入库。常用字段：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `title`、`siteName`、`siteUrl` | 药大拾间服务状态、药大拾间、`https://cputime.cn` | 状态页标题、品牌名和“返回主站”的地址 |
| `publicUrl` | 空 | 状态页自己的公网地址，填了会附在通知末尾 |
| `timezone` | `Asia/Shanghai` | 按这个时区划分自然日和显示时间 |
| `listen.host`、`listen.port` | `127.0.0.1`、`8787` | 监听地址 |
| `dataDir` | `data` | 历史数据目录，相对路径以配置文件所在目录为准 |
| `corsOrigins` | 空 | 允许跨域读取 `/api/status` 的来源，主站想在页面里显示状态时用 |
| `defaults.intervalSeconds` | 60 | 探测间隔，10 秒以上 |
| `defaults.timeoutMs` | 10000 | 单次探测的总时限 |
| `defaults.slowMs` | 3000 | 超过即“响应缓慢”，0 表示不判断 |
| `defaults.failureThreshold` | 2 | 连续失败几次判定中断 |
| `defaults.retryDelayMs` | 3000 | 失败后隔多久重试 |
| `connectivity.urls` | 百度、腾讯首页 | 用来判断监控机自己是否在线；设为空数组可关闭 |
| `certificate.warnDays` | 14 | 证书剩余多少天开始提醒 |

`groups` 是状态页上的分组，每组有若干检查项：

| 字段 | 说明 |
| --- | --- |
| `id` | 必填，小写字母、数字和连字符。历史数据按它保存，**改了 id 就等于换了一个新检查项** |
| `name`、`description` | 状态页上显示的名称和补充说明 |
| `url` | 探测地址 |
| `type` | `http`（默认）或 `assets`（取回页面并检查它引用的脚本和样式） |
| `critical` | 为真时，它中断会让总状态显示“主要服务中断”，否则是“部分服务异常” |
| `expect.status` | 允许的状态码，默认 200，可以是数组 |
| `expect.contains` | 响应体必须包含的文字 |
| `expect.json` | “路径: 期望值”，如 `{ "data.ready": true }` |
| `failureText` | 内容不符合预期时显示的原因，如“机器人未连接” |
| `versionFrom` | 从响应 JSON 的这个路径读取主站版本，显示在页脚 |
| `method`、`headers`、`followRedirects` | 请求细节，默认 `GET`、无额外请求头、跟随重定向 |
| `intervalSeconds` 等 | `defaults` 里的五项都可以按检查项单独覆盖 |

状态页和通知里的失败原因是公开的，只会出现“HTTP 502”“请求超时”这类简短说明，不含探测地址。

## 通知

`notify` 是渠道列表，为空时不发通知。短时间内的多个事件会合并成一条消息。

```json
"notify": [
  { "name": "企业微信", "format": "text", "urlEnv": "STATUS_NOTIFY_URL" },
  { "name": "QQ 群", "format": "onebot", "url": "http://127.0.0.1:3000/send_group_msg", "groupId": 123456789, "tokenEnv": "ONEBOT_TOKEN", "events": ["down", "recovered"] }
]
```

| `format` | 适用 | 请求体 |
| --- | --- | --- |
| `text` | 企业微信群机器人、钉钉自定义机器人 | `{"msgtype":"text","text":{"content":"…"}}` |
| `feishu` | 飞书自定义机器人 | `{"msg_type":"text","content":{"text":"…"}}` |
| `onebot` | NapCat 等 OneBot 11 的 HTTP 接口 | `{"group_id":…,"message":"…"}`，需要 `groupId` 或 `userId`，可选 `token` |
| `generic` | 自己的接收端 | `{"title","text","site","statusPage","events"}` |

- 地址和令牌带密钥，建议用 `urlEnv`、`tokenEnv` 从环境变量读取；它们不会出现在日志里。
- `events` 可以只订阅 `down`、`recovered`、`certificate` 中的一部分，默认全部。
- 钉钉机器人请用“自定义关键词”方式，关键词填品牌名（消息标题以“【药大拾间】”开头）；加签方式不支持。
- 用 OneBot 时，不要把通知发到和主站同一台机器上的机器人，否则主站整机故障时消息发不出来。

配置好以后发一条测试消息：

```bash
node bin/status-monitor.mjs --config config.json --test-notify
```

## 接口

| 路径 | 说明 |
| --- | --- |
| `/` | 状态页，每分钟自动刷新 |
| `/api/status` | 状态页的全部数据（JSON） |
| `/healthz` | 监控自身的健康检查，探测循环停滞时返回 503 |

所有响应都是 `Cache-Control: no-store`。

## 数据和日志

- 历史数据只有一个文件：`dataDir/state.json`，包含每个检查项 90 天的按日统计、最近 200 条事件和证书到期时间。备份或迁移时复制它即可。
- 文件损坏时会被改名为 `state.json.corrupt-<时间戳>`，监控从空数据继续运行。
- 日志每行一个 JSON 对象，写到标准输出：`check_failed`（单次探测失败）、`status_down`、`status_recovered`、`status_certificate`、`monitor_offline`（监控机自己断网）、`notify_sent`、`notify_failed`。

## 局限

- 只有一个探测点。监控机到主站之间的线路故障会被当成主站故障；监控机整体断网能识别出来并跳过。
- 教务 Agent 的在线数量不在公开接口里，这里只能看到教务网关是否就绪；学校教务系统本身是否可用也不在探测范围内。
- 监控停机期间没有数据，状态页上对应的日期显示为“无数据”。

## 测试

```bash
npm test
```

测试只用本机回环地址，不访问外网。它们没有接入 GitHub Actions 的生产构建流程，改动这个目录后请在本地运行。
