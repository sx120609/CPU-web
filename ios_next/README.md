# iOS 原生客户端（当前新版）

在 `CpuTime/CpuTime.xcodeproj` 打开 `CpuTime` scheme。最低系统版本 iOS 15；iOS 15–16 使用网页兼容界面，iOS 17 及以上使用原生界面。Apple Watch 最低为 watchOS 10，配套同步入口仅在 iOS 17 及以上提供。旧的 `ios/` 是独立保留的 WebView 客户端，新功能和 Watch 集成应在 `ios_next/` 开发。

## 系统兼容

- **iOS 15–16**：使用持久化 WKWebView，保留网页登录、教务、课表、服务和个人中心。顶部「校园导航」在旧 WebKit 不显示网页底栏时仍可进入这些页面；支持返回、刷新、加载失败重试以及课表深链接。没有原生课表编辑／背景／分享、原生助手、实时活动、Watch 同步或 iOS 小组件配置。页面本身支持的操作仍可使用。
- **iOS 17 及以上**：保留现有原生功能；推送实时活动及定时启动仍遵循各自 iOS 17.2／18／26 的版本检查。小组件扩展最低 iOS 17，不为旧系统降级加载。
- 登录 Cookie 使用同一个默认 WebKit 数据存储，升级系统切到原生界面时不会主动清除。兼容界面只声明 `CPUWebIOSApp` 旧容器标识，不声明 `CPUTimeNative` 或虚构能力桥。
- App 与 iOS 小组件显式弱链接 ActivityKit。Xcode 26.6 SDK 将 `ActivityStyle` 标成 iOS 16.1 可用，但 iOS 17.0 实际缺少 `ActivityStyle.standard` 符号；仅靠调用处的 `#available` 不能阻止 dyld 在启动时解析强引用。弱链接与运行时版本分支必须同时保留。
- iOS 15.0–15.3 的网页使用随包兼容脚本补齐 `Object.hasOwn` 与 `Array.prototype.at`。不依赖网站先部署更新。

- **用途说明**：App 的 Info.plist 由 `project.pbxproj` 的 `INFOPLIST_KEY_*` 生成。相机、麦克风、写入相册三项都不是 Swift 代码申请的，缺了也能编译，但系统会在用到的那一刻直接结束进程：网页的 `<input type="file">` 在 WKWebView 里会给出「拍照或录像」，分享面板（课表分享图、网页 `navigator.share` 的图片）里有「存储图像」。`ios_next/tests/system-capabilities.test.mjs` 检查工程设置，`check-legacy-linkage.py` 检查归档产物。
- **文件下载**：网页里带 `download` 属性的链接、浏览器无法直接显示的响应和 `Content-Disposition: attachment` 的响应，由 `WebFileDownloader` 接成 WKWebView 下载，存到临时目录后交给系统分享面板（存到「文件」、存储图像、用其他 App 打开）。只接本站地址以及本站页面生成的 `blob:`／`data:`；其他域名的文件仍交给 Safari。原生界面和 iOS 15–16 的兼容界面都接了。网页生成 `blob:` 地址后不能在点击的同一时刻撤销它，否则 WebKit 还没读到就失效，App 里会提示「文件没有下载下来」。
- **后台刷新**：`AppInfo.plist` 声明了 `UIBackgroundModes = fetch`。没有它，`BGTaskScheduler` 会拒绝实时活动的后台刷新请求（代码里吞掉了这个错误），App 挂起后结束过期实时活动的兜底就不会运行。

回归方式与实际测试范围见 [系统兼容测试记录](docs/ios-compatibility-qa.md)。App Store 已发布的 4.13 最低支持 iOS 15；网站下载页和 `web/src/utils/clientInfo.ts` 已同步这一要求，并注明 iOS 15–16 的网页兼容界面与 iOS 17 及以上的原生功能边界。

## 当前范围

- SwiftUI 系统底部导航：首页、教务、课表、服务、我的。
- 启动默认进入原生课表，同一个 WKWebView 在后台预热首页与登录数据桥；首次等待显示课表网格和页内同步提示，数据就绪后原位填入。切回课表优先复用内存缓存，后台网页跳转不会抢走课表标签。
- 冷启动先显示上次的课表：最近一次成功的快照写入 App 的 Application Support（排除备份），并带上会话 Cookie 指纹；重启后先核对当前 `__Host-cpu-session` 的指纹，一致才渲染，随后右上角显示小菊花静默刷新。退出登录、换账号或快照超过缓存时限都会直接删除该文件，指纹核对在渲染之前完成，不会闪出别人的课表。网页若额外下发账号指纹（`auth.account`），则以它为准，指纹变化立即清空。刷新过程中学期、周次与视图切换保持可用。已经显示出来的课表不会被状态页替换：教务授权失效、桥接失败或刷新出错都以顶部横幅呈现，只有在没有任何课表可显示时才整页提示；只有会话 Cookie 确实消失或换了账号才会清空，并立刻重新拉取。
- 课表使用 SwiftUI：学期和周次切换、返回本周、日／周视图、课程详情、刷新、加载／空／授权失效／失败状态。
- Apple Watch 客户端以日历式竖向课程时间轴显示当日课表，左右滑动切换日期；Watch 小组件显示下一节课。
- iPhone 与 Watch 通过 WatchConnectivity 的应用上下文和回执同步经过验证的课表快照；不同步 Cookie、Token、密码或验证码。未安装 Watch App 时，iPhone 课表页不显示 Watch 入口。
- 首页、教务、服务、我的及其子页面继续由 WKWebView 加载现有网站。
- 沿用 Web 的 HttpOnly 会话、教务自动恢复、本科／研究生识别、校历、单双周解析及本科课程修改记录。原生不保存学校密码。
- 课表在内存中保留 12 小时，并可将最近成功快照写入 Application Support 以支持冷启动；磁盘快照同时校验站点会话指纹和账号指纹。退出、换号或过期时立即清除。

原生课表已支持课程编辑、配色、自定义背景与分享导出。背景可从课表“更多 → 背景自定义”直接设置，也可从设备设置进入；与 Web 一致使用居中铺满、22%～88% 背景显现（默认 76%）和 0～18 柔化程度。预览显示当前课表并即时应用调节，周／日视图共用背景与浅深色遮罩。图片原件仅保存在本机，显示时降采样以限制大照片的内存占用；清除背景与恢复默认都会删除本地图片。旧版绝对文件路径在升级后会按当前容器恢复。原有 `ios/` 包装客户端独立保留。

### 课表风格

课表有六种视觉风格，在课表「更多 → 课表风格」或设备设置里切换，立即生效：**经典**（原有外观，升级后的默认值，未知或缺失的存储值也回退到它）、**简约**、**格子**、**表格**、**素笺**、**站牌**。后五种来自 NapTable，覆盖周、日、月三种视图和分享图。风格只决定排版，不改课程数据、课程配色、背景图片和编辑方式：所有风格都是轻点课程进入编辑、轻点空节次添加课程。

- 风格存在 App Group 的 `scheduleVisualStyle`（稳定英文标识 `classic / minimal / grid / table / paper / board`），与课程配色、深浅外观互相独立。
- 新风格的课程色仍取自和 Web／安卓一致的课名哈希（UTF-16、32 位溢出），只是按各风格的底色重新定明暗；选了单色配色时，所有课程和主题强调色都跟随那一种颜色。素笺、站牌自带纸底和墨色，没有背景图时整页换成对应底色。
- 「标出当前时间」（默认开启，可在设备设置里关闭）在周视图的节次轴上显示当前时刻胶囊、在今天那一列画一条线；新风格的日视图据此标出正在上、下一节和已结束。经典风格的周视图同样有这条线。
- 分享图跟随所选风格、配色和深浅外观，并按静态方式渲染：不标今天和「现在」，什么时候打开都一样。经典风格的分享图保持原来的浅色画法。
- 隐藏周末时，有课的周六、周日仍然显示（原来只保留调休日）。
- 日视图上方的星期条跟着风格走：经典保持原样；简约是「几号在上、星期在下」，选中那天铺淡主题色圆角底；其余四种直接复用本风格周视图的表头行，切换日／周时这一行不变样。选中和今天各有各的标记——格子给选中那天描主题色边的淡彩格，表格把选中那格填成主题色，素笺给选中那天铺淡朱砂底、今天画朱砂圈，站牌把选中那天反白、今天压一条粗线。周次／月份标题的字体也随风格变化。
- 站牌的等宽体只用于时刻和日期。课名、教室、「第 3–4 节」这类成句文字用 `ScheduleStyle.textDesign`（站牌回到默认字体）：整句用等宽体时，汉字和数字之间的空格有一个数字那么宽。站牌日视图的每一行在开始时间下面写结束时间，不再重复「上午／下午」。
- 轻点课程先打开课程速览（课名、星期与节次时间、教室、老师、周次、备注），速览里的「编辑」在同一个面板里换成编辑页；轻点空节次仍然直接添加课程。
- 课程编辑页的「时间段」可以有多组上课时间（「添加上课时间」），每组各自选周次、星期和节次；节次是多选，可以不连续。周次面板多了「全部／单周／双周／清空」。保存时仍写成 Web、安卓共用的编辑数据：每一段连续节次一条，第一段沿用被编辑课程的标识（教务课程继续关联原课），其余各段是同名的自定义条目，所以其他端不用改就能读到。与已有课程在同一星期、节次相交且有共同周次时，编辑页给出重叠提示，但不拦截保存。
- 「更多 → 导出本周日历文件」生成当前浏览周的 `.ics`：按调休解析后的实际课程导出，放假日不导出，补班日导出它实际要上的课，自定义课程的显式起止时间优先于节次时间。系统日历直写（设备设置里的 Apple 日历）保持不变。

Debug 构建可用 scheme 环境变量临时查看：`CPU_DEBUG_SCHEDULE_STYLE=paper`（只影响本次启动，不写入设置）、`CPU_DEBUG_SCHEDULE_NOW=14:00`（固定「现在」）、`CPU_DEBUG_SCHEDULE_ACTION=share-image|calendar-file|course-sheet|course-editor`（课表加载后直接生成分享图、导出本周日历文件，或打开第一门课的速览／编辑页）。

### 重叠课程的显示优先级

几门课排在同一节时，默认并排显示。课程编辑页在这门课确实和别的课重叠（同一星期、节次相交、有共同周次）时出现「优先显示这门课」：打开后，重叠的节次只画这门课，被盖住的课只留下没被盖住的那几节，完全被盖住就不画。课程本身不删不改，轻点留下的那一段打开的仍是整门课。

- 优先级按课程名记（收拢空白后的课名），不是按某一节记，所以同一门课的各个上课时间一起生效。
- 数据在课表编辑里多一个可选字段 `priority`（课名 → 正整数，越大越靠前），接口仍是 `/api/jwxt/schedule-edits`。iOS 保存时总是带上这个字段；请求里没带它时服务端沿用已保存的值，所以还不认识它的安卓、鸿蒙客户端保存编辑不会把它抹掉（`server/src/shared/schedulePriority.ts`）。
- 课表页按学期读取并缓存在本机（`nativeSchedule.displayPriorities.v1`），换账号或退出登录时清掉。
- 实时活动用同一个答案：有唯一一门优先级最高的课时自动取它，设备设置里「请选择课程」只剩没人排过先后的节次；原来按日期逐节的选择仍然有效，作为没有优先级时的回退。
- 小组件和其他三端目前仍然把重叠的课都列出来。

### 共享课表

「更多 → 共享课表」里有两件事：

- **分享我的课表**：生成 8 位分享码，上传当前学期的整学期课表（含自己添加、修改的课程）和校历、节次、调休。每个账号每个学期只有一个码，课表变了点「更新分享内容」，码不变；「撤销分享」后码立即失效，服务器上的课表副本一并清掉。分享码挂在站内账号上，换设备登录后仍能管理。发出去的内容与 Web「共享课表」弹窗发布的是同一份数据，`/schedule/share/<码>` 的网页也能打开。
- **共享给我的课表**：输入分享码（或粘贴分享链接）→ 预览 → 填备注 → 导入。导入的课表只保存在本机，按导入它的账号隔离，换账号后清空。轻点打开只读的课表页（周／日／月视图、课程速览、分享图和日历文件导出可用；添加、编辑、背景和设备设置不出现），用的是对方自己的校历和调休。回到前台和打开列表时检查更新：对方更新了就重新下载，对方撤销了就保留本机副本并标成「分享已撤销，不会再更新」。自己的分享码不能导入。
- **关心**：点亮某份共享课表的爱心后，它的课会和自己的课一起进入实时活动，课名前带备注（「室友小王：体育」）。同一时间自己也有课时只保留自己的；对方课表内部的重叠不替对方选，直接略过。一次只能关心一份，取消后恢复只显示自己的课。小组件、Apple Watch、Apple 日历和冷启动存档始终只用自己的课表：只读课表页跑在独立的 `NativeScheduleStore(shared:)` 上，不经过这些通道。

服务端接口在 `/api/schedule-shares`：`POST /`（发布或更新，每账号每小时 30 次）、`GET /mine`、`GET /:code`、`GET /:code/meta`（只含更新时间等摘要，不缓存）、`DELETE /:code`（发布者本人登录即可，不再需要写入凭证）。情侣课表和它的接口没有改动。

Debug 构建的 `CPU_DEBUG_SCHEDULE_ACTION` 还支持 `sharing`、`shared-view`（用示例数据打开共享课表页或只读课表页）；配合 `CPU_DEBUG_MOCK_SCHEDULE=1`、`CPU_DEBUG_API_ORIGIN`、`CPU_DEBUG_API_TOKEN` 可以让示例课表直连一台本机服务端，用 `share-open`、`share-publish`、`share-import`、`share-import-view`（配 `CPU_DEBUG_SHARE_CODE`、`CPU_DEBUG_SHARE_REMARK`）把发布、导入、刷新和撤销实际走一遍。`style-picker` 打开课表风格页，`live-activity` 启动设备设置里那节演示课的实时活动；`CPU_DEBUG_MOCK_TABS=1` 给示例课表套上和登录后一样的底部标签栏（其余标签页是空的），用来截商店图。连本机服务端（`CPU_APP_URL`）拍课表以外的页面时，`CPU_DEBUG_LOGIN_USER`、`CPU_DEBUG_LOGIN_PASSWORD` 用种子数据里的示例账号自动登录，`CPU_DEBUG_TAB` 选标签页，`CPU_DEBUG_OPEN_PATH=/lost-found` 在首页标签里打开指定页面。`CPU_DEBUG_SCHEDULE_OVERLAP=1` 给示例课表加一门重叠的课，`CPU_DEBUG_SCHEDULE_PRIORITY=课名,课名` 按顺序指定优先显示的课。

课表主体沿用 Web／安卓的主题色与课程色规则：课名按规范化空白、UTF-16 和 32 位溢出计算颜色，日／周／月视图共用配色。单色主题使用固定底色、边框及文字色；深色彩色课程使用浅色文字。`check-schedule-palette.sh` 直接读取 Web 配色函数，与 Swift 结果做跨端对照。

## Web 配套改动

原生容器注入 `CPUTimeNative/1` UA 标识和 `window.CPUTimeNative`，网站只对这个新版容器隐藏 Web 底部标签栏，网页顶栏和页脚保留；普通浏览器、旧 iOS 客户端不受影响。

`web/src/utils/iosNextScheduleBridge.ts` 在应用启动时安装：

```javascript
await window.CPUTimeNativeScheduleFetch(semester, week, force)
// { version: 1, source, fetchedAt, periods, data, calendar, auth, cancelled?, error? }
```

`data.cells` 已应用课程修改并规范化 `weekList`；`periods` 是学校小节次的权威时间表，每门课同时携带不受教师或教室变化影响的 `nativeId`。Swift 通过 `WKWebView.callAsyncJavaScript` 等待返回值，不复制 Cookie 到另一套网络客户端。网页课表路由通过 `CPUTimeNative.navigate('/schedule')` 切换原生标签；`authChanged(account)` 携带账号指纹：指纹不变表示同一账号的会话恢复完成，原生保留已显示的课表；指纹变化或为空则清空内存与磁盘上的账号数据。

客户端已随包携带 `NativeWebCompatibility.js`：当线上网页尚未提供数据桥时，使用现有网页的 Pinia 登录状态和同源 Cookie API 安装兼容桥；已提供数据桥的新版网页优先使用网页实现。无需为了首次原生课表读取而先部署 Web。未登录显示授权入口，页面启动期间等待桥就绪后再请求。

原生这边只有底部标签栏，网页顶栏保留（品牌、刷新、登录、抽屉菜单），原生容器不再套一层顶部导航栏，底部也不重复预留安全区。客户端以 UA 在页面挂载前隐藏旧网页的底部标签栏，新版 Web 同样按 UA 控制；页脚继续沿用网页实现并预留原生底栏的可滚动空间。原生底部标签栏保留，网页返回沿用侧滑手势。

页面背景延伸到状态栏后方，刘海避让间距由当前顶部的元素承载：有网页顶栏时加在顶栏内部，没有顶栏的页面（登录、注册、首页以外的裸页）加在页面自身；间距取“原有顶部留白”和“安全区”中的较大值，已经自行预留安全区的页面不会被叠加第二次。首页免责声明排在快捷入口卡片之前，两者都在顶栏下方。状态栏明暗跟随网页外观，网页选择“跟随系统”时继续响应系统主题。网页顶栏里的深色／浅色切换驱动整个外壳而不只是网页：原生课表、原生底栏和子页面一起切换。最近一次选择会记在客户端，冷启动时先按它渲染课表，等网页报回真实外观后再对齐，不会先亮一下再变暗。

普通 Web 页面保留原布局左右留白（手机 12px、宽屏 20px）及页面自身的最大宽度，首页免责声明与快捷入口卡片同样按这个留白排布。裸页／全宽页仍自行管理边距。原生容器只移除重复的纵向导航占位，不再统一清零所有 padding。

网页底部保留 96px 可滚动内边距，供末尾内容滑到悬浮原生底栏上方；登录等独立页面同样处理。留白属于网页滚动内容，背景依旧延伸到屏幕底部。

## 开发与验证

默认站点是 `https://cputime.cn`。可在 app 的 Info.plist 配置 `CPUAppURL`；Debug 构建还支持 Xcode scheme 环境变量 `CPU_APP_URL`，例如 `http://localhost:5173`，连接本地 Vite。模拟器可以访问 Mac 的 localhost，真机需使用可访问的开发站点地址。

```sh
npm run dev --prefix web
npm run type-check --prefix web
node ios_next/scripts/build-web-bridge.mjs
node --test ios_next/tests/*.test.mjs
bash ios_next/scripts/check-live-activity.sh
bash ios_next/scripts/check-schedule-palette.sh
bash ios_next/scripts/check-chinese-calendar.sh
bash ios_next/scripts/check-course-arrangement.sh
bash ios_next/scripts/check-schedule-priority.sh
bash ios_next/scripts/check-shared-schedule.sh
swiftc ios_next/CpuTime/CpuTime/NativeScheduleStore.swift ios_next/tests/NativeSchedulePeriodChecks.swift -o /tmp/cpu-next-period-checks
/tmp/cpu-next-period-checks
swift test --package-path ios_next
swiftc ios_next/CpuTime/CpuTime/NativeScheduleStore.swift ios_next/tests/NativeScheduleStoreChecks.swift -o /tmp/cpu-next-store-checks
/tmp/cpu-next-store-checks
swiftc ios_next/CpuTime/CpuTime/ShellTab.swift ios_next/CpuTime/CpuTime/NativeShellCoordinator.swift ios_next/tests/NativeTabSelectionChecks.swift -o /tmp/cpu-next-tab-checks
/tmp/cpu-next-tab-checks
xcrun --sdk iphonesimulator swiftc -target arm64-apple-ios17.0-simulator ios_next/CpuTime/CpuTime/NativeSchedulePreferences.swift ios_next/tests/NativeScheduleBackgroundChecks.swift -o /tmp/cpu-schedule-background-checks
xcrun simctl spawn booted /tmp/cpu-schedule-background-checks /tmp/cpu-schedule-background-fixtures
xcodebuild -project ios_next/CpuTime/CpuTime.xcodeproj -scheme CpuTime -destination 'generic/platform=iOS' -configuration Debug CODE_SIGNING_ALLOWED=NO build
xcodebuild -project ios_next/CpuTime/CpuTime.xcodeproj -scheme CPUWatch -destination 'generic/platform=watchOS' -configuration Debug CODE_SIGNING_ALLOWED=NO build
```

修改共享课表桥或 `ios_next/bridge` 后重新运行 `build-web-bridge.mjs`，将更新后的 JS 资源随 iOS 包一起构建。

背景验证脚本在已启动的 Apple Silicon iOS 模拟器中检查实际 UIKit 解码、原图保存、大图降采样、替换失败保护、冷启动恢复、旧容器路径迁移、数值边界与清除／重置，并输出三种比例的本地图片用于可视验证。`CPU_DEBUG_MOCK_SCHEDULE=1` 的调试课表独立于学校会话；可再加 `CPU_DEBUG_VISUAL_SCHEDULE=1` 检查多课程配色与长标题，或加 `CPU_DEBUG_BACKGROUND_EDITOR=1` 直接打开背景预览。Xcode 未设为当前开发目录时，命令前加 `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`。

底栏选择由原生用户操作或当前可见网页的显式导航请求驱动。网页 history／加载完成通知不反向改写底栏；连续切换会作废旧跳转及其失败回退，视图挂载也不改变选中项。原生触发的整页切换按标签切换处理，不播放网页的交叉淡入：否则旧页面会带着切换前的滚动位置冻结在新页面上继续显示约 300ms。页面在路由过渡期间把刘海间距交给正在进入的页面，避免新页面先顶到状态栏再跳下来。

回归重点：登录后从 Web 返回原生课表、退出／切换账号、历史学期返回本周、快速切周、重叠课程详情、无课周、断网刷新、网页中的课表链接、其他栏目的子页面返回。真实学校账号与服务可用性仍需在联调环境验证。

以上本地检查只验证开发改动，不是生产部署产物；生产发布仍遵循 `docs/production-requirements.md`。

实时活动回归脚本在 macOS 编译执行实际控制器与网络协调器，验证提前量、远程计划、调休、权限、退出及迟到响应撤销。iOS 18 及以上上传启动 token 与已加载学期的最小时间计划，远程启动直接订阅学校时段频道，无需每天打开 App；提前量可自定义 0–60 分钟，默认 15 分钟。课程详情从本地课表读取，不上传教师、地点或课程名称。iOS 17 仅提供前台本地活动。服务端凭据在后台「APNs 推送」配置，正式 Bundle ID 为 `cn.cputime.mobile`。模拟器可用 `CPU_DEBUG_MOCK_SCHEDULE=1` 检查本地呈现，APNs 仍需真机验证。详情见 [APNs 配置与验收](../docs/apns.md)。

## iOS 小组件

已迁移旧版全部 WidgetKit 样式：临近课程（小号、中号、锁屏行内／圆形／矩形）、今日课表（中号、大号）、两日课表（大号），保留九种主题与每 30 分钟请求刷新的时间线策略（实际刷新由系统调度）。

登录并完成教务授权后，首次成功加载原生课表会自动配置尚未设置的小组件（每次启动／账号变化后最多自动尝试一次，失败可手动重试）。在原生课表点击“小组件”可查看配置结果、选择主题或手动重新配置，再通过系统主屏幕／锁屏编辑界面添加。配置请求沿用 WKWebView 的同源 Cookie 与 CSRF 校验；扩展只保存专用课表订阅地址，不复制登录 Cookie。旧网页的 `CPUIOS` 小组件配置及主题接口也已接通。

工程包含 `CPUWebWidgets`、`CPUWatch` 和 `CPUWatchWidgets` targets，并将 Watch App 嵌入 iPhone App、Watch 小组件嵌入 Watch App。四个 target 共用 `Configurations/SharedSigning.xcconfig` 中的默认标识。其他开发者可将 `Signing.local.xcconfig.example` 复制为被 Git 忽略的 `Signing.local.xcconfig`，改成自己的 Team ID、Bundle ID 前缀和已注册 App Group，然后使用 Debug 配置自动签名运行。`DebugSigning.xcconfig` 只在 Debug 加载本地覆盖；Release 保持上游正式发布配置，不读取本地自签值。使用本地自签的开发者应选择 Run（Debug）；正式 Archive 仍需要上游发布证书和描述文件。iPhone App、两个小组件和 Watch App 必须使用同一 App Group。

点击 iPhone 小组件通过 `cputime-next://schedule` 打开原生课表并重新加载当前学期／本周，避免沿用旧的浏览周次。

真机验收：完成签名后检查配置保存、全部桌面／锁屏尺寸、主题切换、冷启动与热启动跳转、授权失效、断网和恢复。无签名模拟器构建不能验证 App Group provisioning 或系统后台刷新。

课表切回、网页课表链接和桥重新就绪时优先复用当前学期／周次的 12 小时内存缓存；桥加载期间也可立即恢复缓存。切换学期／周次同样复用已读取的数据。下拉刷新强制请求，账号变化清空缓存；App 退出后内存缓存不保留。

### 整学期规则与渐进加载

本科优先请求 `/api/jwxt/schedule?week=all`。新版服务端将其转换为教务页面的 `zc=`（明确选择“全部周”），并根据返回页面的周次下拉选中项声明 `scope: semester / week / unknown`，不能只根据请求参数认定返回了完整数据。确认整学期后只需一次课表查询；课程周次、单双周、小节范围已包含在规则 JSON 中，客户端应用课程修改、缓存规则，SwiftUI 按所选周筛选。研究生接口原本就返回整学期数据。

如果服务端尚未升级，或学校返回的仍是单周页面，先返回当前周课表，后台延迟 300ms 开始逐周补齐（每次一个后台请求）。预取顺序以当前选中周为中心：下一周、上一周，再向两侧扩展。每周取完立即推入原生缓存，切到已预取周不进入加载态，也不调用数据加载桥；只发送本地优先级通知，让后台继续优先下一周。前台切周与后台查询共用已完成数据和进行中的请求，后台失败保留成功周次，下次访问继续补齐。完整后只保留合并后的规则，并通过可信 Web 桥推送原生缓存，不再查询一次接口。没有明确教学周次时不擅自声明完整学期。

教务原始 HTML 和学校会话仍由服务端处理；客户端不重复解析学校 HTML。Web 桥最多保留 4 个学期，数据有效期 12 小时，仅存内存；账号变化清空并阻止旧请求写回。切换学期停止旧学期后续后台请求。手动刷新让首次“全部周”请求绕过服务端缓存（旧服务端不支持时，兼容回退的单周请求也可能强刷一次）；回退逐周查询继续复用服务端 5 分钟缓存，避免整学期多次强刷。需要实时确认的单周数据以服务端缓存策略为准。

学校“全部周”模式的依据是仓库中的新版页面样例与解析器测试；未用真实学校账号验证当前线上页面。服务端修改需要发布后才能提供 `scope` 标记，iOS 随包兼容桥已更新以兼容两种返回方式。

源码分析、请求量及新旧版本兼容矩阵见 [课表加载与兼容性核查](docs/schedule-loading.md)。
