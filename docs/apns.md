# CPU 独立 APNs

CPU 与 NapTable 的 App ID 不同。团队级 APNs 密钥在权限允许时可以共用，但广播频道不能跨 App ID 使用。CPU 服务不读取 NapTable 配置，客户端也不再连接 NapTable。

## 配置

1. Apple Developer 为 CPU App ID `cn.cputime.mobile` 启用 Push Notifications；广播还需为此 App ID 开通 Broadcast Capability。重新生成包含推送能力的签名描述文件。
2. 将 `.p8` 放在 CPU 服务器 release 目录外，例如 `/etc/cpu-web/keys/AuthKey_XXXXXXXXXX.p8`，仅允许服务用户读取。
3. CPU 管理后台 → APNs 推送：填写绝对路径、Key ID、Team ID、Bundle ID `cn.cputime.mobile`，调度间隔建议 5 秒。保存会检查文件能否读取、是否为 P-256 私钥；不会据此认定 Apple 已接受凭据。
4. 保存凭据后，服务端调用 Apple Channel Management API，自动为当前 CPU App ID 创建生产与沙盒频道，将 Apple 返回的 ID 存入 `production:cpu`、`sandbox:cpu`。管理页只读展示，无需手填。频道使用 No Message Stored，避免补发过期课程边界。已有频道保持不变；一侧失败仍保存另一侧的结果，可点击「创建缺失频道」重试。未取得频道的设备继续走逐设备推送。
5. 更换 Team ID 或 Bundle ID 时，服务端自动解除旧频道映射并为新 App 创建频道，不删除 Apple 上的旧频道。重新打开 App 注册设备，以刷新频道映射。生产包与开发包的环境由签名描述文件判断，TestFlight 使用 production。

数据库配置优先。首次配置前可用 `CPU_APNS_KEY_PATH`、`CPU_APNS_KEY_ID`、`CPU_APNS_TEAM_ID`、`CPU_APNS_BUNDLE_ID`、`CPU_APNS_TICK_SECONDS`、`CPU_APNS_CHANNELS_JSON` 环境变量。四项凭据全留空表示关闭推送。

## 数据与接口

使用现有 PostgreSQL LiveActivityDevice、LiveActivityPlan、LiveActivityDeviceActivity、LiveActivityBroadcastEvent 和 SiteSetting 表，无新增迁移。按现有生产流程运行迁移并生成 Prisma 客户端。

`/api/live-activities/devices` 注册设备；`/devices/:deviceID/plan` 替换计划；`/devices/:deviceID/activities` 注册活动 token。接口需要 CPU 账号登录，Cookie 写操作需要 CSRF，各设备操作检查账号归属。APNs token 加密保存；计划由客户端生成并按服务端时间调度，失败重试、失效 token 清理、过期事件跳过。

调度器跟随现有后台 worker 所有权机制启动，避免蓝绿部署重复运行。Node 原生 HTTP/2 和 crypto 负责 APNs 通信与 ES256 签名，15 秒请求超时，APNs expiration 为 0。频道管理连接 `api-manage-broadcast.push.apple.com:2196`（生产）与 `api-manage-broadcast.sandbox.push.apple.com:2195`（沙盒），服务器需允许这两个出站端口。保存与创建使用 PostgreSQL 事务级 advisory lock，防止并发重复创建或写回旧 App 的频道。Apple 未开通广播能力或凭据无权访问时，后台展示错误；“已配置”不等于频道已创建。

## 验收

- 本地：在 server 目录运行 `node --import tsx --test tests/apns*.test.ts tests/liveActivityPush.test.ts`，仓库根目录运行 `bash ios_next/scripts/check-live-activity.sh`。
- 部署独立后端并安装新版 CPU App，登录、打开课表，开启实况活动。旧 NapTable 设备 ID 不复用，新版使用独立本地存储键。
- 在真机创建即将开始的课程计划，检查设备状态的 `pushConfigured`、`hasStartToken`、`pendingCount` 与 `nextFireAt`。锁屏等待启动、更新、结束，并检查数据库计划状态和错误详情。
- 分别测试开发签名与 TestFlight。广播另外验证自动创建的 CPU App ID 频道；频道创建完成后重新打开 App。
- 本地回归或管理台“已配置”均不能代替 Apple 回执与真机验收。生产部署仍需明确授权并遵循 `production-requirements.md`。
