# 药大拾间 Android 客户端

与新版 iOS（`ios_next`）和 HarmonyOS 客户端结构一致的原生外壳：Jetpack Compose 负责底部五栏、原生顶栏、登录与课表等高频交互；首页、教务、服务、我的及其子页面继续用同一个 WebView 加载现有站点。包名 `cn.lizmt.cpuweb`，最低 Android 7.0（API 24）。构建版本以 `app/build.gradle` 为准，线上版本以 `../server/src/releases/android.json` 为准。

打包、签名、上传或发布前，请先读 [Android 发布操作手册](../docs/android-release-runbook.md)，不要根据本 README 的本地编译示例直接分发 APK。

## 原生能力

- **外壳**：Compose 底部导航（首页、教务、课表、服务、我的），默认进入原生课表。Web 栏目使用原生顶栏：根页面显示 Logo 与标题，子页面显示返回键与网页路由标题；右侧为刷新、消息（未读角标）或登录、快捷入口面板（发帖、消息、管理后台、客户端下载、论坛、公告、教务、课表、服务、二手、拾间 AI 与外观切换）。帖子详情等自带导航的页面隐藏原生顶栏和底栏；键盘弹出时隐藏底栏；首页提供原生“投稿”按钮。
- **共享 WebView**：所有 Web 栏目共用一个 WebView，保留 Cookie、DOM 存储、站内路由；网页顶栏和底栏由注入样式隐藏，但仍保留在 DOM 中供抽屉与账号操作复用。系统返回键依次关闭网页弹层、按网页路由返回上级，根页面回到课表后再退出。旋转、深浅色、字体大小变化不重建 Activity，WebView 会话不会丢失。
- **登录门禁**：未登录时显示原生登录页（统一认证、验证码、保持登录；长按图标解锁站内账号登录；须同意隐私政策与用户协议）。登录仍由网页的 Pinia 登录流程完成，HttpOnly 会话 Cookie 留在 WebView 中，原生不保存学校密码。判定与 iOS 相同：以网页登录状态为准，空账号报告先二次核验，Cookie 仅换取有限的恢复窗口，教务授权失效不会触发站点登录门禁。
- **原生课表**：两排工具栏（学期、日/周/月视图、回到本周今日、更多），周次切换与校历日期，周视图左右滑动切周、日视图左右滑动切换日期，12 节时间轴（优先使用校历下发的节次时间），连续节次合并，下拉刷新。月视图是一张月历：每天一格（公历日、农历或节日、课程圆点、休/班），下面是所选那天的课程，可跳到日视图。点课程打开速览（教室、老师、周次、备注），“编辑”进入编辑器。今天这一列标出当前时间，日视图显示正在上、下一节和已结束；可在“课表风格”里关闭，也可隐藏周末（周末有课或补班的那一天仍显示）。已显示的课表不会被状态页替换：教务授权失效、刷新失败都以顶部横幅提示。
- **课表风格**：与 iOS 4.14 相同的六种风格——经典（原来的样子，默认）、简约、格子、表格、素笺、站牌，覆盖周、日、月视图；风格只换画法，不改课程数据、配色和背景。日视图顶部的七天条由各风格按自己周视图表头的样子画（经典保留原来的），选中的那天和今天各有各的标记：简约是浅色圆角底，格子是带边框的方格，表格是整格主题色，素笺是淡染，站牌是反色块（今天用底边粗线）。站牌只在时间和日期上用等宽字体，课程名、教室这些正文用系统字体。主题色按配色取一次并调到在画布、面板和今日列上都不低于 4.5:1。
- **重叠课程**：同一时段的课程并排显示；在编辑器里打开“优先显示这门课”后，重叠的节次只显示它，其余课程保留没被盖住的节次。优先级按课程名保存在课表修改的 `priority` 字段里（`server/src/shared/schedulePriority.ts`），和 iOS 共用。
- **缓存**：内存缓存 12 小时、最多 4 个学期；整学期规则只缓存一次，旧服务端的逐周数据由网页桥后台预取并推入原生缓存。最近一次成功的课表写入不参与备份的私有目录，并记录站点会话 Cookie 的指纹；冷启动先核对指纹再显示，随后静默刷新。账号变化或退出登录立即清空内存与磁盘缓存。
- **个人课程**：原生添加、修改、隐藏、删除、恢复教务原始安排与恢复已隐藏课程，经网页同源接口与 CSRF 保存，并核对服务器修改基线以避免覆盖并发编辑；研究生课表沿用网站限制。一门课可以有多组上课时间，节次可以不连续；保存时每段连续节次写成一条原有格式的修改项，其他客户端照常读取。与已有课程时间重叠时只提示，不阻止保存。
- **共享课表**（更多 → 共享课表）：为当前学期生成、更新、撤销分享码（每学期一个，走 `/api/schedule-shares`，需要已部署 `a9d92248` 之后的服务端才能列出自己的码、原地更新和免凭据撤销）；输入分享码或粘贴链接，预览后加备注导入。导入的课表整份保存在本机不参与备份的目录、按账号隔离，以只读方式打开，不进入小组件和冷启动缓存；对方更新后自动换新，撤销后保留副本并标记。iOS 的“关心”依赖实时活动，安卓没有对应功能。
- **样式与导出**：九套 Web 主题配色（由 `web/src/components/jwxt/scheduleTheme.ts` 生成）、相册背景（22%–88% 显现，默认 76%；Android 12 起支持 0–18 柔化）、深浅色，所有主题的课程文字对比度有回归检查。可按所选周以文本分享、导出 ICS 日历（北京时间，不含订阅地址或登录信息）。
- **图片**：网页图集交给原生查看器，支持左右切图、双指缩放、双击放大、下滑关闭和保存到相册。
- **网页权限**：仅对本站页面按需申请相机、麦克风；文件选择沿用系统文档选择器。
- **客户端统计**（`ClientStats.kt`，后台“安卓客户端”页）：启动、回到前台和账号变化时上报品牌、型号、系统与 WebView 内核版本、客户端版本，以及小组件、外观、课表风格、自定义背景、安装应用权限的状态；另按天汇总冷启动次数与耗时、网页进程崩溃或被回收、系统记录的进程退出原因（Android 11 起），一天结束后上传。未捕获异常的调用栈写入本机，下次启动上传；ANR 只上传系统转储里的主线程。安装标识是本机生成的随机 UUID，不读取 Android ID、IMEI 或广告标识；请求带 WebView 的站点会话，所以登录后安装会关联到账号。任何失败都静默，不影响使用。连正式站点的 Debug 构建不上报，指向开发服务器（`-PappUrl=`）的 Debug 构建照常上报，便于联调。

## 桌面小组件

临近课程 2×2 / 4×2、今日课表 4×2 / 4×4、两日课表 4×4，与 iOS、HarmonyOS 的样式族一致；支持九种主题和系统深浅色，完成的课程变灰，较大卡片标注剩余课程数。

- 原生课表加载后按日期展开写入本地，小组件优先读取这份课表；课表“更多 → 桌面课表小组件”可预览、选择主题、刷新并添加到桌面，也可编辑已添加实例的显示选项。
- 已有本地课表时不自行请求服务端；只对尚无本地数据的旧安装保留订阅接口回退，不复制登录 Cookie。上下课、换日和兜底刷新由系统调度，账号变化清理旧课表和订阅。完整规则见 [小组件显示规则](../docs/schedule-widget-rules.md)。
- 点击小组件打开原生课表并回到本周今日。

## 与网页的协议

UA 追加 `CPUWebScheduleApp/<versionCode> CPUWebScheduleAppVersion/<versionName> CPUTimeNative/1`。`CPUTimeNative/` 让网页按原生外壳处理（`/schedule` 路由交给原生、同步未读数、安装共享课表桥 `web/src/utils/iosNextScheduleBridge.ts`）；`CPUWebScheduleApp` 让网页和服务端继续把它识别为 Android，而不是 iOS。

- `app/src/main/assets/NativeShellBootstrap.js`：页面开始时注入（仅本站来源），隐藏网页栏、创建 `window.CPUTimeNative` 并上报路由、登录状态与外观。消息优先经按来源限定、只接收主框架的 `WebMessageListener` 送达 Kotlin；旧版 WebView 回退到 JavaScript 接口。
- `app/src/main/assets/NativeWebCompatibility.js`：由 `android/bridge/*.ts` 生成，页面加载完成后执行。线上网页尚未提供课表桥时，用现有 Pinia 状态和同源 Cookie 安装兼容桥，并提供原生登录、顶栏状态、返回导航、弹层检测与课程编辑（`CPUAndroidEditor`）。
- 原有 `CPUAndroid` 桥（应用内更新、小组件、图片保存）保留，仅对本站页面开放。

修改 `android/bridge`、共享课表桥或网页主题后，在仓库根目录运行：

```sh
npm ci --prefix web
npm run android:generate
node --test android/tests/*.test.mjs
```

Linux 部署工作流会检查这两个生成文件是否过期，并运行上述测试。

## 构建与测试

需要 JDK 17 与 Android SDK Platform 35。用 Android Studio 打开 `android/`，或在命令行：

```bash
./gradlew :app:assembleDebug
./gradlew :app:testDebugUnitTest :app:lintDebug
```

调试本机开发服务器：`./gradlew :app:assembleDebug -PappUrl=http://10.0.2.2:5173/home`。

Debug 构建可用本地模拟课表检查原生界面（不需要学校账号，登录门禁不出现，WebView 仍加载站点）：

```bash
adb shell am start -n cn.lizmt.cpuweb/cn.lizmt.cpuweb.schedule.MainActivity --ez debugMockSchedule true
```

模拟课表还接受这些参数，用来直接进入某个状态截图（共享课表在这个模式下走本地假接口）：

| 参数 | 作用 |
| --- | --- |
| `--es debugStyle paper` | 课表风格：`classic`、`minimal`、`grid`、`table`、`paper`、`board` |
| `--es debugView month` | 视图：`day`、`week`、`month` |
| `--ei debugDay 4` | 选中星期几（1–7） |
| `--es debugNow 09:00` | 固定“现在”，查看正在上、下一节等状态 |
| `--es debugPriority 体育（羽毛球）` | 设置优先显示的课程，多个用逗号分隔，靠前的在上 |
| `--es debugSheet sharing` | 启动后打开弹窗：`visual`（课表风格）、`display`（显示设置）、`style`（配色与背景）、`sharing`（共享课表）、`couple`（情侣课表） |
| `--es debugCouple active` | 情侣课表的假接口状态：`active`（已绑定，TA 的课表和自己的有重合、有撞课、有各自的课）、`pending`（邀请码等待接受），不传为未绑定 |
| `--es debugCoupleColors teal,amber` | 情侣课表里两人的颜色：先是自己的，再是 TA 的（`blue`、`pink`、`purple`、`teal`、`green`、`amber`、`orange`） |
| `--es debugDisplay sundayFirst,offWeek` | 先恢复默认再套用显示设置：`sundayFirst`、`offWeek`、`teacher`、`compact`、`noTime`、`noSaturday`、`noSunday`、`noToday`、`small` / `large`、`rows=140` |
| `--ez debugPublished true` | 假接口里已有自己的分享码 |
| `--ez debugShared true` | 启动后打开一份共享课表 |

自动测试与模拟器检查不能代替真机验收：需要用真实账号覆盖登录与验证码、本科/研究生课表、快速切周、授权失效、账号切换、断网恢复、课程编辑、背景与导出、所有小组件尺寸与深浅色、冷/热启动与小组件跳转、应用内更新。

## 发布构建

共享 WebView 默认加载：

```text
https://cputime.cn/home
```

本地 release 编译检查（不是正式生产制品）：

```bash
./gradlew :app:assembleRelease
```

正式分发必须给 GitHub CI 的 unsigned APK 使用已有发布证书签名；不能新建自己的 keystore 替代，否则无法覆盖安装。签名环境、校验和上传步骤见 [发布操作手册](../docs/android-release-runbook.md)。不要把 keystore、密码或签名配置提交到仓库。

正式更新使用 `Android release artifact` 工作流生成的精确提交 APK，下载后使用现有发布证书签名，并核对包名、版本号和证书摘要。先上传企业盘原发布目录并下载回读校验，再更新网页版本信息、等待精确提交的 `Linux deployment artifact` 成功并部署。仓库中的 APK 仅留存发布记录，不作为网站或 ESA 的下载来源；稳定下载入口及旧 APK 链接都通过企业盘分发，解析失败时提示重试。

V37 将下载包复制到独立缓存并验证包名、版本和签名，通过 FileProvider 授予安装器读取权限。Web 仅对 V37 及声明 `supportsStagedApkInstall` 的客户端启用应用内更新；旧版打开普通 `/download` 页面交给系统浏览器，避免旧壳拦截 APK 链接。3.x 旧版会收到一次修复引导，手动更新入口始终可用。

V38 支持保存下载任务和待安装文件，重开应用后恢复进度、继续安装或重试。正式版本由 `server/src/releases/android.json` 管理，发布门禁与真机验收步骤见 `docs/android-release.md`。

## 可配置参数

| 参数 | 默认值 | 说明 |
|---|---|---|
| `appUrl` | `https://cputime.cn/home` | 共享 WebView 的首个页面（原生课表不受影响） |
| `applicationId` | `cn.lizmt.cpuweb` | Android 包名 |
| `appName` | `药大拾间` | 桌面显示名称 |

示例：

```bash
./gradlew :app:assembleRelease -PappUrl=https://cputime.cn/home -PapplicationId=cn.lizmt.cpuweb -PappName=药大拾间
```
