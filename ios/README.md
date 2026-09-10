# 药大拾间 iOS 客户端

这是 Android WebView 客户端的原生 iOS 迁移版，最低支持 iOS 17。App 默认打开 `https://cputime.cn`，并包含 WidgetKit 课表小组件与最低支持 watchOS 10 的原生 Apple Watch 课表 App。

## 已迁移能力

- WKWebView 壳、Cookie/DOM 存储、返回手势、启动页和网络错误重试
- 同域页面在 App 内打开，外部网页、电话、邮件和短信交给系统处理
- 网页文件选择、媒体权限和附件下载
- `CPUIOS` JavaScript 原生桥：版本信息、剪贴板、外链、图片预览、保存到相册和小组件配置
- 三类 WidgetKit 小组件，共对应 Android 的五种有效布局：
  - 临近课程：小号、中号
  - 今日课表：中号、大号
  - 两日课表：大号
- Apple Watch 原生课表：今日/本周日期切换、当前或下一节课程、课程详情、离线缓存、过期提示与手动刷新
- Apple Watch“下一节课”小组件：支持智能叠放以及矩形、圆形和行内表盘复杂功能

Android 的 APK 应用内更新没有迁移；iOS 发布后应使用 App Store 更新机制。

## 运行

用 Xcode 打开 `ios.xcodeproj`。iPhone 使用 `cpuweb` scheme；Apple Watch 使用 `CPUWatch` scheme，并选择与 iPhone 配套的 Watch 模拟器或真实配对设备。

命令行模拟器构建：

```bash
xcodebuild \
  -project ios.xcodeproj \
  -scheme cpuweb \
  -sdk iphonesimulator \
  -configuration Debug \
  build
```

仅做源码级无签名验证时，可使用以下三个 scheme（`cpuweb` 会同时构建并嵌入两个 Watch target）：

```bash
xcodebuild -project ios.xcodeproj -scheme cpuweb \
  -configuration Debug -destination 'generic/platform=iOS' \
  CODE_SIGNING_ALLOWED=NO build
xcodebuild -project ios.xcodeproj -scheme CPUWebWidgets \
  -configuration Debug -destination 'generic/platform=iOS' \
  CODE_SIGNING_ALLOWED=NO build
xcodebuild -project ios.xcodeproj -scheme CPUWatch \
  -configuration Debug -destination 'generic/platform=watchOS' \
  CODE_SIGNING_ALLOWED=NO build
```

课表协议及 JavaScript 数据桥测试：

```bash
cd ios
swift test
cd ..
node --test ios/tests/watch-bridge.test.mjs ios/tests/watch-calendar-ui.test.mjs \
  ios/tests/watch-ui-entry.test.mjs ios/tests/watch-widget.test.mjs
npm run type-check --prefix web
```

修改 `ios/bridge/` 或其复用的 Web 课表加载逻辑后，重新生成随 App 发布的桥接资源并运行桥接测试：

```bash
node ios/scripts/build-watch-bridge.mjs
node --test ios/tests/watch-bridge.test.mjs
```

不要用 `CODE_SIGNING_ALLOWED=NO` 测试小组件。该选项只适合验证源码能否编译，生成的 App 不具备 App Group entitlement，主 App 无法把课表配置共享给 Widget。

首屏地址由 `CPU_APP_URL` build setting 控制，默认值为 `https://cputime.cn`。

## 签名与小组件

App、扩展和 Watch App 默认使用以下标识：

- App：`cn.lizmt.cpuweb`
- Widget Extension：`cn.lizmt.cpuweb.widgets`
- Watch App：`cn.lizmt.cpuweb.watchkitapp`
- Watch Widget Extension：`cn.lizmt.cpuweb.watchkitapp.widgets`
- App Group：`group.cn.lizmt.cpuweb`

基础 App Bundle ID 可通过 `CPU_APP_BUNDLE_IDENTIFIER` build setting 覆盖，Widget 与 Watch Bundle ID 会自动追加后缀，Watch 的 Companion App 关系也会随之更新。App Group 通过 `CPU_APP_GROUP_IDENTIFIER` 统一配置。

其他开发者自签时，复制 `Configurations/Signing.local.xcconfig.example` 为 `Configurations/Signing.local.xcconfig`，填写自己团队的 `CPU_DEVELOPMENT_TEAM`、唯一 Bundle ID 和唯一 App Group。四个 Target 会自动继承这份配置；本地文件已被 Git 忽略，不要强制添加或提交它，也不要提交 Apple 账号、证书或登录凭据。

在真机或归档前，需要为 App、Widget 和 Watch Target 选择同一个开发团队。App 与 Widget 必须继续使用同一个 App Group；如果 Personal Team 或签名配置不允许 App Group，应保留 entitlement 并把它作为签名限制处理，不要通过删除能力绕过。登录教务后，在课表页的“更多”中点击“添加 iOS 小组件”，客户端会保存独立的小组件凭据并刷新所有时间线；随后长按主屏幕，从系统小组件图库添加“药大拾间课表”。

## Apple Watch 课表同步

数据链路为：现有教务结构化接口与 Web 会话 → 注入 WKWebView 的版本化只读桥 → `ScheduleDataProvider` → `CourseRepository` 原子缓存 → `WatchConnectivity` → Watch 本地原子缓存 → SwiftUI 界面。

- Watch App 不包含 WebView 和登录入口；登录、验证码与授权仍只在 iPhone 完成。
- 传输只包含白名单化的 `ScheduleEnvelope` 课表字段，不包含 Cookie、密码、验证码或访问令牌。
- 固定节次及起止时间由现有 Web 课表的权威 `smallSlots` 配置写入信封，Watch UI 不维护第二份作息表；升级前缓存仍可兼容读取。
- iPhone 使用 `updateApplicationContext` 保存最新完整快照；双方都可达时，Watch 用 `sendMessage` 请求 iPhone 刷新。
- iPhone 的 App Group 只继续服务现有 Widget，不用于跨设备传输。
- 新快照只有在版本、日期、时区、周次、课程字段和数据量校验通过并成功写盘后才替换旧缓存。

iPhone App 的个人中心会在原生 iOS 环境中显示“Apple Watch 课表”入口；打开后可查看配对、安装、可达、缓存课程数、课表更新时间、系统提交时间、Watch 回执时间和最近错误，并可点击“立即同步”。普通网页和其他平台不会显示这个入口。

Watch 小组件和 Watch App 使用同一个手表本地 App Group 缓存。更新或首次安装后，先打开一次 Watch App 完成同步，再在智能叠放或表盘编辑界面选择“下一节课”。小组件只读取经过校验的本地课表快照，不直接登录教务或读取 iPhone 的 Cookie、Token。

## 真实配对验证

模拟器或无签名构建不能替代真实配对验收。使用自己的 Apple Account/Personal Team 时，在 Xcode 中同时选择 iPhone App、iOS Widget、Watch App 与 Watch Widget 的签名团队；如默认标识不属于该团队，请将 `CPU_APP_BUNDLE_IDENTIFIER` 和 `CPU_APP_GROUP_IDENTIFIER` 改为自己可注册的一组唯一标识。

1. 选择真实 iPhone 与其已配对 Apple Watch，运行 `cpuweb` scheme，并确认 Watch App 已安装。
2. 在 iPhone 完成教务登录，打开课表，进入手表同步状态页确认已有缓存课程。
3. 点击“立即同步”，在 Watch 打开“药大拾间”，核对课程名称、周次、时间、地点和教师。
4. 挂起 iPhone App 后重开 Watch App，确认仍可读取缓存；断开并恢复连接后再次同步。
5. 修改或刷新 iPhone 课表，确认 Watch 收到新快照，并记录 iOS、watchOS、Xcode 与设备型号。

未按以上流程在真实设备执行时，只能认定代码阶段完成，真实配对仍待人工验证。
