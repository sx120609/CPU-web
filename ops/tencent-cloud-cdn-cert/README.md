# 腾讯云 CDN 自定义域名证书自动续期

这套工具只处理 CPU-web 使用的腾讯云 **CDN 自定义加速域名**。它不会修改主站、源站 Nginx、COS 默认域名或其他云厂商证书，也不会执行 `deploy.sh`。

默认运行模式是只读 `dry-run`。当前实现面向以下链路：

1. 用 CDN `DescribeDomainsConfig` 精确读取域名、资源 ID、HTTPS 开关、当前托管证书 ID 和到期时间。
2. 读取真实的 `:443` TLS 证书，独立核对信任链、域名覆盖和到期时间。
3. 仅当剩余时间小于或等于 `renewBeforeDays`（默认 30 天）时才进入续期计划。
4. 先用 `DescribeCertificates` 查找该域名最近已申请的待签发/已签发证书，避免重复下单；没有可复用证书时，调用 `ApplyCertificate`，固定使用 `DNS_AUTO` 申请新的免费 DV 证书。
5. 用 `DescribeCertificate` 轮询签发状态，签发后再次检查 SAN/主域名与有效期增量。
6. 部署前重新读取 CDN 配置；当前证书、资源 ID、HTTPS/计费开关发生并发变化时立即停止。
7. 每个域名单独调用 `DeployCertificateInstance`，用 `DescribeHostDeployRecordDetail` 等待完成，不批量混合多个域名。
8. 部署后同时要求 CDN API 已读到新证书 ID，且公网 TLS 读到正确域名和新的到期时间。
9. 若部署任务已有成功记录但后置验证失败，调用 `DeployCertificateRecordRollback` 恢复旧证书，并验证回滚结果。回滚后状态会锁定为 `rolled_back`，必须人工检查并清理状态后才会再次尝试。

## 2026 年官方能力与限制

- 腾讯云 2026 年文档仍提供免费证书申请 `ApplyCertificate`，`DNS_AUTO` 仅适用于域名解析托管在同一腾讯云账号的云解析 DNS；这种模式由证书服务自动添加验证记录，本脚本不直接写 DNSPod。
- 免费证书有效期为 90 天。公开 API 中可以申请新免费证书、查询签发、部署、查询部署结果和回滚。
- 控制台“证书托管”可以在证书续期后自动替换关联的 CDN 等云资源，但截至文档核对日期，公开 SSL API 概览没有“新建/开启证书托管任务”的接口。因此脚本不会伪造控制台托管 API，而是实现安全的 API 兜底：到阈值后新申请免费证书、自动 DNS 验证、签发后部署。
- 2026-08-29 的只读控制台核对结果：`img.cputime.cn` 对应 CDN 资源 `cdn-2o4qgm9j`，源站为上海 COS 存储桶域名；HTTPS 已开启，当前证书 `aMvVQUJA`（TrustAsia C1 DV Free）到期时间为 `2026-11-27 02:59:59`。该证书已经关联 CDN，但“证书托管”列表当前为 0 条。脚本配置只固定 CDN 资源 ID，不固定证书 ID，因此后续续期不需要改配置。

官方依据：

- [免费证书申请 ApplyCertificate](https://cloud.tencent.com/document/product/400/41678)
- [获取证书信息 DescribeCertificate](https://cloud.tencent.com/document/product/400/41674)
- [部署证书到云资源 DeployCertificateInstance](https://cloud.tencent.com/document/product/400/91667)
- [查询部署记录 DescribeHostDeployRecordDetail](https://cloud.tencent.com/document/api/400/91658)
- [部署成功记录回滚 DeployCertificateRecordRollback](https://cloud.tencent.com/document/api/400/91665)
- [CDN 域名详细配置 DescribeDomainsConfig](https://cloud.tencent.com/document/product/228/41117)
- [自动 DNS 验证限制](https://cloud.tencent.com/document/product/400/54502)
- [SSL 证书托管指引](https://cloud.tencent.com/document/product/400/55818)
- [SSL API 概览](https://cloud.tencent.com/document/product/400/41681)

## 安装

部署机需要 Node.js 18 或更高版本。只安装此目录的固定依赖：

```bash
cd /path/to/CPU-web/ops/tencent-cloud-cdn-cert
npm ci --ignore-scripts
cp config.example.json config.json
```

Windows PowerShell：

```powershell
Set-Location C:\path\to\CPU-web\ops\tencent-cloud-cdn-cert
npm ci --ignore-scripts
Copy-Item config.example.json config.json
```

`config.json` 已被本目录 `.gitignore` 排除。新增同类 CDN/COS 自定义加速域名时，为每个域名增加一项，并从 CDN 控制台/API 填入精确的 `expectedCdnResourceId`。这里的“COS 自定义域名”必须已经作为 CDN 加速域名存在；COS 直连自定义域名不在本工具范围内。

## 凭据与最小权限

凭据只接受下面两种来源，命令行参数和配置文件中都没有密钥字段：

1. 环境变量：`TENCENTCLOUD_SECRET_ID`、`TENCENTCLOUD_SECRET_KEY`，临时凭据可再提供 `TENCENTCLOUD_SESSION_TOKEN`。
2. 主机密钥文件：环境变量 `TENCENT_CLOUD_CREDENTIALS_FILE` 指向仓库外 JSON：

```json
{
  "secretId": "replace-on-host",
  "secretKey": "replace-on-host",
  "token": "optional-temporary-session-token"
}
```

Linux 上把密钥文件设为 `0600`；Windows 上只给运行计划任务的账号授予读取权限。不要把密钥放进定时任务命令行、仓库、日志或状态文件。

[`cam-policy.example.json`](./cam-policy.example.json) 是脚本所需 API 的最小动作清单。把 `${TENCENT_CLOUD_UIN}` 替换为主账号 UIN；新增域名时同时添加对应的 CDN domain 资源。SSL 的申请阶段尚无证书 ID，因此示例中的 SSL 动作使用 `resource: "*"`。建议将策略绑定到专用 CAM 子用户或可获取临时凭据的运行角色，不要使用主账号永久密钥。

创建密钥、角色或策略属于外部权限变更，本仓库不会自动创建它们。

## 先运行 dry-run

不写云资源、不写状态文件：

```bash
node bin/cdn-cert-renew.mjs --config config.json --dry-run
```

省略 `--dry-run` 也是 dry-run。正常输出为每行一个 JSON 对象，便于日志平台解析；SecretId、SecretKey、token、Authorization 等字段会被脱敏。

dry-run 必须成功确认以下内容后，才考虑启用执行模式：

- 每个域名只匹配一个精确 CDN 资源 ID；
- CDN 域名在线，HTTPS 已开启，计费开关与配置一致；
- CDN API 到期时间与公网 TLS 到期时间一致；
- 当前凭据只有所需最小权限；
- `DNS_AUTO` 所需的 `cputime.cn` 云解析 DNS 与证书申请账号相同。

## 执行模式

执行模式具有申请证书和替换 CDN 证书的外部副作用，必须同时提供三个开关：`--execute`、仓库外的持久状态文件，以及与当前全部启用域名完全一致的 `--confirm-domains`。

```bash
node bin/cdn-cert-renew.mjs \
  --config /etc/cpu-web/tencent-cdn-cert.json \
  --execute \
  --state-file /var/lib/cpu-web/tencent-cdn-cert.state.json \
  --confirm-domains img.cputime.cn
```

多个域名：

```bash
node bin/cdn-cert-renew.mjs \
  --config /etc/cpu-web/tencent-cdn-cert.json \
  --execute \
  --state-file /var/lib/cpu-web/tencent-cdn-cert.state.json \
  --confirm-domains img.cputime.cn,assets.cputime.cn
```

状态文件不含密钥，只记录恢复所需的旧/新证书 ID、部署记录 ID、阶段和时间。进程使用同路径 `.lock` 防止重叠运行；发现锁时会失败关闭，不会自动删除未知锁。

## Linux systemd 定时任务示例

`/etc/cpu-web/tencent-cdn-cert.env`（`chmod 600`）：

```ini
TENCENT_CLOUD_CREDENTIALS_FILE=/etc/cpu-web/tencent-cloud-credentials.json
```

`/etc/systemd/system/cpu-web-cdn-cert.service`：

```ini
[Unit]
Description=CPU-web Tencent Cloud CDN certificate renewal
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=cpu-web
Group=cpu-web
WorkingDirectory=/www/wwwroot/CPU-web/ops/tencent-cloud-cdn-cert
EnvironmentFile=/etc/cpu-web/tencent-cdn-cert.env
ExecStart=/usr/bin/node bin/cdn-cert-renew.mjs --config /etc/cpu-web/tencent-cdn-cert.json --execute --state-file /var/lib/cpu-web/tencent-cdn-cert.state.json --confirm-domains img.cputime.cn
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/var/lib/cpu-web

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/cpu-web-cdn-cert.timer`：

```ini
[Unit]
Description=Check CPU-web CDN certificates daily

[Timer]
OnCalendar=*-*-* 03:15:00
Persistent=true
RandomizedDelaySec=15m

[Install]
WantedBy=timers.target
```

启用前先手动 dry-run，再由已授权运维人员执行：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now cpu-web-cdn-cert.timer
systemctl list-timers cpu-web-cdn-cert.timer
```

## Windows 计划任务示例

先把 `TENCENT_CLOUD_CREDENTIALS_FILE` 配置为计划任务运行账号的用户环境变量，密钥文件放在仓库外。以管理员 PowerShell 创建每日任务：

```powershell
$taskAction = New-ScheduledTaskAction `
  -Execute 'C:\Program Files\nodejs\node.exe' `
  -Argument 'bin\cdn-cert-renew.mjs --config C:\ProgramData\CPU-web\tencent-cdn-cert.json --execute --state-file C:\ProgramData\CPU-web\tencent-cdn-cert.state.json --confirm-domains img.cputime.cn' `
  -WorkingDirectory 'C:\path\to\CPU-web\ops\tencent-cloud-cdn-cert'
$taskTrigger = New-ScheduledTaskTrigger -Daily -At 03:15
$taskSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask `
  -TaskName 'CPU-web Tencent CDN certificate renewal' `
  -Action $taskAction `
  -Trigger $taskTrigger `
  -Settings $taskSettings `
  -User 'DOMAIN\cpu-web-service' `
  -RunLevel Highest
```

不要在 `-Argument` 中放 SecretId 或 SecretKey。正式注册前，用同一个运行账号执行 dry-run。

## 故障处理

- `certificate_failed`：证书申请失败、状态未知或签发超时。检查证书控制台和 DNS 自动验证；不要直接删除状态后重复申请。
- `deployment_failed`：部署任务没有成功记录，旧证书未被脚本切换。检查部署记录后再决定是否清理状态。
- `rolled_back`：新证书曾部署成功，但 CDN API 或公网 TLS 后置验证失败，脚本已经恢复并核对旧证书。必须人工分析传播、域名匹配和证书有效期。
- `rollback_failed`：最严重状态。脚本不会继续覆盖证书，应立即检查 CDN 当前证书和腾讯云部署记录。
- `.lock` 存在：先确认没有同一任务进程，再由运维人员删除陈旧锁；脚本不会猜测锁是否安全。

状态异常时始终以 CDN 控制台/API、SSL 部署记录和独立公网 TLS 读回三者为准。

## 测试

```bash
npm test
```

测试覆盖官方 SDK 参数封装、到期阈值、证书/部署轮询状态机、幂等候选复用、dry-run 不写云端、部署前并发校验、部署后 TLS 校验，以及后置验证失败时回滚。
