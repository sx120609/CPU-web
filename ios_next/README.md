# iOS 原生客户端：第一阶段

在 `CpuTime/CpuTime.xcodeproj` 打开 `CpuTime` scheme。最低系统版本 iOS 17。

## 本阶段范围

- SwiftUI 系统底部导航：首页、教务、课表、服务、我的。
- 启动默认进入原生课表，同一个 WKWebView 在后台预热首页与登录数据桥；首次等待显示课表网格和页内同步提示，数据就绪后原位填入。切回课表优先复用内存缓存，后台网页跳转不会抢走课表标签。
- 冷启动先显示上次的课表：最近一次成功的快照写入 App 的 Application Support（排除备份），并带上会话 Cookie 指纹；重启后先核对当前 `__Host-cpu-session` 的指纹，一致才渲染，随后右上角显示小菊花静默刷新。退出登录、换账号或快照超过缓存时限都会直接删除该文件，指纹核对在渲染之前完成，不会闪出别人的课表。网页若额外下发账号指纹（`auth.account`），则以它为准，指纹变化立即清空。刷新过程中学期、周次与视图切换保持可用。已经显示出来的课表不会被状态页替换：教务授权失效、桥接失败或刷新出错都以顶部横幅呈现，只有在没有任何课表可显示时才整页提示；只有会话 Cookie 确实消失或换了账号才会清空，并立刻重新拉取。
- 课表使用 SwiftUI：学期和周次切换、返回本周、日／周视图、课程详情、刷新、加载／空／授权失效／失败状态。
- 首页、教务、服务、我的及其子页面继续由 WKWebView 加载现有网站。
- 沿用 Web 的 HttpOnly 会话、教务自动恢复、本科／研究生识别、校历、单双周解析及本科课程修改记录。原生不保存学校密码。
- 课表缓存仅在内存中；账号或教务身份变化会清除缓存并作废旧请求。没有新增跨启动离线缓存。

本阶段未迁移课程编辑器、课表背景／主题、分享与导出等扩展功能。原有 `ios/` 包装客户端独立保留。

## Web 配套改动

原生容器注入 `CPUTimeNative/1` UA 标识和 `window.CPUTimeNative`，网站只对这个新版容器隐藏 Web 底部标签栏，网页顶栏和页脚保留；普通浏览器、旧 iOS 客户端不受影响。

`web/src/utils/iosNextScheduleBridge.ts` 在应用启动时安装：

```javascript
await window.CPUTimeNativeScheduleFetch(semester, week, force)
// { version: 1, source, fetchedAt, data, calendar, auth, error? }
```

`data.cells` 已应用课程修改并规范化 `weekList`。Swift 通过 `WKWebView.callAsyncJavaScript` 等待返回值，不复制 Cookie 到另一套网络客户端。网页课表路由通过 `CPUTimeNative.navigate('/schedule')` 切换原生标签；`authChanged(account)` 携带账号指纹：指纹不变表示同一账号的会话恢复完成，原生保留已显示的课表；指纹变化或为空则清空内存与磁盘上的账号数据。

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
node --test ios_next/tests/web-schedule-bridge.test.mjs ios_next/tests/native-web-bundle.test.mjs
swiftc ios_next/CpuTime/CpuTime/NativeScheduleStore.swift ios_next/tests/NativeScheduleStoreChecks.swift -o /tmp/cpu-next-store-checks
/tmp/cpu-next-store-checks
swiftc ios_next/CpuTime/CpuTime/ShellTab.swift ios_next/CpuTime/CpuTime/NativeShellCoordinator.swift ios_next/tests/NativeTabSelectionChecks.swift -o /tmp/cpu-next-tab-checks
/tmp/cpu-next-tab-checks
xcodebuild -project ios_next/CpuTime/CpuTime.xcodeproj -scheme CpuTime -sdk iphonesimulator -configuration Debug CODE_SIGNING_ALLOWED=NO build
```

修改共享课表桥或 `ios_next/bridge` 后重新运行 `build-web-bridge.mjs`，将更新后的 JS 资源随 iOS 包一起构建。

底栏选择由原生用户操作或当前可见网页的显式导航请求驱动。网页 history／加载完成通知不反向改写底栏；连续切换会作废旧跳转及其失败回退，视图挂载也不改变选中项。原生触发的整页切换按标签切换处理，不播放网页的交叉淡入：否则旧页面会带着切换前的滚动位置冻结在新页面上继续显示约 300ms。页面在路由过渡期间把刘海间距交给正在进入的页面，避免新页面先顶到状态栏再跳下来。

回归重点：登录后从 Web 返回原生课表、退出／切换账号、历史学期返回本周、快速切周、重叠课程详情、无课周、断网刷新、网页中的课表链接、其他栏目的子页面返回。真实学校账号与服务可用性仍需在联调环境验证。

以上本地检查只验证开发改动，不是生产部署产物；生产发布仍遵循 `docs/production-requirements.md`。

## iOS 小组件

已迁移旧版全部 WidgetKit 样式：临近课程（小号、中号、锁屏行内／圆形／矩形）、今日课表（中号、大号）、两日课表（大号），保留九种主题与每 30 分钟请求刷新的时间线策略（实际刷新由系统调度）。

登录并完成教务授权后，首次成功加载原生课表会自动配置尚未设置的小组件（每次启动／账号变化后最多自动尝试一次，失败可手动重试）。在原生课表点击“小组件”可查看配置结果、选择主题或手动重新配置，再通过系统主屏幕／锁屏编辑界面添加。配置请求沿用 WKWebView 的同源 Cookie 与 CSRF 校验；扩展只保存专用课表订阅地址，不复制登录 Cookie。旧网页的 `CPUIOS` 小组件配置及主题接口也已接通。

工程包含 `CPUWebWidgets` target、嵌入阶段和共享调试 scheme。App 与扩展均需在 Apple Developer 中启用 `group.cn.cputime.ios.next` App Group；扩展 Bundle ID 为 `cn.cputime.ios.next.widgets`。使用独立共享容器，不读取旧版客户端的订阅配置，首次使用由新版自动建立配置。点击小组件通过 `cputime-next://schedule` 打开原生课表并重新加载当前学期／本周，避免沿用旧的浏览周次。

真机验收：完成签名后检查配置保存、全部桌面／锁屏尺寸、主题切换、冷启动与热启动跳转、授权失效、断网和恢复。无签名模拟器构建不能验证 App Group provisioning 或系统后台刷新。

课表切回、网页课表链接和桥重新就绪时优先复用当前学期／周次的 12 小时内存缓存；桥加载期间也可立即恢复缓存。切换学期／周次同样复用已读取的数据。下拉刷新强制请求，账号变化清空缓存；App 退出后内存缓存不保留。

### 整学期规则与渐进加载

本科优先请求 `/api/jwxt/schedule?week=all`。新版服务端将其转换为教务页面的 `zc=`（明确选择“全部周”），并根据返回页面的周次下拉选中项声明 `scope: semester / week / unknown`，不能只根据请求参数认定返回了完整数据。确认整学期后只需一次课表查询；课程周次、单双周、小节范围已包含在规则 JSON 中，客户端应用课程修改、缓存规则，SwiftUI 按所选周筛选。研究生接口原本就返回整学期数据。

如果服务端尚未升级，或学校返回的仍是单周页面，先返回当前周课表，后台延迟 300ms 开始逐周补齐（每次一个后台请求）。预取顺序以当前选中周为中心：下一周、上一周，再向两侧扩展。每周取完立即推入原生缓存，切到已预取周不进入加载态，也不调用数据加载桥；只发送本地优先级通知，让后台继续优先下一周。前台切周与后台查询共用已完成数据和进行中的请求，后台失败保留成功周次，下次访问继续补齐。完整后只保留合并后的规则，并通过可信 Web 桥推送原生缓存，不再查询一次接口。没有明确教学周次时不擅自声明完整学期。

教务原始 HTML 和学校会话仍由服务端处理；客户端不重复解析学校 HTML。Web 桥最多保留 4 个学期，数据有效期 12 小时，仅存内存；账号变化清空并阻止旧请求写回。切换学期停止旧学期后续后台请求。手动刷新让首次“全部周”请求绕过服务端缓存（旧服务端不支持时，兼容回退的单周请求也可能强刷一次）；回退逐周查询继续复用服务端 5 分钟缓存，避免整学期多次强刷。需要实时确认的单周数据以服务端缓存策略为准。

学校“全部周”模式的依据是仓库中的新版页面样例与解析器测试；未用真实学校账号验证当前线上页面。服务端修改需要发布后才能提供 `scope` 标记，iOS 随包兼容桥已更新以兼容两种返回方式。

源码分析、请求量及新旧版本兼容矩阵见 [课表加载与兼容性核查](docs/schedule-loading.md)。
