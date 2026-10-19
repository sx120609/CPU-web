# App Store 首次上架审计报告

## 2026-09-07 后续整改状态

已根据后续指令实现：账户永久删除与回执/重试流程、iOS 支付和权益兑换入口隐藏及接口拦截、主站论坛/私聊屏蔽与资料人工治理、动态 AI 接收方声明及明确同意/撤回。实现范围、保留边界、测试结果和上线步骤见 [账号隐私改造记录](docs/account-privacy-rollout.md)。

**这些是源码整改，尚未部署或完成签名 iOS 真机验收，不等于已经满足上架条件。** 自定义 AI 代理的实际运营方和留存信息仍需核实填写；缺项时系统不发送用户内容。生产清理权限、CDN 回读、审核值守、备案/版权和审核测试账号等运营事项仍须完成。

下文保留首次审计时的证据与风险基线；其中“缺少账户删除/屏蔽/AI 同意”等描述属于整改前状态，不能用来否定上面的源码整改，也不能将整改推定为线上已生效。

审计日期：2026-09-07。审计对象：当前工作区，起始 Git HEAD 为 `2f4b2fae413d59130dfc25704530fa76e63891a1`。目标入口为 `ios/ios.xcodeproj` 的 `cpuweb` scheme；同时检查其加载的 Web、Server、VoiceHub，以及其他客户端对共享业务的影响。

## 1. 总体结论

**当前不建议提交；风险：高。**

这已经是有实际业务的校园服务产品，不是简单的空壳 Demo；但账户删除、数字权益外部支付、UGC 屏蔽、第三方 AI 数据共享告知/同意仍有实质缺口。原生源码修补和 Web/Linux 构建通过，均不能替代签名 iOS Archive、App Store Connect 校验和真机测试。

最危险的五个问题，按当前剩余风险排序：

1. 首次学校 SSO 会创建账号，但没有完整账户删除入口/API/处理流程。
2. 线上赞助支付每 ¥1 发放 200 AI 点数；VIP 通过自有礼品码解锁数字权益，没有 StoreKit/IAP。
3. 私信和论坛缺少用户主动屏蔽能力，账号头像/简介等治理不完整。
4. 私信、帖子等会进入第三方 AI 审核，现行隐私政策和用户同意链路未覆盖完整。
5. 没有可验证的签名 iOS 构建、完整 Reviewer 账号及真机操作证据，学校认证可能让审核员无法体验核心功能。

### 1.1 检查范围与证据边界

起始仓库有 1,783 个跟踪文件。对 1,439 个非生成文本文件进行了结构、URL、占位文案、敏感 API 和凭据模式扫描，再阅读命中项和核心调用链。**扫描不等于逐行人工证明全部代码正确**；未把第三方生成代码、历史二进制、`output/`、依赖安装目录逐行审阅。依赖另行通过 package/lock、调用点及 npm advisory 审计。详细文件清单和命中位置在 `output/app-store-audit-20260907/static-scan.json`。

| 模块 | 扫描文本文件数 | 技术栈/审查重点 |
| --- | ---: | --- |
| ios | 18（新加的 manifest 另行校验） | Swift、SwiftUI、UIKit、WKWebView、Photos、WidgetKit；主 App、扩展、scheme、签名、桥接、网络及共享存储 |
| web | 296 | Vue 3、Vite、TypeScript、Pinia、Element Plus、Axios；路由、登录、课表、论坛、私信、个人资料、支付、工具、隐私页 |
| server | 427 | Express、Prisma、PostgreSQL、Redis；鉴权、SSO、缓存、数据模型、上传、审核、举报、支付、OAuth、机器人 |
| voicehub | 478 | Nuxt 4、Vue、Drizzle、独立 PostgreSQL；CPU-web 账号桥接、音乐解析/播放、点歌、统计和邮件 |
| flutter_client | 28 | Flutter + webview_flutter + url_launcher；独立替代壳，不是上述 Swift 工程的一部分 |
| android / harmony / desktop | 66 / 16 / 69 | Android WebView、Harmony ArkTS、Electron；识别共享链接、下载、自动化工具及平台边界 |
| 其他 | 41 | 根配置、部署脚本、GitHub Actions、技术文档等 |

重点人工追踪包括：全部 Swift 源文件及工程配置；Web router/auth/request；Server auth/user/browserSession/Prisma；微信绑定；payments/vip；forumReport/directMessage/内容审核；资料上传；工具与 VoiceHub 入口、VoiceHub 认证中间件与 SDK；相关测试。

工作区原有 Android、Harmony 生成物、`ios/CPUWebWidgets/WidgetModels.swift`、`ScheduleWidgets.swift`、`web/components.d.ts` 和大量 `output/` 改动，均未覆盖或纳入本次选择性提交。本报告中的 Widget 行为按当前工作区阅读，不能把原有未提交修改当成已发布二进制。

当前设备为 Windows，没有可用的 `xcodebuild`/Swift 工具链、iOS Simulator 或连接的 iPhone。浏览器控制先后尝试 Chrome 与内置浏览器，均初始化超时，未得到可用 UI 状态。以下明确区分：代码静态检查、HTTP 回读、自动化测试、尚未执行的真机/UI 流程。未使用真实用户发布内容、付款或删除账户作试验。

### 1.2 当前提交配置

| 项目 | 仓库证据 | 结论 |
| --- | --- | --- |
| 主产品 | `ios/README.md:3`、`ios/cpuweb/WebViewContainer.swift:12` | SwiftUI + WKWebView 加载 `https://cputime.cn`，附带原生课表 Widget；不是 Capacitor/Cordova、React Native 或 UniApp |
| SDK/Xcode | `ios/ios.xcodeproj/project.pbxproj:6`、`:159`；`SDKROOT = iphoneos` | objectVersion 90、升级元数据 2700、创建元数据 26.3；**这些不能证明实际用 iOS 26+ SDK 构建，更不能证明使用 Apple 当前接受的正式工具链**。须实际运行 Xcode，并验证 Archive 的 DTSDKName/DTXcode/DTXcodeBuild |
| 最低系统 | `project.pbxproj:399`、`:462`、`:495`、`:530` | 主 App 和 Widget 的 Debug/Release target 均覆盖为 iOS 17.0。项目级 27.0 不能误读为最终 target 的最低系统版本；也不要为满足 SDK 要求把最低系统改成 26 |
| Bundle ID | `project.pbxproj:404`、`:467`、`:502`、`:537` | `cn.lizmt.cpuweb` / `cn.lizmt.cpuweb.widgets`，反向域名格式正常；归属和 App Store Connect 记录需人工核实 |
| 版本 | `project.pbxproj:429`、`:466`、`:526`、`:536` | 主 App/Widget 均为 1.0.0 (1)；是否已占用 build 号未知。本次让原生桥版本读取 Bundle，避免以后版本漂移 |
| 签名 | `project.pbxproj:425`、`:523`，两个 entitlements | Automatic、Apple Development、团队 VF6KYPSB9R；仅 App Group。开发签名设置不等于必然无法导出，但必须证明 Distribution export 的证书/profile/entitlements 正确 |
| Archive 配置 | `ios/ios.xcodeproj/xcshareddata/xcschemes/cpuweb.xcscheme` 的 ArchiveAction | Release。WebView 调试检查器包在 `#if DEBUG` 内；未发现 Release 主动开启检查器 |
| 生产入口 | `project.pbxproj:428`、`AppConfiguration.swift:15`；`web/src/api/request.ts:341` 附近 | 原生为正式 HTTPS 域名；Web 使用同源 `/api`、15 秒默认 timeout。未发现正式原生入口指向 localhost/staging |
| 发布构建门禁 | `.github/workflows/linux-deploy-artifact.yml` | 现有权威流程构建 Server/Web/VoiceHub 的 Linux 制品，**不构建或签名 iOS**；不能作为 App Store 可上传证明 |

Apple 自 2026-04-28 起要求上传使用 Xcode 26 或更新版本及 iOS/iPadOS 26 或更新 SDK，见 [Apple 上传要求](https://developer.apple.com/news/upcoming-requirements/)。最终还须确认所选 Xcode/SDK 版本正被 App Store Connect 接受。

## 2. P0 —— 极有可能导致 Reject 或无法上传

### P0-01：不存在完整账户删除流程

- **问题**：SSO 首次登录自动创建站内账号；个人页只有退出登录、修改资料等，没有注销账户。后端没有 self-service account deletion API。
- **Apple Guideline / 规则**：5.1.1(v)，[Apple 账户删除要求](https://developer.apple.com/support/offering-account-deletion-in-your-app/)。关闭公开注册不豁免自动开户。
- **文件路径 / 代码位置**：`server/src/routes/auth.ts:198` 附近创建 User；`server/src/routes/user.ts:22` 起路由全表；`web/src/views/profile/Index.vue:43`；`server/prisma/schema.prisma:959`、`:1228` 等关系。
- **风险**：极易直接拒审。退出、断开教务、删除头像或联系客服均不等价于完整账户删除。
- **是否已修复**：否。
- **修复方式**：在个人页增加账户删除说明/确认和状态页；实现持久化删除申请与后台幂等任务，撤销所有会话/Widget/OAuth/机器人绑定，清除或匿名化个人资料、UGC、缓存、对象存储及 VoiceHub 映射，并回显处理结果。具体数据计划见第 5 节。
- **是否需要人工操作**：是。须确定交易/争议/审计记录保留依据、期限、执行责任和删除 SLA，然后实施及验证。Prisma 同时有交易 Cascade 和私信 Restrict，且文件/Redis/VoiceHub 独立存储；直接 `user.delete()` 会损坏交易追溯或删除失败。因此没有冒充“已实现注销”而加一个无处理后端的按钮，也没有擅自批量删库。

### P0-02：App 内数字权益使用外部支付/自有兑换机制

- **问题**：个人中心“赞助”发放 AI 点数；VIP 礼品码解锁去广告、装扮等数字权益。没有 StoreKit/IAP 交易验证或恢复购买实现。
- **Apple Guideline / 规则**：3.1.1、3.1.3；见 [Apple 审核规则](https://developer.apple.com/app-store/review/guidelines/#payments)。美国 storefront 的外链例外不能推广到中国大陆。
- **文件路径 / 代码位置**：`web/src/views/profile/Index.vue:157`、`:162`、`:228`；`server/src/routes/payments.ts:357` 至发放点数和成功通知；`web/src/views/profile/Vip.vue:35`、`:102`、`:152`；`server/src/routes/vip.ts`；`ios/cpuweb/WebViewContainer.swift:99` 的支付域名白名单。
- **风险**：高且线上可触发。HTTP 回读 `/api/payments/sponsor/options`：enabled=true、alipay/wxpay/bank、assistantPointsPerYuan=200；不是只存在于注释中的旧功能。自有码解锁也需纳入数字权益审查，不能假设“免费发码”即可绕过规则。
- **是否已修复**：否；未改变商业模式、未删除支付/权益。
- **修复方式**：由产品确定 iOS 数字商品策略。若在 App 内销售，接入 StoreKit、商品配置、后端验签与幂等发放、退款/撤销通知、非消耗品恢复；点数与永久权益分别建模。若选择合法的跨平台仅访问方案，须逐项满足适用例外，所有 iOS 入口和直达页保持一致，不能审核后再打开网页支付。
- **是否需要人工操作**：是。确认 storefront、合同税务、商品及退款模型；本仓库没有已获批的外部购买 entitlement 证据。

### P0-03：UGC 缺少用户屏蔽，资料内容治理不完整

- **问题**：已有内容举报、管理员封禁、异步审核，但无普通用户拉黑/屏蔽关系和发信端校验；头像/简介可直接保存，用户资料无独立举报 target。
- **Apple Guideline / 规则**：1.2；[UGC 规则](https://developer.apple.com/app-store/review/guidelines/#user-generated-content)。
- **文件路径 / 代码位置**：`web/src/components/messages/DirectMessages.vue:55` 的会话操作区及消息举报按钮；`server/src/services/directMessagePolicy.ts:1`；`server/src/services/forumReportPolicy.ts:1` 只允许 topic/reply/direct_message；`server/src/routes/user.ts:34`、`:73`；`server/src/services/userAvatarStorage.ts:8`；`web/src/components/common/UserModerationActions.vue:2` 仅供管理员。
- **风险**：已回复的骚扰者可继续发消息；两条陌生人限制不能替代拉黑；管理员封禁也不能替代用户屏蔽。匿名帖衍生私信增大骚扰风险。
- **是否已修复**：否。
- **修复方式**：持久化 block 关系；提供私信/用户页入口与解除列表；服务端拦截新会话和发送、通知投递，并明确论坛信息流屏蔽范围。匿名对象应由服务端映射真实主体，不能依赖 UI 返回的匿名 id=0。把 user/avatar/bio 纳入举报/审核/人工处理并保留审计记录。
- **是否需要人工操作**：是。确定匿名场景屏蔽语义、内容审核服务及运营响应安排；需数据库迁移和双账号全链路验证，不能用前端隐藏模拟完成。

### P0-04：第三方 AI 数据共享告知和明确同意缺口

- **问题**：当前政策主要描述主动 AI 对话，未完整说明私信/帖子/图片/昵称自动审核所用第三方、用途、处理/保留方式。没有找到覆盖这些共享的明确同意记录或发送前阻断链路。
- **Apple Guideline / 规则**：5.1.1(i)、5.1.2(i)；[数据共享规则](https://developer.apple.com/app-store/review/guidelines/#data-use-and-sharing) 明确涉及第三方 AI 的个人数据共享告知和事先许可。
- **文件路径 / 代码位置**：`web/public/privacy.html:173` 附近“第三方服务”；`server/src/services/directMessageSubmissionReview.ts:87`；`server/src/services/topicAiReview.ts:206`、`:224`、`:1002`；`server/src/services/imageModeration.ts`、`nicknameReview.ts`；`web/src/views/search/Result.vue:44` 仅隐私链接。
- **风险**：私信、图片、用户提交材料可能含个人信息；“会后台审核”不等于说明共享给谁并获得明确许可。
- **是否已修复**：否。常驻隐私入口已补，但不能因此宣称此项已解决。
- **修复方式**：核实实际启用的模型供应商/备用供应商、地区、留存和训练政策；披露数据项、目的和接收方；在发送/开启相关功能之前建立可追溯的明确同意，拒绝后提供适当替代或停止该项共享，后端同步验证。
- **是否需要人工操作**：是。运营方必须确认接收方及合同事实，不能编造隐私声明或随意写“不会向第三方提供数据”。

### P0-05：首次提交的 iOS 构建与 Reviewer 可用性没有证据闭环

- **问题**：没有已校验的签名 Archive/IPA/上传结果，也没有完整审核账号。工程元数据不能证明 SDK、权限和 Widget 真正可用。
- **Apple Guideline / 规则**：2.1、SDK 上传要求；[提交审核准备](https://developer.apple.com/app-store/review/guidelines/#app-completeness)。这是未完成的提交门禁，不是已证实发生了编译错误。
- **文件路径 / 代码位置**：`ios/ios.xcodeproj/project.pbxproj:425`、`:523`；`ios/README.md:45`；`web/src/views/Login.vue:18`、`:77`；`server/src/routes/auth.ts:155`；`.github/workflows/linux-deploy-artifact.yml`。
- **风险**：不能上传、扩展 entitlement 不匹配、审核员卡在学校账号/验证码/无课表，均可能阻断首次审核。
- **是否已修复**：否。Windows 环境无法完成这些操作。
- **修复方式**：用正式且 Apple 接受的 Xcode 26+ 完成 Release Archive、Distribution export 和 Validate App；两个 bundle 的 App Group/profile 一致；真机从清洁安装开始执行第 13 节路径。提供有授权的普通审核账户及学校数据体验途径。
- **是否需要人工操作**：是。Apple Developer/App Store Connect 权限、Mac、设备和有效审核账户均需提供/操作；不得将普通用户真实学校密码或课程数据公开到报告中。

### P0-06：主 App/Widget 原缺少 Privacy Manifest

- **问题**：两 target 都使用 `UserDefaults(suiteName: AppGroup)`，原仓库无 `PrivacyInfo.xcprivacy`。
- **Apple Guideline / 规则**：Required Reason API/上传隐私要求；[官方允许理由](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitypereasons)。
- **文件路径 / 代码位置**：`ios/cpuweb/CPUIOSBridge.swift:271`、`:308`；`ios/CPUWebWidgets/WidgetModels.swift:28`、`:290`；新增两个 target 目录下的 `PrivacyInfo.xcprivacy:5`。
- **风险**：缺理由会导致上传/隐私校验问题。
- **是否已修复**：**源码已修复；Archive 收录尚未验证**。
- **修复方式**：仅声明 `NSPrivacyAccessedAPICategoryUserDefaults`、`1C8F.1`，对应同一 App Group 的课表端点和主题共享；没有乱填其他理由、Tracking=false 或“无数据收集”。工程使用文件系统同步 groups，两文件置于对应目录且不在 membershipExceptions 内。
- **是否需要人工操作**：是。在 Archive 的 app 与 appex 中实际确认文件存在并生成 Privacy Report；XML 解析成功不等于 Apple 接受上传。

### P0-07：原生保存图片可能把登录 Cookie 泄露到外部图片域名

- **问题**：原实现取 WebView 的 allCookies，直接拼进任意图片 URL 的 Cookie 请求头；没有按域名/path/Secure 筛选。
- **Apple Guideline / 规则**：1.6、5.1 数据保护。
- **文件路径 / 代码位置**：`ios/cpuweb/CPUIOSBridge.swift:221` 的 `saveRemoteImage`。
- **风险**：保存外链图片时可能向不应接收登录凭据的主机传送 Cookie；不需要把正常变量名误当成泄露密钥才能确认此风险。
- **是否已修复**：**源码已修复，尚无 iOS 二进制/运行验证**。
- **修复方式**：限制 HTTPS 下载；使用临时 URLSession 的系统 Cookie store 处理 domain/path/Secure 和重定向，不再手工传全量 Cookie header；bridge 消息额外要求 HTTPS 主 frame。
- **是否需要人工操作**：是。在 iOS 使用受控同域鉴权图片、无 Cookie 的外域图片及跨域重定向验证请求头；不得向真实第三方泄露生产 Cookie 作测试。

## 3. P1 —— 建议提交前修复

以下“未修复”都属于剩余工作；不是因已出报告就降为可忽略。

| 编号 / 问题 | 规则 | 文件路径 / 代码位置 | 风险 | 是否已修复 / 修复方式 | 人工操作 |
| --- | --- | --- | --- | --- | --- |
| P1-01 现有测试/lint 非全绿 | 2.1、工程稳定性 | `server/tests/campusAssistant.test.ts`、`forumAuthorReputation.test.ts`、`jwxtGradeStats.test.ts`、`qqbotQrCodePolicy.test.ts`；`voicehub/package.json` lint | Server 500 项中 6 项失败；VoiceHub 116 errors/808 warnings。成绩统计有断言差异，不能一律认定为测试陈旧 | 未修复；按实际产品预期修复或校正测试，不能删测试/降低 lint 伪造通过。详见第 14 节 | 需核对成绩口径、服务开关等实际预期 |
| P1-02 学校密码和 AES key 同存 localStorage，默认勾选记住 | 1.6、5.1.1 | `web/src/utils/credCrypto.ts:1`、`:39`；`web/src/views/Login.vue:123`；`web/src/stores/auth.ts:349` | 同源脚本/XSS 可同时取到密钥与密文；退出后仍可回填。与政策“主动勾选”表述存在默认值差异 | 未改登录持久化行为；应优先复用受保护会话/学校续期，不保存学校密码；如保留必须明确选择及清除，原生长期令牌可评估 Keychain | 需确认产品记住登录策略及迁移，不能冒充已经采用 Keychain |
| P1-03 麦克风用途不明确，权限尚无拒绝测试 | 5.1.1、2.1 | `ios/cpuweb/Info.plist:51` 附近；`project.pbxproj:387`、`:450`；`WebViewContainer.swift` media permission 回调 | 文案只有泛称语音功能；Web/VoiceHub 未找到直接 getUserMedia/MediaRecorder 调用，点歌播放不需要麦克风 | 未擅自删除可能供系统文件拍摄/媒体捕获使用的权限；确认实际录制路径后明确用途或同时移除 plist/build settings 并拒绝未支持的捕获类型 | 需真机 Camera/Photos/Microphone 拒绝测试 |
| P1-04 其他平台/未完成工具信息进入 iOS | 2.1、2.3.10、4.2 | `web/src/layouts/MainLayout.vue:251`、`:606`；`web/src/views/Download.vue:8`；`web/src/data/serviceTools.ts` assessment-form；`server/src/routes/courseBot.ts:73` | iOS 仍能到多平台下载和 Windows-only 工具；旧 ai-answer 仅返回“敬请期待” | 问卷/反馈的过时“预留/后续”文案已修复；未删除 Windows 工具或机器人业务。应按实际 iOS 产品范围清晰处理入口和用途；旧 course-bot 不应作为已完成 iOS 核心功能宣传 | 需确认保留哪些跨设备业务；不按审核身份隐藏功能 |
| P1-05 音乐、学校品牌和第三方服务授权待证实 | 5.2.1—5.2.3 | `voicehub/server/api/music/resolve-url.post.ts:171`；VoiceHub 音乐代理/API；`web/src/assets/yaoda-can-fly/cpu-emblem.png`；SSO/场馆链接 | 仓库不能证明第三方音乐播放/解析、校徽/校历/地图及学校系统访问授权；无授权时可能升为直接拒审 | 未删业务；取得服务条款许可、音乐/图片授权，检查是否存在不允许的保存/转换能力 | 是；不能用开源代码 LICENSE 替代内容/平台授权 |
| P1-06 VoiceHub SMTP 关闭证书验证 | 1.6 | `voicehub/server/services/smtpService.ts:74`、`:81`、`:87`、`:92` | 邮件链路存在中间人风险；这是服务器 SMTP，不是 iOS ATS | 未更改生产邮件兼容策略；确认邮件证书/CA 后启用证书验证，避免用 false 绕过问题 | 需测试实际 SMTP 主机，不能仅以“TLS 已加密”视为安全 |
| P1-07 依赖 advisory 未清零 | 1.6、2.1 | `server/package-lock.json`、`web/package-lock.json`、`voicehub/package-lock.json` | npm --omit=dev：Server 11（4 high）；Web 8（5 high）；VoiceHub 58（29 high、5 critical）。不是 77 个已证实可利用漏洞，也不是 77 个独立 CVE | 未运行 npm audit fix --force。按实际调用和生产 bundle 先处理可达依赖；xlsx 无 npm 自动修复，部分建议会降级/重大变更；详见日志 | 需在隔离分支升级及业务回归；不要把构建依赖 advisory 全算成客户端运行漏洞 |
| P1-08 外部 HTTP 学校链接及地域可用性 | 2.1、1.6 | `web/src/views/services/Index.vue:110`；`web/src/components/jwxt/ExamsPane.vue:57`；`web/src/views/jwxt/Index.vue:361` | 学校 HTTP 链接目前能返回 200，但没有加密；海外/校园网/微信认证可用性未知 | 未全局替换成未经验证的 HTTPS；原生无 NSAllowsArbitraryLoads，外域交系统打开。逐个验证学校 HTTPS/SSO 跳转与海外可达性 | 是，需从审核可用网络实测 |
| P1-09 native bridge 外链及 Widget endpoint 信任范围较宽 | 1.6、2.5 | `ios/cpuweb/CPUIOSBridge.swift:193`、widgetEndpoint/normalizeEndpoint；`WidgetModels.swift:318` 附近 candidates | openExternal 依赖 canOpenURL、没有明确 scheme 白名单；非已知 Widget host 会原样保留。主 frame/host 校验降低风险，但同源脚本仍拥有桥能力 | HTTPS frame/Cookie 修复已完成；后续按实际支持的外部支付/分享和自建端点确定 allowlist，不能任意移除合法跳转 | 需确认使用范围并进行攻击/回归测试 |

## 4. P2 —— 优化项

| 问题 | 规则 | 文件路径 / 代码位置 | 风险 | 是否已修复 / 修复方式 | 人工操作 |
| --- | --- | --- | --- | --- | --- |
| 原生图片保存失败无提示 | 2.1 | `ios/cpuweb/NativeImageGallery.swift:94` | 用户认为按钮无响应 | 源码已修复：下载/权限失败和成功提示，保存中禁止重复点击 | 需 iPhone 验证 |
| Web 内容进程终止或主文档 4xx/5xx 缺少原生错误状态 | 2.1 | `ios/cpuweb/WebViewContainer.swift:160`、`:229` | 白屏/错误页缺少恢复入口 | 源码已修复：进入现有可重试错误页；没有假装能离线加载整个站点 | 需断网、进程终止、401/500 故障注入 |
| 原生 bridge/UA 版本硬编码 | 元数据一致性 | `ios/cpuweb/AppConfiguration.swift:8` | 后续包版本与站点识别版本不一致 | 已改为读取 CFBundleVersion/CFBundleShortVersionString | Archive 核对实际字符串；若未来 build 使用点分格式，再同步整型兼容约定 |
| 隐私只在部分页面可见、正式用户无法随时读注册协议 | 5.1.1(i)、1.2 | `web/src/views/profile/Index.vue:50`；`PrivacyPolicyNotice.vue:4`；新增 `web/public/terms.html` | 登录后难找到政策，旧用户协议只在开发注册弹窗 | 已加个人中心常驻链接，登录/注册通知中加入协议链接；将现有协议文字复制到独立公开页。没有声称现有条款已完成法务审查 | 需部署后回读 terms.html、补足第 6 节的政策内容 |
| 问卷等已实现功能仍写“预留/后续” | 2.1 | `web/src/data/serviceTools.ts:28`、`:42`；`web/src/views/services/Tools.vue:17` | 误导 Reviewer 为半成品 | 已改成与已有问卷编辑、填写、统计和导出匹配的说明 | 需 UI 验证 |
| 英文引导、辅助功能和 Dark Mode | 2.1、可用性 | `ios/cpuweb/ContentView.swift`、`web/src/styles/index.scss`、`web/src/utils/overlayViewport.ts` | 中文依赖、固定色页面、放大字号/横屏/键盘可能产生可用性问题 | 未做无关 UI 重构；已确认存在 safe-area/visualViewport/dark 相关实现，但不是视觉验收 | 需小屏 iPhone、大屏 iPhone、iPad、VoiceOver/大字和横竖屏验证 |

## 5. 登录与账号删除结论

### 5.1 登录方式和 4.8

| 方式 | 当前主 App 是否支持 | 依据 / 限制 |
| --- | --- | --- |
| 学校统一身份认证/SSO | 是 | `auth.ts:155`；本科/研究生来源自动识别，学校账号密码及必要验证码；成功自动开户 |
| 站内用户名密码 | 是 | Login“其他方式登录”、`auth.ts:45`；新生/毕业生/站务等已开立账号 |
| 微信 | 绑定、通知与功能授权，非主账号登录 | `server/src/routes/wechat.ts:91`、`:99`、`:107` 要求 authRequired；callback 消费绑定流程 |
| QQ | QQBot 绑定/通知，非主账号登录 | QQBot 绑定链路；VoiceHub 音乐服务账号也不是 CPU-web 主账号 |
| 手机号/邮箱验证码 | 未发现有效主账号注册/登录流程 | 数据模型有 email 或材料联系方式不等于有邮箱登录 |
| Apple / Google / Microsoft / Facebook 等 | 当前 CPU-web 主账号未接入 | VoiceHub 虽保留旧 OAuth 依赖/代码，但 `voicehub/server/middleware/auth.ts:61` 对旧 auth API 返回 410，唯一身份源为 CPU-web |
| 自建 OAuth provider | 有，给其他客户端授权 | `server/src/routes/oauth.ts` 是本产品输出 OAuth 授权，不是使用社交账号开户；使用 PKCE、一次性 code，redirect 校验目前为 origin 级，建议收紧注册路径 |

**当前登录体系不触发必须增加 Sign in with Apple 的要求。**主账号来自已有教育账号和自有账号系统；微信/QQ绑定没有替代主账号认证。对应 4.8 的教育账号/自有账号例外。若将来开启 Google/微信直接开户或恢复 VoiceHub 独立社交登录，必须重新评估，不能沿用此结论。

开发测试账号按钮在 `Login.vue:87` 受 import.meta.env.DEV 控制；生产是否误建为 DEV 必须结合部署制品检查。扫描发现的示例密码、测试 token、README JWT 示例均不能当作真实有效凭据；生产数据库有无保留默认测试账号，本次没有证据，须管理方确认并清理。未输出或虚构审核密码。

找回密码：未发现站内 self-service reset 流程。学校账号应使用学校正式恢复入口；普通站内账号需有可持续的恢复途径与审核说明。验证码有刷新、失败处理和 loading 的 finally 路径，但本次没有真实学校登录/验证码回归。不要在生产加通用验证码后门。

### 5.2 账户删除实施范围

建议先明确以下数据处置表，再实现事务/任务链；以下是待实施设计，不是已经存在的能力。

| 数据范围 | 删除时必须覆盖 | 已知约束 |
| --- | --- | --- |
| User、昵称/头像/简介、认证申请 | 删除或不可逆匿名化个人字段及非必要材料 | 自有对象存储删除不能只改数据库 URL |
| JWT/BrowserSession/JWXT/OAuth/Widget | 撤销活动凭据、Redis/持久化会话，停止课表续期，清除本机/App Group 旧课表 | Widget 令牌支持长期使用，必须显式撤销；删除主用户不能靠自然超时 |
| 帖子、回复、私信、举报 | 明确删除本人内容、对方消息保留及审计匿名化；处理计数/索引 | DirectConversation 对 User 是 Restrict；简单硬删会失败 |
| 文件收集、问卷、成绩表、反馈 | 清理账号关联及表单内身份字段、上传原件和导出文件 | 多个关联为 SetNull；取消外键并不等于删除表单内学号/姓名/IP |
| 支付/积分/VIP/退款/争议 | 按经确认的法定保留范围隔离保留，移除不必要个人关联 | SponsorOrder 等 Cascade 可能误删交易凭证，须设计不可登录的最小保留记录 |
| 微信、QQBot、VoiceHub | 解除绑定、停止推送、删除/匿名化独立数据库映射和活动记录 | 不是一个 Prisma 数据库，需跨系统任务重试/状态跟踪 |
| 备份/日志/缓存 | 明确保留时限、访问控制及到期删除，防止备份恢复后复活账号 | 不应承诺无法实际执行的“立即删除所有备份” |

删除应允许 App 内发起、清晰说明处理时间、处理完成反馈；安全再认证可以存在，但不能把学校账号失效/必须联系客服变成不合理障碍。删除站内账号不等于删除学校账号。

## 6. 隐私与权限结论

### 6.1 隐私政策实查

`https://cputime.cn/privacy.html` 匿名 HTTPS GET 为 200，Content-Type 为 text/html，实际包含“药大拾间隐私政策”，不是 SPA 空壳或登录页。源文件有 viewport 与 640px 响应式样式。本次新增“个人中心 → 隐私政策”常驻入口；尚未部署，因此不能声称线上入口已改变。

政策现有内容包括站内身份、教务登录、课表成绩、可选缓存、小组件、投稿/文件/认证、商城、AI/支付泛称及邮箱 `admin@lizmt.cn`。该邮箱来自仓库政策，未验证收件服务；不要将它直接当成已确认的 App Review 联系人邮箱。

应由运营方补齐/核对：

- iOS 原生客户端及 Widget 的适用范围，App Group 本地数据和令牌生命周期。
- 私信、头像、昵称、帖子、图片/视频审核及具体 AI 接收方；不是仅主动 AI 聊天。
- 文件收集保存 IP（`server/src/routes/tools.ts:821`、Prisma FileCollectSubmission.ip），登录活动统计、广告曝光/点击、VoiceHub 点歌/投票/播放及性能统计。
- 微信 OpenID/UnionID 等绑定标识、QQ 号码/机器人关联及第三方消息传输。
- 各数据的实际保留期限、注销流程、处理主体身份、第三方同等保护及跨境处理事实。
- “校园商城订单/加密收款资料”描述与当前退回论坛二手交流的产品范围存在历史差异；不能把未挂载旧 marketRouter 的能力说成当前全部开放。
- 记住登录默认 true、密码/key 同存本地，与“主动勾选”和清除方式的真实含义保持一致。

### 6.2 App Store Connect → App Privacy 推荐填写表

依据 [Apple 数据标签定义](https://developer.apple.com/app-store/app-privacy-details/)。这是按可确认代码行为整理的草案，**不是“无数据收集”声明**。只在设备本地使用且不发往服务端的数据，不自动计为 Apple 定义的 collected；可选数据也不能仅因可选就全部免申报。没有对自由文本内所有可能出现的信息类型进行无依据扩张。

| 数据类型 | 是否收集 | 关联用户身份 | Tracking | 具体用途 | 数据来源/SDK |
| --- | --- | --- | --- | --- | --- |
| User ID / 学号工号/站内用户名 | 是 | 是 | 未见用于 tracking | 账号、教育服务、权限、登录统计 | User、auth、JWXT、adminStats、VoiceHub 用户映射 |
| 姓名/昵称/认证名称 | 是，按使用功能 | 是 | 未见 | 账号展示、认证、表单处理 | User、AccountVerification、文件/问卷/成绩核对 |
| 邮箱/手机号等联系方式 | 按实际填写功能确认收集范围 | 通常是 | 未见 | 联系、认证、反馈/交易材料 | User.email、认证/表单自由填写字段；不是手机号登录 |
| 微信/QQ 等持久账户标识 | 是，绑定后 | 是 | 未见跨服务广告匹配 | 账号关联、通知 | WeChat HTTP API/QQBot 服务端，不是原生微信/QQ SDK |
| Photos or Videos | 是，上传时 | 是 | 未见 | 头像/帖子/失物/表单、内容安全 | Web 文件选择、原生相机/相册系统组件、mediaStorage/COS/OSS/AI 审核 |
| Emails or Text Messages（私信文本） | 是 | 是 | 未见 | 站内沟通、治理 | DirectMessage + AI 审核 |
| Other User Content | 是 | 登录投稿通常是；匿名不等于不可关联 | 未见 | 帖子/回复/反馈/问卷/文件/AI 对话 | Express/Prisma/存储/模型接口 |
| Other Data（教育记录） | 是，按授权功能 | 是 | 未见 | 课表、成绩、考试、课程关联、手工编辑云同步 | JWXT、ScheduleWidgetSession、持久/短时缓存；最终标签分类需确认 |
| Purchase History | 是 | 是 | 未见 | 赞助、点数、兑换、权益和账务 | SponsorOrder、积分台账、VipGiftCodeRedemption、易支付 |
| Payment Info | 待确认当前支付服务实际接收字段 | 视路径 | 待确认 | 支付；可能由第三方收银台直接处理 | 当前主站不证明收集完整银行卡号；旧 market 收款资料不能直接当作线上现况 |
| Product Interaction | 是 | 登录记录关联；广告日聚合未见直接用户 ID | 未见 | 登录次数、点歌/投票/游戏成绩、曝光/点击 | adminStats、ForumAd 日/设备类聚合、VoiceHub、YaodaFlight |
| IP/运行与安全信息 | 至少文件收集明确保存 IP；网关日志需确认 | 提交记录可关联 | 未见 | 安全、故障排查 | FileCollectSubmission.ip、反向代理/托管平台日志 |
| Performance Data / Other Diagnostic Data | VoiceHub 集成存在，实际发送需人工确认 | SDK 文档称匿名；须核对实际配置 | 未见证据可认定 tracking | 性能统计 | `@vercel/speed-insights`，`voicehub/app/layouts/default.vue:5` |
| Search History / Browsing History | AI 对话/音乐交互有持久行为；一般搜索历史不能直接断言全部收集 | 视功能 | 待核实 | 搜索、AI 答复、使用统计 | search/campusAssistant/VoiceHub；需对服务端日志和 SDK 路由数据做最终核对 |
| Device ID / IDFA | 未发现原生采集 | 无已确认来源 | 未见 | 不建议凭猜测勾选 | 未发现 ASIdentifierManager/IDFA/广告归因 SDK；device 字段是设备类别，不等于设备唯一标识 |
| 精确定位、通讯录、健康、运动、生物识别 | 未发现主 iOS 客户端系统采集 | 不适用 | 不适用 | 不建议填写“收集” | 无对应 native entitlement/API；校园选择或 IP 不等于 GPS 定位 |
| 推送 token | 未发现 APNs 注册 | 不适用 | 不适用 | 当前站内/QQ/微信消息不能宣传为原生 APNs 推送 | iOS 无 aps-environment/UNUserNotificationCenter 注册链 |
| 本机主题/草稿/本地 PDF/背景图 | 仅本机的部分不按收集填写 | 本地可能关联 | 无已见 tracking | 个性化、本地处理 | Web Storage、浏览器 PDF、App Group；上传/云同步部分按对应行申报 |

### 6.3 SDK/服务清点与 ATT

原生 Swift 工程没有发现第三方 SPM/Pods/framework 依赖清单；import 为 Apple 系统框架。没有 Firebase、Sentry、Umeng、Bugly、高德/百度、极光/个推、IDFA/ATT 原生 SDK 集成证据。**服务端和 Web 依赖不能因此被忽略。**

| 依赖/服务 | 实际角色 | 隐私审查结论 |
| --- | --- | --- |
| Vue/Pinia/Element Plus/Axios/DOMPurify/dayjs/echarts/qrcode | UI/传输/清洗/格式化 | 不因安装就断言对供应商自动上报；请求数据按实际调用归类 |
| pdf-lib/pdfjs/jszip/xlsx | 文档本地处理/文件功能 | 本机处理与上传路径分开；另有依赖安全问题 |
| COS/ali-oss/腾讯云/阿里云 SDK、PostgreSQL/Redis | 后端存储与运维 | 需确认实际供应商、区域、访问权限、日志和保留；不是原生追踪 SDK |
| AI 模型 HTTP API | 对话和多类内容审核 | 必须披露真实接收方，完成 P0-04；配置/备用服务不等于全部实际同时启用 |
| 易支付/收银台 | 赞助付款 | 收集订单/金额/支付状态；第三方网页直接采集什么需人工确认；另有 P0-02 |
| Vercel Speed Insights | VoiceHub 默认布局插入 | [供应商说明](https://vercel.com/docs/speed-insights/privacy-policy) 涉及路由、URL、设备/浏览器、国家和 Web Vitals，称不识别个人。自托管脚本是否实际成功发送，须网络证据，不能武断填已停用或 tracking |
| 网易/QQ/Bilibili 音乐服务接口、artplayer/歌词播放器 | 搜索/解析/播放/点歌 | 第三方媒体请求可能见 IP、UA/必要服务凭据；授权、Cookie、播放记录需确认，不代表使用 Apple Music/MusicKit |
| simplewebauthn、crypto-js、otplib 等 VoiceHub 依赖 | 旧账号/加密能力 | 不能仅据依赖名宣称 iOS 支持 Face ID/Passkey；CPU-web 模式关闭旧账号 API |

**ATT 结论**：主 iOS 源码未发现 IDFA、ATT 请求、广告归因或已证实的跨 App/网站广告身份匹配；不能仅因有自营广告或性能分析就认定 tracking。目前没有依据新增 ATT 弹窗，也不能在未核对广告落地页/供应商前作覆盖全服务的绝对“不 Tracking”声明。最终确认无 Apple 定义 tracking 后，ASC 应填否；若存在，则须先补完整 ATT 与拒绝后的行为。详见 [Apple Tracking 定义](https://developer.apple.com/app-store/user-privacy-and-data-use/)。

### 6.4 系统权限逐项

| 权限 | 声明/调用 | 结论 |
| --- | --- | --- |
| Camera | Info.plist + project build settings；Web image 文件选择 | 场景为上传校园图片；文案可进一步指明头像/帖子。没有启动即申请全部权限的调用证据；真机取消/拒绝未测 |
| Photos Add | NSPhotoLibraryAddUsageDescription；`ImageStore.saveToPhotos` requestAuthorization(.addOnly) | 保存时申请，最小 add-only；错误反馈已补。不能据此添加整库读取权限 |
| Photos Read | 未声明整库权限，使用系统文件/照片选择 | 未发现原生枚举照片库，不机械补 NSPhotoLibraryUsageDescription；需在目标 iOS 版本验证 chooser |
| Microphone | 有 Usage Description，media capture delegate 可 prompt | 泛化文案与可用录音功能尚未对应；P1-03 |
| Location / Bluetooth / Contacts / Calendar / Local Network / Motion / Face ID / Speech / Health | 未发现主 iOS 声明和对应调用 | 不增加无用途权限；显示课表并不是写系统 Calendar；播放音乐不是请求麦克风 |
| Notifications | 无 APNs/UNUserNotificationCenter 链路 | 不宣称已实现原生推送；站内消息及微信/QQ 另行披露 |
| Tracking | 无 ATT/IDFA 接口/Usage Description | 见上节；不无缘无故索权 |
| App Groups | 两个 entitlements 为 group.cn.lizmt.cpuweb | Widget 必需；非用户授权弹窗，需 Distribution profile 确认 |

## 7. Privacy Manifest / Required Reason API

本次对所有 `ios/` Swift 调用了 UserDefaults、文件属性/时间戳、boot time、disk space、active keyboard、底层 stat/mach 等扫描并阅读调用上下文。

| 类别 | 实际发现 | 声明决定 |
| --- | --- | --- |
| UserDefaults | 主 App 写 Widget endpoint/theme；Widget 读同组配置 | 两 target 新增 1C8F.1；不是访问全局/system defaults，不填其他理由 |
| File timestamp | 没发现读取文件创建/修改时间 API | 不因 FileManager 读写文件、设置保护属性就乱填 timestamp 理由 |
| System boot time | 未发现 | 不填 |
| Disk space | 未发现主 iOS Required Reason API 调用 | 不因 UIImage 保存失败需提示空间就虚构调用 |
| Active keyboard | 未发现原生调用 | Web visualViewport/键盘布局不是该原生 API 声明证据 |

两个 manifest 只覆盖已验证的 Required Reason API。没有擅自写空收集列表或 false 声称所有业务不收集数据。第 6 节整体隐私申报和第三方服务核查仍需完成。

`flutter_client/` 是不同工程，依赖 webview_flutter/url_launcher 与 Flutter runtime；如果改用 Flutter 包提交，应重新审计其 SDK/插件 manifest、签名、AppIcon、版本和原生权限，不能把本次 Swift 两个文件复制过去就宣称通过。Flutter 在 [Apple 第三方 SDK 要求清单](https://developer.apple.com/support/third-party-SDK-requirements/) 内。当前没有 Flutter Archive 证明其最终嵌入 SDK 清单。

## 8. 支付/IAP 合规结论

| 场景 | A/B 分类 | 当前行为 | 结论 |
| --- | --- | --- | --- |
| 赞助获得 AI 点数 | A：数字服务额度 | 线上 ¥1→200 点，外部收银台 | P0；改名赞助/捐赠不改变权益性质 |
| 永久 VIP 去广告/头像框/主题 | A：数字功能 | 自建礼品码及兑换链接激活 | P0；需设计符合规则的获取渠道；恢复非消耗权益不能靠再次输入自有码代替 StoreKit 恢复 |
| 纯无对价赞助/众筹 | 需独立判定 | 当前实际有对价，不能按纯捐赠假设 | 不能把个人运营项目当成获 Apple 认可的非营利机构；是否保留和如何展示由产品/法务决定 |
| 论坛二手实物交易 | B：App 外实体商品/现实交易 | 论坛帖子/联系方式/私信 | 实物不应改为 IAP；仍需 UGC/交易规则，不能和数字资料混为一类 |
| 旧商城电子资料/电子交付 | A，如果重新开放 | `server/src/routes/market.ts:65`、`:840` 存在数字交付+外部支付，但当前 `routes/index.ts` 未挂载 marketRouter；Web 老市场路由重定向到论坛 | **残留代码/重开风险，不宣称当前有可用在线电子商城结账**。重新开放前纳入 IAP 审查 |
| 问题悬赏奖励 | 平台赠送积分 | `server/src/services/questionBounty.ts` | 不等于用户购买；区分免费获得与付费充值，核对可使用的数字权益 |
| 付费课程/订阅 | 未确认当前有效销售路径 | 未发现 StoreKit 或完整原生订阅 | 不编造商品/恢复购买流程；上线新的数字收费必须重新评估 |

应核对 iOS 首屏、个人中心、赞助墙、VIP 页、链接直达和支付回调，统一遵循实际 storefront 规则。禁止按“审核账号”切换业务，禁止审核后通过远程网页打开未申报支付。

## 9. UGC 合规结论

UGC 包括论坛帖子/回复/图片、个人头像/昵称/简介、二手信息、失物/认领、私信、问卷/文件/反馈、赞助留言，以及 VoiceHub 点歌/评论等；不是只有论坛正文。

| 要求 | 实查结果 |
| --- | --- |
| 文本/图片/视频过滤 | 存在 topicAiReview、imageModeration、videoModeration、nicknameReview 和异步提交队列；配置开关、白名单、失败兜底会影响实际效果，不能仅因文件存在就称所有内容已过滤 |
| 举报内容 | topic/reply/direct_message API 与 UI 均存在；不同账号达到阈值可临时隐藏帖子/回复，私信不按该阈值自动隐藏 |
| 举报用户/头像/简介 | 当前 target 类型未覆盖，需补 |
| 管理员处理/禁言封禁 | forumReport 管理接口、UserModerationActions、auth 状态校验存在 |
| 用户屏蔽 | 未实现持久化屏蔽关系和发送端校验，P0 |
| 公共联系方式 | 隐私页有 admin@lizmt.cn；实际收件、响应安排待确认 |
| 社区规则/协议 | 存在简短注册条款，本次新增随时可读的公开协议页；细化骚扰/色情/未成年/违法/申诉规则及处理时限仍需运营确认 |
| 匿名聊天 | 有帖子关联的匿名私信作用域；未发现随机配对陌生人聊天。不能把它误报为 Chatroulette，但也不能忽略匿名骚扰风险 |
| 删除本人内容 | `topic.ts:919`、`reply.ts:391` 有删除接口；本次未用真实帖子做删除演练 |

用户头像采用直接保存；管理员能封禁并不证明头像发布前已审。VoiceHub 公开点歌/评论、歌曲封面/歌词和赞助留言应按各自可见性复查，不可直接继承论坛的审核结论。明确值守人员和可演示的处理回执比只在协议里写“我们有权删除”更重要。

## 10. Guideline 4.2 Minimum Functionality 风险

**风险：中。**主界面主体确实加载远程网站；但已有与课表核心业务相关的 WidgetKit（多个尺寸/布局）、App Group 共享、课表缓存、Widget 深链、原生图片浏览/保存、系统文件选择、原生返回手势/网络错误恢复。这些是实质性平台集成，不能简单定性为零原生价值。

风险仍来自：完整页面依赖在线站点；初次无网没有本地完整产品；很多功能转去学校网站/微信/其他平台；Reviewer 若无法学校登录就看不到最有价值的课表/Widget。原生导航仍围绕 Web history，不等于全原生业务页面。

建议用实际 Release 包向 Reviewer 演示课表/Widget 及缓存离线能力、主屏深链、图片/文件交互。不要为了凑数增加无关生物识别或权限；不要把当前不存在的 APNs、原生登录、完整离线能力写进商店描述。

### 10.1 网络、安全、完整性与 UI 复核

- 原生没有 ATS 任意加载例外，未发现私有 API/dlopen/dlsym/热更新原生二进制执行。`evaluateJavaScript` 用于桥和 Web history；加载自己的 Web JS 本身不等于非法动态执行原生代码。远程增加重大未审功能仍须重新提交；小游戏/工具还须结合 4.7 适用性核对。
- `cpuweb://schedule` 仅映射课表并读取少量 query，不携带 OAuth 登录凭据；custom scheme 可能被其他 App 注册，当前未发现用它接收秘密。没有 Universal Links entitlement，不宣称支持 Universal Links。
- Web token 主要走 HttpOnly Cookie 会话和 CSRF，后端校验用户存在/封禁并处理续期；兼容旧 Bearer/localStorage 存在。Widget endpoint token 存 App Group 文本/UserDefaults，不是 Keychain；文件有保护设置但本机可读凭据应进一步按最小权限评估。
- 凭据扫描产生 66 个候选，已区分测试样本、README 示例、脚本变量插值和业务模板；未发现可确认真实有效的硬编码 provider key/private key。`.env` 被忽略，未输出值；没有进行 Git 全历史泄漏审计，不能保证过去无泄露。
- API 有 15 秒 timeout、401 清状态/事件，课表有缓存兜底，profile/私信有错误重试。原生进程终止和主文档 HTTP 错误处理已修补。仍需验证 Vue 首屏脚本加载失败、等待学校 SSO、极慢网络、会话失效、恢复登录、非当前用户旧缓存等状态。
- 文案扫描 10 个关键词命中已分类：admin/迁移欢迎语、变量名 todo 不等于公开占位页；旧 course-bot ai-answer 是真实未完成接口；工具说明的“预留/后续”已修复。没有批量删除 placeholder 属性、Widget placeholder 或正常空数据态。
- App Icon 已实际查看：1024×1024、24-bit RGB、没有透明像素；是绿色底白色列表/橙色勾图形，未见 Apple 标志。asset 采用现代单张 universal iOS icon，不能因为未列旧式多尺寸就判定缺图。最终仍需 asset 编译/Archive 校验。
- 主 App Display Name“药大拾间”、Widget“药大拾间课表”；LaunchScreen + SwiftUI 加载/错误页存在；内部 PBX productName=MyApp 不等于用户可见名称。英文元数据未知。未发现面向普通用户的 Beta/内部版文案；有多平台下载推广风险。
- 已有 iOS safe-area、横竖屏声明、visualViewport 对话框、dark 外观实现。未获得 UI 画面证据，不能声称所有 iPhone 尺寸、Dynamic Island、Dark Mode、大字、键盘遮挡已通过。

## 11. 中国大陆 App Store 合规事项

**中国大陆上架检查：需人工确认。**没有把“教育/校园工具”自动视为所有资质豁免，也没有把存在小游戏等同于已经被主管部门认定为网络游戏。

| 项目 | 当前证据 / 所需操作 |
| --- | --- |
| 分发地区 | 【需要人工填写】最终 storefront；本报告特别按可能在中国大陆分发评估 |
| APP ICP 备案 | 生产 `/api/site/config` 展示 `粤ICP备2026117069号`。这是网站配置显示值，**不是已核验 APP 备案证据**；不能直接填成 APP 备案或宣称 MIIT 已验证 |
| App 名称/主体一致性 | 【需要人工填写】核对备案中 App 名称、主体与 ASC 简体中文元数据及实际运营主体 |
| 开发者主体 | 【需要人工填写】个人/组织类型、合法中文名称、开发者协议及 App ID 权属 |
| D-U-N-S/统一社会信用代码 | 【需要人工填写】组织账号需与 D&B、Apple 展示的中文公司名称/USCI 核对；不要杜撰公司资料 |
| 游戏 | 存在“药大人能飞”“番茄鸡蛋面”“药大人大战僵尸”“合成药大奶”“药大人能吃”“清扫药大雷”六款可玩小游戏（入口为“小游戏”合集）和云端成绩/成就。需就分发形态、游戏审批/版号适用性取得明确意见；不能填写“完全不含游戏” |
| 新闻 | 有校园公告/新闻外链/爬取展示。是否构成互联网新闻信息服务由实际内容运营方式决定，代码无法证明许可或豁免 |
| 宗教 | 未发现专门宗教服务，仍需确认实际 UGC/运营范围，不编造许可证 |
| 出版/图书杂志 | 旧商城有电子书/资料定义但未挂载；现有音乐/内容展示及今后电子出版业务应分别核对版权/许可 |
| 其他 | 学校数据访问和品牌授权、个人信息处理、AI 服务/算法相关要求、音乐传播授权等由运营主体确认；不凭本报告认定全部豁免 |

参见 [Apple 中国大陆 App 信息要求](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/) 和 [主体合规展示信息](https://developer.apple.com/help/app-store-connect/manage-compliance-information/view-mainland-china-compliance-information/)。备案号、许可证、主体联系方式均不能由代码自动推断。

## 12. App Store Connect 人工填写清单

下列文案仅依据仓库已有功能拟稿，须按整改后的实际产品、版权与品牌许可定稿，不能宣传尚未实现或未经授权的能力。

| 字段 | 推荐草案 / 人工事项 |
| --- | --- |
| App Name | 药大拾间；英文名【需要人工填写】，核对占用和商标 |
| Subtitle | 课表、校园互助与常用工具 |
| Description | “药大拾间面向中国药科大学校园用户，提供课表查看与桌面课表小组件、校园交流、失物招领、问卷及文件工具。部分功能需要已有学校账号或站内账号。学校相关信息请以学校正式通知为准。” 按最终范围补充音乐/小游戏及收费说明，不暗示学校/Apple 官方出品 |
| Keywords | 课表,校园,课程表,校园互助,失物招领,问卷；最终长度/品牌词许可人工确认 |
| Support URL | 【需要人工填写】公开移动支持页，能直接找到联系方式；现有隐私邮箱可参考但未核实收件，不编造 /support 已存在 |
| Privacy Policy URL | https://cputime.cn/privacy.html（当前已回读）；必须先完成内容整改 |
| Marketing URL | 可选 https://cputime.cn，须核对上线后的产品介绍 |
| Category | 建议先评估“教育”，可选辅助分类按最终产品；不是代替游戏/新闻/出版资质判断 |
| Age Rating | 【需要人工填写】按现行 ASC 问卷如实申报 UGC、私信、广告、网页内容、AI、小游戏等，由系统计算；“大学用户”不自动等于 18+ 或无未成年人 |
| Copyright | 【需要人工填写】年份及实际权利人；不能用学校名称冒充授权主体 |
| Screenshots | 【需要人工填写】实际 Release 包 iPhone/iPad 截图：课表、Widget、校园工具、论坛治理/个人中心等；使用授权测试数据，不使用真实学生成绩/私信 |
| App Review Contact | 【需要人工填写】姓名、可联系邮箱、电话（含区号），不是猜测管理员邮箱对应联系人 |
| Demo Account | 【需要人工填写】普通审核账户和密码、第二个 UGC 测试账户、学校功能授权条件；见第 13 节 |
| Review Notes | 见第 13 节草案；说明 SSO、原生价值、付费/UGC 和特殊依赖；不要说未完成项已通过 |
| App Privacy | 使用第 6 节草案，核对各服务后录入；保存截图/版本证据 |
| Export Compliance | 按下一节完成真实分类和必要文件，不能因为用了 HTTPS 就勾“没有加密” |
| Content Rights | 【需要人工填写】音乐、封面/歌词、校徽/地图/校历、学校服务与用户内容授权 |
| 中国大陆供应资料 | 【需要人工填写】APP 备案及适用特殊许可、主体中文名称、D-U-N-S/USCI 等 |
| 版本/构建/销售协议 | 【需要人工填写】ASC App 记录、未使用的 build 号、签名、IAP 协议/税务/银行信息、价格和地区 |

### 12.1 App Store Connect Export Compliance 填写建议

实际使用：WKWebView/URLSession HTTPS/TLS；Web Crypto AES-GCM 和 RSA-OAEP（`web/src/utils/credCrypto.ts`、`agentCredentialCrypto.ts`）；后端 Node crypto/JWT/bcrypt、会话加密和支付签名；VoiceHub 依赖 crypto-js、音乐协议加密等。未发现主原生客户端提供 VPN、SSH、CryptoKit 自研加密工具或端到端私信；私信由服务器审核，不能宣传 E2EE。

系统 TLS/Web Crypto 的实现来源与服务器专用加密应区分；不能仅因服务器有 AES 就声明 App 包含非豁免自研密码学，也不能忽略远程 WebView 实际执行的第三方 JS 加密。

按 [Apple 出口合规概览](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance/) 和 [加密文档要求](https://developer.apple.com/help/app-store-connect/reference/export-compliance-documentation-for-encryption/) 确认实际 App 交付/加载的加密实现与目标地区。若核实仅使用系统提供或其他符合豁免条件的加密，可设置 `ITSAppUsesNonExemptEncryption = NO`；这不代表“没有加密”。如有非豁免能力，回答 YES 并完成相应文档流程；法国分发另核对适用材料。**本次未武断写 YES/NO，Info.plist 未新增该项**；提交时必须完成判定。

## 13. App Review 测试账号及 Reviewer Notes 建议

### 13.1 App Review 测试账号需求

- 【需要人工填写】普通站内审核账号/密码，角色不能设为 admin/mod；否则会绕过真实的访问/审核限制。
- 【需要人工填写】第二个测试用户，以及隔离且可清理的测试帖子/图片/私信，用于发布、举报、屏蔽、删除流程。
- **普通站内账号不足以完整验证学校课表/成绩/考试和原生 Widget。**需有经学校/数据主体授权的测试教育身份及有效课程数据；或事先与 Apple 沟通并获同意的全功能演示方式。不能借用未经授权的真实学生密码，不能伪造“免验证码”条件。
- 【需要人工填写】验证码/SSO 额外条件、学校系统维护时段和境外网络限制说明。应用应不依赖审核员有中国手机号、现场校园网络或个人微信身份才能完成所有核心测试。
- 【需要人工填写】可删除的专用账号和正确的处理时限；当前注销流程缺失，不能让审核员测试一个不存在的按钮。
- 若采用 IAP，配置审核可访问的商品/沙盒交易说明及恢复流程；当前未接入，不提供虚构商品 ID。
- 不使用开发页 alice/bob/admin 作为正式 Reviewer 凭据，不在仓库保存审核密码。

### 13.2 Reviewer 操作模拟记录

下表是**代码走查 + 已列出的 HTTP 探测结果**。因无 iOS 运行环境且浏览器控制超时，未把静态模拟冒充实际端到端操作。

| 操作 | 实查发现 | 状态/可能卡点 |
| --- | --- | --- |
| 安装 Release App | 有 scheme/target，无签名 Archive | 未执行；Mac/签名门禁待完成 |
| 首次启动 | appURL 正式 HTTPS，SwiftUI loading/error、Web 路由探测 | 主页 HTTP 200；native/JS 首屏未实测；启动阶段权限没有集中索取证据 |
| 隐私/协议 | 登录页政策链接，新增协议链接/个人常驻入口 | 线上 privacy 已回读；新 terms 需部署后检查；不存在完整 AI 共享明确许可流程 |
| 注册 | 公开注册关闭，SSO 首次自动创建账号 | 不应误认为没有开户；无法访问学校身份的 Reviewer 会卡住 |
| 登录 | SSO + 其他方式账号；验证码刷新、请求错误处理 | 未用有效审核账号实测；独立账号能登录不代表能拿到学校数据 |
| 首页/核心功能 | 课表/教务/校园工具、论坛等路由存在 | 当前线上 forumLoginRequired=true；coursesreview=false；需按实际开关测试，不因关闭功能假定空白 bug |
| 用户资料/设置 | 资料、头像、密码、VIP、外观、赞助 | 有重试/保存状态；头像缺完整审核；多平台入口可能干扰 iOS 体验 |
| 隐私政策 | 匿名 GET 返回实际政策正文 | HTTP 通过；移动视觉和新常驻入口未 UI 实测 |
| 用户协议 | 原只在开发注册弹窗；本次新增公开页 | 本地文件和打包检查；线上尚未发布 |
| 注销账户 | 没有入口/API | **失败（静态确定缺失）** |
| 退出登录 | auth/logout 撤销当前会话，客户端清理登录状态 | 存在代码；本机记住的学校凭据/Widget 清理语义需另查，不等于删账户 |
| 发布→举报→删除 | 有发帖/回复、审核队列、举报及本人删除 API | 未在生产发帖或删真实数据；需双测试账号验证 |
| 屏蔽用户 | 缺 UI/后端持久关系 | **失败（静态确定缺失）** |
| 付费页面 | 个人赞助→第三方收银台；线上支付配置启用 | 未实际支付；数字权益合规 P0 |
| 恢复购买 | 无 StoreKit/IAP | 无可测流程；不能把 VIP 兑换写成恢复购买 |
| 无网/401/500/重启 | Web 15s timeout、缓存、错误态；native 错误处理已补 | 故障注入、长时间后台、同账号重装、换账号缓存隔离均待真机 |

已执行 HTTP：`/`、`/login` 为 200 的 SPA HTML；`/privacy.html` 为 200 且含实际政策；`/voicehub/` 为 200 SSR HTML；`/api/health`、`/api/site/features`、`/api/site/config`、`/api/payments/sponsor/options` 成功。**SPA 200 不证明某个核心页面已渲染。**探测中 `/api/site`、`/api/payments/sponsor/config` 为 404，随后依据代码定位到正确路径；前两者不是 App 使用的 API，因此不误报为产品死链接。

学校 `http://lib.cpu.edu.cn`、`opac.cpu.edu.cn`、`jwc.cpu.edu.cn`、`news.cpu.edu.cn` 和 `https://cgtst.cpu.edu.cn/wap` 本地匿名 GET 200；前四个最终仍为 HTTP。这不证明海外/微信内认证或所有动态链接可用；991 个 URL 文字命中含测试/示例/接口模板，不伪称全部链接已在线访问。

### 13.3 Reviewer Notes 草案（整改完成后填写）

> 药大拾间面向中国药科大学校园用户，提供课表、小组件、校园互助与常用工具。
>
> 测试账号：【需要人工填写】；密码：【需要人工填写】。通过登录页“其他方式登录”进入。学校课表数据测试方式：【需要人工填写，普通账号不自动具备学校教务权限】。
>
> 原生功能：在课表页更多菜单配置 iOS Widget，然后在系统小组件图库添加“药大拾间课表”；点击 Widget 可返回课表。图片可在 App 内预览并保存到相册。
>
> UGC 测试：测试帖子/第二账号/举报与屏蔽路径【需要人工填写，完成 P0-03 后说明】。
>
> 账户删除：【需要人工填写，完成 P0-01 后说明实际入口、时限和数据处理】。
>
> 收费与恢复购买：【需要人工填写，完成 P0-02 后按实际 IAP/适用例外说明】。
>
> 联系人、电话及可及时响应的邮箱：【需要人工填写】。

不要将该草案原样提交；占位项必须全部替换，所有功能描述要和真正提交的版本一致。

## 14. 最终提交前 Checklist

`[x]` 仅代表注明范围已完成；`[ ]` 尚未完成；`[!]` 需要人工确认。后两类不能视为通过。

* [x] 识别全部主要项目/技术栈，区分 Swift 正式入口与 Flutter 替代工程。
* [x] 全仓文本扫描及核心链路审阅，保留原有不相关工作区改动。
* [x] 查询当前 Apple 规则、SDK、隐私、账号删除及大陆信息要求。
* [x] 原生 Cookie 请求修复、HTTPS frame 校验及静态复查。
* [x] 两个 target 新增与 App Group 实际用途匹配的 manifest，XML 解析通过。
* [x] 原生保存反馈、进程终止/主文档错误恢复和 Bundle 版本读取源码修复。
* [x] 个人中心常驻隐私/协议链接，公开协议文件；修正工具过时文案。
* [x] 当前生产隐私页、健康接口和真实支付配置 HTTP 回读。
* [x] App Icon 尺寸/透明度/视觉检查。
* [x] 执行 Server/Web/VoiceHub 本地 Build、typecheck、VoiceHub lint、Server/Web 现有测试及依赖 advisory 检查，完整记录失败。
* [ ] Server 现有 6 个失败测试和 VoiceHub lint 116 errors 处理完毕。
* [ ] 完整账户删除 API、后台数据处理和 App 内流程完成并端到端验证。
* [ ] iOS 数字支付、VIP 兑换和 IAP/适用例外方案完成。
* [ ] UGC 用户屏蔽、资料举报/审核和运营闭环完成。
* [ ] AI 数据共享告知、接收方核实和明确同意链路完成。
* [ ] 依赖安全升级/调用可达性、学校凭据存储及 SMTP TLS 问题处理完成。
* [ ] 本次 Web 改动经明确部署授权后发布并回读；本次没有生产部署授权。
* [ ] Mac 上实际用 Apple 接受的 Xcode 26+/iOS 26+ SDK 构建签名 Release Archive。
* [ ] Archive 内 app/appex 的 manifest、签名、App Group、版本和 SDK 校验通过。
* [ ] App Store Connect Validate/上传处理成功，未使用开发证书导出正式包。
* [ ] iPhone/iPad 清洁安装、冷启动、离线、权限拒绝、Dark Mode、键盘/安全区及 Widget 测试完成。
* [ ] 使用专用普通审核账号完成第 13 节全部真实操作，不靠管理员权限绕过。
* [!] 审核联系人/账号/学校数据权限与境外可用性确认。
* [!] App Privacy、内容权利、年龄分级和 Export Compliance 按最终实现核实。
* [!] 中国大陆 APP 备案、主体/名称/D-U-N-S/USCI 和游戏/新闻/出版等适用资质确认。
* [!] 最终商业、法律和上架提交动作由有权限的主体确认；此报告不是 Apple 通过保证。

### 14.1 执行的验证与结果

证据目录：`output/app-store-audit-20260907/`。未提交的本地日志不是官方生产制品。

| 验证 | 命令/证据 | 结果 |
| --- | --- | --- |
| 全量本地 Build | `npm run build`；build.log / build-final.log | Server、Web、VoiceHub 均通过，exit 0；最终隐私链接位置复查后另跑 Web build |
| Typecheck | `npm run typecheck`；typecheck.log / typecheck-final.log | Server tsc + Web vue-tsc 均通过，exit 0 |
| Server 测试 | server 目录 `node --import tsx --test tests/*.test.ts`；server-tests.log | **500 tests，494 pass，6 fail，0 skipped** |
| Web 测试 | web 目录 `node --import ../server/node_modules/tsx/dist/loader.mjs --test tests/*.test.ts tests/*.test.mjs`；web-tests.log | **132 tests，132 pass** |
| VoiceHub lint | `npm run lint --prefix voicehub`；voicehub-lint.log | **116 errors、808 warnings，exit 1** |
| npm 依赖审计 | 三目录各执行 `npm audit --omit=dev --json` | Server 11 / Web 8 / VoiceHub 58；原始 advisory 保存在 *-dependencies.json |
| plist/manifest | PowerShell XML 解析两个 Info、两个 entitlements、两个 manifest | 6 个 XML 均可解析；只证明语法，不代表签名/上传已校验 |
| 本次变更空白检查 | 对选择性修改文件执行 `git diff --check` | 通过；未替用户清理 Harmony 原有生成日志的空白问题 |
| iOS Build/Archive/UI | 检查当前工具链；浏览器控制两次初始化超时 | **未完成**；没有 Xcode、Simulator 或签名 iPhone 运行证据 |

Server 失败具体为：AI 配额/模型 reload 后恢复设置；桌面安全微伴默认开关；移动回复编辑器源码断言；两项成绩统计（补考/等级成绩）；QQBot 关闭二维码帮助断言。没有在本次审计里改动这些业务规则或删除测试来消除失败。需分析真实行为和测试预期后再决定修复。

### 14.2 独立 Reviewer 视角第二轮 P0 复查

第二轮不以“已写代码/能 build”为通过依据，重新沿着可见功能、API 挂载和上线状态核验：

1. **注册关闭是否使注销豁免？否。**重新核对 SSO 的 User.create；P0-01 保留。
2. **赞助是否只是无对价支持？否。**重新回读线上 options，确认 200 点/元；P0-02 保留。旧 marketRouter 没挂载，不将旧电子商城冒充线上结账问题。
3. **管理员封禁/两条消息限制是否等于用户拉黑？否。**重新核对会话菜单、policy、Prisma 关系与 report target；P0-03 保留；匿名帖子衍生私信必须一起处理。
4. **有隐私 URL 是否代表隐私完整？否。**重新追踪私信→AI 审核，发现除主动 AI 聊天外的共享未充分覆盖；P0-04 保留；ATT 无证据不乱加。
5. **有 project SDKROOT/manifest 是否能上传？否。**确认没有实际 Archive；新文件只完成源码和 XML 复核，P0-05/06 的构建收录验证保持未完成。
6. **图片只给本站看是否没有凭据泄露？否。**原 allCookies 拼头确为跨域泄露路径；修复后手工 Cookie header 已移除；还必须做受控 iOS 重定向验证。
7. **是否仅课表产品？否。**重新检查 VoiceHub、小游戏、Windows 工具、赞助和资料 UGC；已纳入版权、大陆资质、4.2、支付/隐私范围。没有发现新的可确认真实泄露密钥，但未把静态扫描当成完整历史泄漏保证。

复查结论仍为**当前不建议提交**。已列出仍未闭环的 P0，没有将人工事项、环境限制和测试失败改写为通过。

## Changes Made

仅修改以下文件；没有部署、修改商户配置、删除核心业务、修改账号体系、虚构备案/审核凭据或添加 Sign in with Apple。

| 文件 | 实际修改 |
| --- | --- |
| `ios/cpuweb/PrivacyInfo.xcprivacy` | 新增 App Group UserDefaults 1C8F.1 |
| `ios/CPUWebWidgets/PrivacyInfo.xcprivacy` | 新增 Widget 同组 UserDefaults 1C8F.1 |
| `ios/cpuweb/CPUIOSBridge.swift` | HTTPS 主 frame；图片 HTTPS + 临时系统 Cookie store，移除全量 Cookie 手工请求头 |
| `ios/cpuweb/NativeImageGallery.swift` | 图片保存中防重复、成功/下载/权限错误反馈 |
| `ios/cpuweb/WebViewContainer.swift` | 内容进程终止、主文档 4xx/5xx 进入现有重试页 |
| `ios/cpuweb/AppConfiguration.swift` | bridge/UA 版本读取 Bundle |
| `web/src/views/profile/Index.vue` | 常驻隐私政策/用户协议链接 |
| `web/src/components/common/PrivacyPolicyNotice.vue` | 登录/注册等通知补用户协议链接 |
| `web/public/terms.html` | 将已有注册协议内容放到公开响应式页面，不添加未经确认的法务承诺 |
| `web/src/data/serviceTools.ts` | 已实现的反馈/问卷改为准确功能说明 |
| `web/src/views/services/Tools.vue` | 移除“会陆续补齐”的半成品式说明 |
| `APP_STORE_REVIEW_AUDIT.md` | 本报告 |

`output/app-store-audit-20260907/` 另存扫描脚本、清单和执行日志，不纳入正式发布源码。再次提交前必须按最终 iOS 二进制及实际生产后端更新本报告中的未完成项。
