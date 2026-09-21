# CPU 远程启动与学校广播实时活动

iOS 18 及以上采用 **逐设备 push-to-start + 学校广播更新**。用户首次登录、加载课表并允许实时活动后，联网同步已加载学期的启动时间；之后无需每天打开 App。提前量在实时活动设置中自定义为 0–60 分钟，默认 15 分钟；0 表示上课时启动。

## 数据和执行路径

1. 客户端监听 `Activity.pushToStartTokenUpdates`，同步启动 token、环境、Bundle ID、提前量及每个有课时段的 `{dateKey, window, start, end}`。计划覆盖已加载校历（最多向后 370 天、1110 个时段），不是七天滚动预约。课程名称、教师、地点、个人更新 token 不上传。
2. 服务端加密保存启动 token，批量写入启动事件，`fireAt = start - leadMinutes × 60`；用户首次同步时若已进入该时段的提醒窗口，则立即启动。每个设备每个日期、时段一个稳定身份。重开 App、修改提前量和 token 轮换保留已发送记录，不重复安排该时段；修改未来课表会替换待发送记录。数据库沿用现有 `LiveActivityDevice` / `LiveActivityPlan`，新事件标识为 `hybrid-start-v1`，旧版事件不会执行。
3. 到期后向该设备发送 `event: start`，同时设置 `input-push-channel` 为对应时段频道。iOS 创建活动并订阅广播，无需等待主 App 回传活动更新 token。启动 payload 包含 Apple 要求的 alert。
4. 上午（课程开始时间 00:00–11:59）、下午（12:00–17:59）、晚间（18:00–23:59）各一个频道，生产/沙盒共六个。服务器按学校节次广播时间信号，Widget 从 App Group 本地课表还原个人课程和调休说明。倒计时由系统渲染，不逐秒推送。
5. 学校每节课的课前 15 分钟、开始和结束时广播，同刻去重。广播的 15 分钟边界是公共刷新信号，**不决定个人启动时间**。每个时段最后一节结束时统一 `end`。个人提前下课时显示“本时段课程已结束”，不额外逐设备发结束请求。

活动从个人启动时间到学校时段结束必须小于 8 小时，超长时段不安排。周末是否有课由本地课表决定，放假/调休随课表展开进入计划。临时调课、课表编辑或学期切换后需联网重新同步；旧快照不会自动获知尚未下载的课程变更。设置页显示已同步截止日期或同步失败，不能把失败当作新设置已生效。

## 生命周期与边界

- 广播本身不能创建活动；不使用静默推送或后台刷新模拟可靠启动。
- iOS 18 起支持远程启动时订阅频道。iOS 17 保留前台本地活动，此版本不实现 17.2 的逐活动 token 更新路径。
- 远程模式不同时创建本地预约，避免一次课程出现两个活动。前台会清理旧版本地/待预约活动，保留已远程创建的频道活动。
- 关闭功能或退出账号，客户端结束活动并撤销设备计划。撤销使用只绑定原设备/账号/token 的加密能力凭据，网站 cookie 已退出仍可撤销；离线失败会持久化等待重试。退出时尚未返回的保存请求完成后也会被撤销。**离线关闭不能立即阻止服务器已在途或未来尚未撤销的推送。** 系统实时活动权限关闭后不会显示，App 下次前台同步会清空待启动计划。
- token 轮换用上一份设备凭据迁移原设备计划，保留已发送身份；同一 token 换账号会清除原账号计划。APNs `BadDeviceToken` / `Unregistered` 停用设备，等待重新注册。
- 启动短期有效，最晚不超过首课开始后 60 秒或启动后 5 分钟（取较晚者），且不晚于时段结束。广播有效期 60 秒。APNs expiration 为 0、频道 No Message Stored；不补发积压一天的启动。
- APNs 送达、启动预算和设备网络受系统约束，不承诺百分之百准点。服务端成功回执不等同真机已显示；异常断连、服务进程在发送后落库前退出存在送达不确定性，不能承诺端到端 exactly-once。

## 服务器开销

每台设备每个有课时段一次启动（通常每天 1–3 次）；之后全校共享几十次边界广播，基本不随人数增长。不轮询每个人的课程，也不与手机维护 WebSocket。

调度器按到期索引读取最多 200 项，最多 12 路并发，复用 HTTP/2 连接和 APNs JWT。满批时 0.5 秒后继续。设备 token 级事务锁协调计划修改、撤销和多实例发送；临时错误退避重试，过期跳过。广播仅在日期/学校配置变化时重新物化，学校配置每分钟检查一次。集中开课前的启动突发需按真实用户数压测，特别是数据库连接数与 APNs 限流。

## 配置

1. Apple Developer 为 `cn.cputime.mobile` 开启 Push Notifications 和 Broadcast Capability，并更新签名描述文件。
2. `.p8` 放在 release 目录外，例如 `/etc/cpu-web/keys/AuthKey_XXXXXXXXXX.p8`，仅服务用户可读。
3. 管理后台 → APNs 推送：填写路径、Key ID、Team ID、Bundle ID，建议调度间隔 5 秒。这是扫描频率，不是手机刷新频率。
4. 保存后自动创建 `production:cpu-morning` / `cpu-afternoon` / `cpu-evening` 及沙盒频道。部分失败时“创建缺失频道”重试；缺失时段不启动，设置页提示未就绪。旧 `production:cpu` / `sandbox:cpu` 不使用。
5. 允许服务器出站 Apple 推送服务及频道管理 production 2196、sandbox 2195。TestFlight 使用 production，开发签名通常使用 sandbox。
6. 新版 App 登录并加载课表，等待设置页显示计划已同步。测试按钮仅验证本地演示，不代表 APNs 已打通。

数据库配置优先。首次可使用 `CPU_APNS_KEY_PATH`、`CPU_APNS_KEY_ID`、`CPU_APNS_TEAM_ID`、`CPU_APNS_BUNDLE_ID`、`CPU_APNS_TICK_SECONDS`、`CPU_APNS_CHANNELS_JSON`。四项凭据全空表示关闭。保存与频道创建沿用事务级锁。

## API 和升级

- `PUT /api/live-activities/remote-start`：登录态下原子注册/更新设备与时间计划；返回撤销凭据、计划截止日期及缺失频道。
- `POST /api/live-activities/remote-start/revoke`：仅接收服务端签发的加密撤销凭据，无需登录 cookie，不接收任意设备 ID。
- `GET /api/live-activities/broadcast-config`：保留学校公开时间/频道元数据接口（登录态），最低混合方案系统版本为 18。
- 旧 `/devices`、`/plan`、`/register` 等接口继续返回 410；历史逐课程事件和更新 token 表不执行、不自动删除。新客户端和后端应配套发布。

## 验收

- `cd server && node --import tsx --test tests/apns*.test.ts tests/liveActivity*.test.ts`：提前量、学期跨度、校验、隐私字段、幂等、token 轮换、跨账号撤销、过期/重试/失效 token、连接复用、广播。
- `bash ios_next/scripts/check-live-activity.sh`：实际控制器与网络协调器，对照内存 ActivityKit 验证自定义提前量、调休、课程解析、避免重复创建、权限、退出期间迟到响应的撤销。
- Xcode 模拟器构建确认真实 SDK 兼容性；本地构建不是生产制品。
- iOS 18 / iOS 26 真机分别使用开发签名和 TestFlight：开启功能后退出 App、锁屏，跨日验证远程启动、广播更新与统一结束；验证 0/15/30/60 分钟、无课日、调休、修改设置、掉线重连、换账号、token 轮换和关闭功能。
- APNs 回执与真机行为是上线验收必需项。部署仍需明确授权并遵循 `production-requirements.md`，部署消费对应 SHA 的 GitHub Actions 制品。
