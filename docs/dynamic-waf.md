# CPU-web 动态防护

这套自建防护针对本次分享接口遭受的 HTTP 请求洪泛。Nginx 在转发到 Node 之前执行资源预算；独立 Python 守护根据整体流量进入攻击/恢复状态，不依赖主站数据库、Redis 或业务进程存活。

## 校园共享出口：生产使用的安全模式

配置必须保留 `sharedIngress=true`，生产使用 `mode=adaptive`。该模式不创建、不读取、不写入 IP 封禁表，也不跟踪个人 IP 候选；即使同一出口达到数万请求，仍只计算接口总流量。若试图同时启用 `mode=enforce`，配置检查会报错停止。Nginx 模板也完全移除了按 IP 限速与并发限制，因此不需要提前收集校园出口地址。

默认 systemd 服务还移除了 `CAP_NET_ADMIN`，从操作系统权限上阻止本守护操作防火墙。保留的 `CAP_DAC_READ_SEARCH`、`CAP_DAC_OVERRIDE`、`CAP_NET_BIND_SERVICE` 用于受限目录内的 Nginx 配置检查与平滑加载；这组权限已在生产主机以只读配置检查验证。

正常阶段分享接口合计最多 100 请求/秒、100 并发；攻击与恢复阶段增加 20 请求/秒、30 并发的总预算，突发 40。只影响 `/share/topic/*`，不隔离任何用户、IP、校园出口，也不影响首页、登录、教务、QQBot 或 VoiceHub 的路由。攻击时正常分享请求仍可能遇到 429，这是接口降级，不是 IP 封禁；不能承诺在源站带宽耗尽时所有请求都成功。

守护仅改自己的 `/var/lib/cpu-web-waf/nginx/adaptive.conf` map，先 `nginx -t` 再平滑 reload；变更和失败重试都有 180 秒冷却。失败恢复原 map；不会重启 Nginx 或强杀旧 worker/长连接。维护 Nginx 或部署期间可以先停止本守护，静态预算继续生效，完成后再启动。状态文件显示当前实际 `routeBudget`，观察/执行均保留审计。

v1 默认只保护 `/share/topic/*`，不改教务、QQBot、登录、支付或 VoiceHub 路由。可扩展分组，但必须同时增加 Nginx 的路径分类、限流预算和守护的 `protectedGroups`，不能只改 JSON 就认为其他接口已受保护。它不承担链路带宽清洗，也不宣称覆盖 SQL 注入、XSS、HTTP/2 协议漏洞等完整商业 WAF 能力；Nginx 与 TLS/HTTP 协议栈仍须及时打安全补丁。要抵御超过源站带宽或 TLS 处理能力的攻击，仍需上游防护和源站访问限制。

## 源站减负（随常规部署生效，不需改 Nginx）

Nginx 预算限制的是"到达后端的请求数"；后端自己也必须让每个分享请求足够便宜，否则预算内的请求仍能拖慢全站。`server/src/routes/share.ts` 同样不按 IP 区分访问者：

- 帖子数据进程内缓存 30 秒（含"不存在/已隐藏"结果），同一帖子的并发请求合并为一次查库；隐藏或删帖最迟 30 秒后分享页失效。
- 卡片图渲染结果缓存 10 分钟（与响应的 `max-age=600` 一致），条数与内存有上限。
- 渲染改为 `renderAsync`，不再阻塞事件循环；之前每张卡片同步渲染约 0.8 秒，期间登录、教务等所有请求一起排队。
- 卡片渲染最多 2 个并发、16 个排队，超出立即返回 `503 Retry-After: 5`，不在内存里堆积。已缓存的卡片不受此限制，正常用户打开热门分享链接不会被拒。
- 分享 HTML 增加 `Cache-Control: public, max-age=60`，前置 CDN/浏览器可以直接复用；非法 ID 在查库前拒绝，不存在的帖子使用预渲染的兜底图。

本地模拟（桩数据库）：同一帖子 300 个并发卡片请求，旧实现约 249 秒、其他接口最差延迟 2.7 秒；新实现约 1.4 秒、只查库和渲染各 1 次。300 个不同帖子时只渲染排在前面的部分，其余快速 503，其他接口延迟保持在 0.3 秒内。源站变便宜后，攻击阶段 Nginx 的 20 请求/秒收紧预算可在观察实际数据后适当放宽，减少攻击期间正常分享访问遇到的 429。

## 独立出口可选内核模式（校园生产禁止启用）

默认 10 秒滑动窗口中，一名来源对同一受保护分组至少 200 次请求，占该来源已观察请求的 95%，且至少一半被 Nginx 限流器标记为超限，才成为候选。普通 404/500、UA 名称、国别、Referer 均不单独触发封禁。已完成请求日志不是精确的到达 QPS，也无法发现没有结束的慢连接。

受保护分组的合计请求量超过基线阈值后进入 `attack`，候选门槛降至 100 次；下降后保留 60 秒 `recovery` 再恢复正常。基线仅在正常阶段按时间更新并设置上限，避免攻击流量把门槛无限抬高。分布式低频流量主要由 Nginx 的**分享接口总量预算**约束，不依赖逐个 IP 识别。

内核封禁还须满足：

- 地址是可公网路由的单个 IPv4/IPv6，且不在 `allowCidrs` / `trustedProxyCidrs`。
- Nginx 的 `$remote_addr` 与 `$realip_remote_addr` 相同，证明不是经过真实 IP 改写的代理用户；再用 `ss` 确认该地址仍是保护端口的真实 TCP 对端。
- 只写本工具拥有的 `inet cpu_web_waf` 表，最多 2,048 个活动封禁。不会执行 shell 拼接命令、修改第三方防火墙表或强制切断网关进程。

首次封禁 5 分钟，记忆期内再次违反变为 10、20 分钟，最长 1 小时；正常轮询不续封。内核 TTL 在守护退出后仍会到期。重启时从 nftables 校正本地状态，不凭磁盘文件假定封禁仍存在。状态文件和观察模式的候选记录分开。

**内核规则影响同一 TCP 端口上的所有网站与长连接。** 它不能按域名、登录账号或 HTTP 路径隔离。可选 `mode=enforce` 必须同时设置 `sharedIngress=false` 和 `dedicatedIngressConfirmed=true`。校园生产不得使用此模式。代理后用户不会自动下发源站内核封禁；v1 没有 CDN 厂商封禁 API 适配器。

可选内核模式还需要在独立出口主机显式授予 `CAP_NET_ADMIN`；默认服务没有该权限，即使配置误改也不能执行内核封禁。校园生产不得增加该权限。

## 文件与依赖

- `ops/waf/engine.py`：纯检测策略与封禁时间管理。
- `ops/waf/agent.py`：JSON 日志增量读取、nftables 执行、状态和审计；只需 Python 3.10+ 标准库。
- `ops/waf/adaptive.py`：共享出口安全的动态接口预算、校验、冷却与恢复。
- `nginx-http.conf`：HTTP 层分组、共享限流区和最小化日志格式。
- `nginx-server.conf`：站点层限速、并发限制、专用日志；初始均为 dry-run。
- systemd 服务、每分钟检查大小的 logrotate 定时器；Linux 需 `nft`、`ss`、`logrotate`。

Nginx 需 realip、limit_req、limit_conn 模块；`limit_conn_dry_run` 要求 Nginx 1.17.6+。JSON 仅记录时间、站点、真实连接来源、客户端地址、分组和限流结果，不记录 Cookie、Token、用户名、查询参数、正文或完整路径。

## 验证与正式制品

```sh
python3 ops/waf/agent.py check --config ops/waf/config.example.json
python3 -m unittest discover -s ops/waf -p test_waf.py -v
REQUIRE_WAF_NGINX=1 python3 -m unittest discover -s ops/waf -p test_nginx.py -v
sudo unshare --net env CPU_WAF_NETNS_TEST=1 python3 ops/waf/test_kernel.py -v
```

最后一个测试只允许在独立网络命名空间运行，会真实验证 TCP 阻断、未被封禁来源的连通、无关防火墙表保持和进程退出后自动解封；绝不能去掉 `unshare --net`。Nginx 测试使用随机本地端口与独立配置，不连接生产系统。

支持离线回放，输入必须是本工具 JSONL 格式：

```sh
python3 ops/waf/agent.py replay --config ops/waf/config.example.json --input trace.jsonl
```

回放无论 JSON 中 mode 是什么都不会调用防火墙。历史 combined 日志缺少可信 peer 与 `limit_req_status`，不可直接转换后当作自动封禁证据。

`Linux deployment artifact` 在 Ubuntu 24.04 中运行上述测试，并额外输出 `cpu-web-waf-<完整SHA>.tar.gz`、SHA-256 文件，包含逐文件哈希与绑定 SHA 的 `manifest.json`。生产安装须取自同一个精确 SHA 的成功 GitHub 工作流，并同时满足仓库已有 Server / Web / VoiceHub 构建门禁。示例验证：

```sh
sha256sum -c cpu-web-waf-<SHA>.tar.gz.sha256
python3 ops/waf/package.py --verify cpu-web-waf-<SHA>.tar.gz --commit <SHA>
```

本地生成物只用于测试。提交、推送、工作流完成和生产启用分别记录；没有生产授权时不执行下面安装步骤。常规 `deploy.sh update` 不会自动启用 WAF，也不接管已部署的应急脚本。

## 经授权后的安装与观察

从已验证制品解压至独立目录，再安装白名单中的文件。先确认目录没有另一份正在运行的部署，备份现有 Nginx 文件与 `nginx -T` 输出（配置备份只在服务器保管，不上传仓库）。

```sh
install -d -m 0755 /opt/cpu-web-waf
install -d -m 0700 /etc/cpu-web-waf /var/lib/cpu-web-waf
install -d -m 0755 /var/log/nginx
test -e /var/log/nginx/cpu-web-waf.jsonl || install -m 0640 -g adm /dev/null /var/log/nginx/cpu-web-waf.jsonl
install -m 0644 ops/waf/agent.py ops/waf/engine.py ops/waf/adaptive.py /opt/cpu-web-waf/
install -m 0644 ops/waf/nginx-http.conf ops/waf/nginx-server.conf /etc/cpu-web-waf/
# 只在初次安装时复制；已有配置不能覆盖。
test -e /etc/cpu-web-waf/config.json || install -m 0600 ops/waf/config.example.json /etc/cpu-web-waf/config.json
install -m 0644 ops/waf/logrotate.conf /etc/cpu-web-waf/logrotate.conf
install -m 0644 ops/waf/cpu-web-waf.service ops/waf/cpu-web-waf-logrotate.service ops/waf/cpu-web-waf-logrotate.timer /etc/systemd/system/
```

人工核对以下项目后再启用观察：

1. `hosts` 必须与被保护的 `server_name` 第一项一致。精确填写管理/校园可信出口 `allowCidrs` 和现有 CDN/反代 `trustedProxyCidrs`；后者不代替 Nginx `set_real_ip_from` 的正确配置，不能信任所有来源的 X-Forwarded-For。**JSON 白名单只豁免内核封禁，Nginx 路径预算仍执行。**
2. 在 Nginx `http {}` 内引入 `nginx-http.conf`，在目标 HTTPS `server {}` 内引入 `nginx-server.conf`。不得自动批量改其他站点。
3. 检查每个代理 `location`：该层自己的 `limit_req`、`limit_conn` 或 `access_log` 会覆盖相应的上层继承。必要时在这些 location 也引入同一片段。已经有其他限流的 location 应合并规则，不能覆盖掉原有保护。通过真实请求检查专用日志中的分组与限流状态。
4. 初次验证保留两项 Nginx `dry_run on` 和 JSON `mode=observe`，保留 `sharedIngress=true`。Nginx 正常预算为分享路径合计 100 请求/秒、突发 100、合计 100 并发；没有按 IP 的额度。先运行下述 `init-adaptive` 生成默认 map，再校验 Nginx。
5. 审计同机现有 access/error 日志策略。专用日志的每分钟轮转不能限制其他日志；在极端洪泛下单分钟也可能超过磁盘预算，应配置磁盘告警和上游拦截。不要把代理过滤日志当作无损取证：专用 reader 有读量预算、超长行丢弃和落后跳过策略。
6. logrotate 中 Nginx 的二进制、配置路径与 `adm` 组按主机核对。本文默认宝塔路径；发行版 Nginx 路径不同。先执行 `logrotate --debug /etc/cpu-web-waf/logrotate.conf`。确保专用日志没有在其他 logrotate 文件重复配置。

```sh
python3 /opt/cpu-web-waf/agent.py check --config /etc/cpu-web-waf/config.json
python3 /opt/cpu-web-waf/agent.py init-adaptive --config /etc/cpu-web-waf/config.json
/www/server/nginx/sbin/nginx -t -c /www/server/nginx/conf/nginx.conf
# 只有上一步通过才平滑加载，不重启主站/网关。
/www/server/nginx/sbin/nginx -s reload -c /www/server/nginx/conf/nginx.conf
systemctl daemon-reload
systemctl enable --now cpu-web-waf cpu-web-waf-logrotate.timer
```

观察需覆盖真实业务高峰，检查 `status.json` 的 `mode`、`phase`、`rps`、`logGap`、`errors`、`evictions` 与 `audit.jsonl` 的 `would_ban`；`ts` 超过 15 秒不更新应告警。`rps` 是已接受的完成日志窗口估计值，日志跳过/延迟时会低估，不能作为结算或精确峰值数据。候选应与校园出口、代理节点和业务行为复核。

## 分阶段执行

先只把 Nginx 的两个 `dry_run` 改为 `off`，校验并平滑加载，验证正常分享、其他帖子、登录、原生 App、教务 WebSocket、QQBot 和 VoiceHub。固定预算已经能限制分享请求到后端的数量。

校园生产改 JSON 为 `mode=adaptive`，保留 `sharedIngress=true`，重新 `check` 并重启**本守护服务**。JSON 不热加载，避免写入一半的策略被执行；配置变更需重启 guard，不需重启应用。验收应包含大量用户同一出口同时访问、攻击期间其他功能仍正常，以及没有新增任何 IP 封禁表。

不能同时沿用事故应急 IP 封禁脚本与共享出口模式：新预算经验证后，单独停止 `cpu-web-cc-guard-20261013`，按事故记录解除它的 `cpu_web_emergency_20261013` 临时表；是否恢复帖子 28036 的应急关闭规则要另行验证。新守护本身不会擅自停止其他服务或删除其他表。

## 误封、停止和回退

单个误封：先停止 `cpu-web-waf`，把确认的 IP/CIDR 加入 `allowCidrs`，校验配置再启动。启动会移除本工具集合里已被新白名单豁免的条目。共享出口应先调整策略，不要以永久封整个国家/ASN代替验证。

紧急取消所有动态封禁：

```sh
systemctl stop cpu-web-waf
nft list table inet cpu_web_waf
# 核对表注释为 CPU-web dynamic WAF v1 后，只删除本表。
nft delete table inet cpu_web_waf
```

只停止守护时，已有封禁仍按 TTL 到期；不会无限保留。固定 Nginx 限流仍有效。若需回退它，恢复两个 `dry_run on`，`nginx -t` 成功后平滑加载。完全撤销时先移除所有 server/location 引入，再移除 http 引入，校验后加载，并停用专用日志轮转 timer。保留事故审计。

## 官方行为依据

- [Nginx limit_req](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html)：共享限流、空键、dry-run 与继承规则。
- [Nginx limit_conn](https://nginx.org/en/docs/http/ngx_http_limit_conn_module.html)：HTTP/2/3 并发请求计数。
- [Nginx 日志模块](https://nginx.org/en/docs/http/ngx_http_log_module.html)：JSON 转义、日志缓冲及 location 继承。
- [nftables 元素超时](https://wiki.nftables.org/wiki-nftables/index.php/Element_timeouts)：内核自动过期。
