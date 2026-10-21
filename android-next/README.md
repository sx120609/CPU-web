# 药大拾间 NEXT

药大拾间的独立测试版应用：包名 `cn.lizmt.cpuweb.next`，名称“药大拾间 NEXT”，自有图标（药大拾间的三横一勾放在墨色底上，勾是青色），与正式版（`../android/`，`cn.lizmt.cpuweb`）是两个应用，可以同时安装，各自登录、各自保存设置和课表缓存。新功能先在这里做，正式版不受影响。最低 Android 7.0（API 24）。

本项目从正式版外壳派生，保留其课表、小组件、登录和网页桥接，在此之上加入“今天”、日程（带提醒）、拾间AI 个人模式、可自组装的外壳、主题引擎、网页改造和增量自更新。构建版本以 `app/build.gradle` 为准，线上版本以 `../server/src/releases/android-next.json` 为准（首次发布前为 `null`）。版本号从 1001 起：网站和服务端按 `CPUWebScheduleApp/<versionCode>` 对比正式版的门槛，NEXT 始终高于正式版就不会被当成过期客户端；用户看到的是 `versionName`（NEXT 1.0.0）。UA 另带 `CPUWebNextApp/<versionCode>`，网站据此不对它弹正式版的更新提示和强制更新期限。

打包、签名、上传或发布前，请先读 [Android 发布操作手册](../docs/android-release-runbook.md) 的“药大拾间 NEXT”一节，不要根据本 README 的本地编译示例直接分发 APK。

## 原生能力

- **外壳**：Compose 底部导航，出厂为今天、课表、首页、服务、我的，默认进入“今天”；导航栏的内容、顺序、样式和启动页都可由用户改（见“自定义”）。Web 栏目使用原生顶栏：标签的根页面显示 Logo 与标题，其他页面显示返回键与网页路由标题；右侧为刷新、消息（未读角标）或登录、快捷入口面板。帖子详情等自带导航的页面隐藏原生顶栏和底栏；键盘弹出时隐藏底栏；首页提供原生“投稿”按钮。
- **共享 WebView**：所有 Web 栏目共用一个 WebView，保留 Cookie、DOM 存储、站内路由；网页顶栏和底栏由注入样式隐藏，但仍保留在 DOM 中供抽屉与账号操作复用。系统返回键依次关闭网页弹层、按网页路由返回上级；到了标签根页面，按用户设置先回启动页、连按两次退出或直接退出。旋转、深浅色、字体大小变化不重建 Activity，WebView 会话不会丢失。
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

## 自定义

所有选择保存在 `custom/CustomizationStore.kt`（一份 JSON，写入前经 `CustomizationCodec` 规范化：标签 2–6 个、地址只能是站内路径或 https 链接、卡片类型白名单），改动立即生效。入口：快捷入口面板的“拾间设置”、长按导航栏、课表“更多”，也可以把“设置”放进导航栏。

- **导航栏**：从目录（今天、日程、拾间AI、首页、课表、教务、服务、我的、论坛、消息、二手、站内搜索、公告、失物招领、课程点评、创意工坊、小工具、设置）或“我的页面”（任意站内地址）里选 2–6 个，拖动排序、改名、换图标、选启动页；两种样式（悬浮、贴底）和三种文字显示，选中的标签显示实心图标。1.0 的“通透玻璃”“极简图标”读作悬浮（极简图标同时不显示文字）。再点一次当前标签：网页回到根页面或刷新，课表回到本周，工作台刷新。站内页面归属：路径落在哪个网页标签之下就归哪个，否则按原来五个栏目的归属，再否则留在当前网页标签。原生把网页标签的根路径和标题写进 `window.CPUAndroidTabRoots` / `CPUAndroidTabTitles`，网页桥的返回栈和顶栏标题据此判断根页面。
- **今天**（`TodayScreen.kt`）：日期、校历周与农历，“问拾间AI”入口，下一项（正在上课时有进度条），今天的时间线（课程和自己的日程排在一起），未完成（过期没打勾和没定日期的日程），明天，未读消息，常用入口，公告，热榜，倒计时，便签；各部分可增删、拖动排序。课程来自小组件那份按日期展开、已套用调休的本地课表；公告和热榜经已登录的页面请求 `/api/home/summary`、`/api/home/hot-ranking`，与网站可见性一致。
- **日程**（`agenda/`、`AgendaUi.kt`）：用户随时记下的事，一种条目：可以定在某天某时、某天全天，或先不定日期；每项都能打勾完成，可重复（每天、工作日、每周、每月）、可设提醒，与课程一起出现在“今天”和“日程”页（一周日期条加当天时间线），也画进课表：周视图里按时间放在当天那一列（与课程重叠时靠右，不挡住课程），有全天项的日子在表头加一个点；日视图在课程上方列出当天的日程。分享来的别人的课表和风格预览里不显示。新建时第一行可以直接写「周五 14:00-15:30 组会 @药学楼」，`AgendaParser` 离线读出日期、时间、重复、提醒和地点。数据存在本机 `files/agenda.json`（删除留下时间戳，180 天后忘掉），登录后经“跨设备同步”同步到同一账号的其他手机。1.1 的“待办”读作没有时间的日程（`AgendaKind` 只为读旧数据保留）；有时间的日程过了就算发生过，没有时间的过期未打勾和没定日期的列在“未完成”。
- **提醒**（`AgendaReminders.kt`）：每项一条闹钟指向下一次提醒，到点发通知（“完成”和“10 分钟后提醒”），重复项触发后排下一次；可选上课提醒，按本地课表在每节课前 N 分钟提醒。Android 13 起用 `USE_EXACT_ALARM`（更低版本 `SCHEDULE_EXACT_ALARM`）准时提醒，没有精确闹钟权限时退为系统允许的最近时间；开机、改时间、改时区、更新后重排。第一次设提醒时请求通知权限。上课提醒读小组件那份本地课表，课表变化写完文件后再重排（先读再写会排不上）；设置里显示下一次提醒的时间和课程，读不到接下来三周的课时直接说明。“提醒没响？”打开“提醒检查”：通知、横幅和声音（渠道被设成静默）、准时闹钟、电池优化各自显示状态并跳到对应的系统页，另有自启动和后台运行的说明（国内厂商的系统会拦下不在前台的应用），以及“现在发一条”和“1 分钟后发一条”两种测试提醒。自启动一行按手机品牌（小米、荣耀、华为、OPPO/一加/realme、vivo/iQOO、魅族、三星）给出设置路径，并依次尝试打开该品牌的自启动管理页（`ReminderRelay.kt` 的 `VendorSettings`，打不开时退到应用信息页）。**微信和 QQ 也提醒**（设置“提醒”和“提醒检查”里）：手机厂商不拦微信和 QQ，打开后 App 把接下来 30 天的提醒（与本机闹钟同样的规则：日程每次未完成的提醒、每节课前 N 分钟，`ReminderPlan`）作为同步记录 `reminders` 传给服务端，每台手机一条；服务端 `services/nextReminders.ts` 每 30 秒找到到点的提醒（最多晚 10 分钟，再晚丢弃），建一条站内通知（分类 `service-tool`，来源“拾间 NEXT 提醒”，同一账号两台手机的同一提醒只发一次），再交给已有的 QQ、微信模板消息派发。需要登录并打开跨设备同步；行内显示绑定情况，没绑定时可跳到网页“消息 → 设置”去绑定。关掉后删除服务端那条记录。
- **拾间AI 个人模式**（`AssistantSession.kt`、`AssistantScreen.kt`、`AssistantActivity.kt`、`custom/AssistantControls.kt`，网页桥 `bridge/agent.ts`）：原生对话页，像聊天应用一样有多个对话：顶栏左边是全部对话（按今天、昨天、这一周、更早分组，可搜索，长按重命名或删除），右边是新对话和更多（可以看到什么、怎么确认，操作记录，重命名，删除）。长按自己的最后一个问题可以“改一下再问”，长按最后一个回答可以“重新回答”，都能复制。问题经 `/api/search/assistant/agent/stream`（服务端 `personalAssistant.ts`）流式回答，占用拾间AI 的每日额度。“可以看到”里有五项授权：课表和日程（未来 7 天课程、自己的日程和未读数）、公告与热榜（标题，默认打开）、论坛和站内内容（默认打开）、我的消息和私信（默认关闭）、成绩与考试（默认关闭）。每次提问还附带 App 当前的设置，以及登录后经网页桥读到的用户自己（id、昵称）和能发帖的板块（30 分钟读一次）；服务端不保存。**读取**：模型回 `read`（站内 GET 路径，服务端按白名单逐个校验路径和查询键：帖子列表与搜索、帖子正文和回复、热榜、用户主页和帖子、失物招领、课程点评、我的点赞，授权后还有通知和私信）或 `data.request`（成绩、考试），一次最多 3 个；App 经已登录的页面（`CPUAndroidAgentData`）读回、去掉图片和样式、截短到 8000 字符放进 `toolResults` 再问，每个问题最多 4 轮；只读不答的那几轮服务端退还额度。全部读不到时直接说明原因。**替用户做事**：除了日程、上课提醒、主题、文字大小、常用开关、布局、导航栏、今天页面、课表视图和风格，还能发帖、回帖、点赞、私信、发失物招领、把通知全部标为已读，经网页桥（`CPUAndroidAgentAct`）用用户自己的登录状态在手机上执行；发帖和回帖等审核结果（约 12 秒），审核中显示“审核通过后显示”，执行后可“查看”。发帖和回帖可撤销（删除），点赞可撤销；私信发出后不能撤回。**确认**两档：每一项都先问我；改我自己的直接做（默认：日程、设置、布局、点赞、已读直接执行并可撤销）。发帖、回复、私信、失物招领和删除日程总是先给用户看，卡片显示完整内容，可以“改一改”（帖子可换板块、改标题正文、匿名）后直接发出。打开页面、切换课表视图不会自动执行，显示成按钮，点了才打开（1.2 的自动跳转让用户还没看完回答就离开了）。新建日程的卡片可以在日程编辑器里改；有两项以上待确认时有“全部确认”。“操作记录”按天列出每次执行：做了什么、什么时候、在哪台手机上、是否自动、是否已撤销，点一条回到当时的对话，可以清空。
- **主题引擎**（`CpuTheme.kt`）：拾间青、跟随壁纸（Android 12+）、十种预设或任意色值，深浅两套都自动调到 4.5:1；纯黑深色、圆角、界面密度、原生文字大小。开启“网页跟随主题”后，`WebTheming.kt` 在文档开始时注入样式，覆盖网站的 `--cpu-primary*`、`--el-color-primary*`、`--cpu-radius-*` 和纯黑背景变量，网页按钮、链接和圆角一起变。
- **网页改造**：可开关的页面规则（隐藏首页热榜、隐藏首页快捷入口、隐藏悬浮发帖按钮、系统字体、加深次要文字、关闭网页动画、黑白模式）、网页文字大小（WebView `textZoom`），以及用户自己的 CSS。只注入样式，不注入脚本；只作用于本站。
- **顶栏与快捷入口**：顶栏的图标、刷新、消息、快捷入口按钮和首页投稿按钮可分别关闭；快捷入口的项目和顺序可改。
- **交互与行为**：返回键规则、再点一次当前标签、触感反馈、减弱动态效果、看课表时保持亮屏、隐私模式（`FLAG_SECURE`）。
- **桌面快捷方式**：长按图标弹出的入口（最多 4 个）和固定到桌面的页面图标，打开即进入对应页面。
- **布局方案与分享**：今天、个人助理、正式版、社区、极简五套方案；整套布局可复制成 `NEXT1-` 开头的分享码（不含便签内容），对方粘贴即可得到同样的拾间。每个新版本第一次运行时弹出介绍，可以选方案，也可以保持现在的布局。
- **跨设备同步**（`NextSync.kt`，服务端 `services/nextSync.ts`、`routes/nextSync.ts`，表 `NextSyncRecord`）：日程、拾间AI 对话和操作记录各自一条一行存在登录账号下，`GET /api/next-sync?cursor=` 按服务器修改时间分页拉取变化，`POST /api/next-sync` 一次最多推 50 条，`DELETE` 删除云端副本。同一条以客户端修改时间新的为准（设备时钟最多比服务器快 1 分钟，再快按服务器时间算），旧的推上来时服务器把新的那份发回；删除留下墓碑，180 天后清理。服务器按集合校验格式和大小：日程最多 600 条、单条 4000 字符，超出拒收；对话最多 100 个、单个 120000 字符（App 推之前从最早的消息删到 100000 以内），操作记录最多 300 条，超出删最早的。App 在 `noBackupFilesDir/next-sync.json` 记着服务器确认过的每条版本，版本不同就上传，所以从通知栏完成日程这类 App 没开时的改动也会在下次同步时上去；正在回答的对话等回答完再传。先拉后推，触发时机：登录状态确认后、回到前台（30 秒内不重复）、本机改动后 3 秒、前台每 5 分钟。第一个同步的账号接管这台手机上已有的数据；之后换成别的账号会暂停，设置里可以“改用当前账号”（清空本机日程、对话和记录再下载）。设置里可以关闭同步、立即同步、删除云端副本（随后停止同步，每台手机已有的内容不变）。注销账号时一并删除。服务端测试 `server/tests/nextSync.test.ts`，PostgreSQL 上的合并与分页由 `nextSyncPostgres.test.ts` 在 CI 里跑；App 端 `NextSyncTest`、`NextSyncTwoPhonesTest`（两台手机经内存里按同样规则实现的服务器同步）。
- **其他客户端的日程**：网页 `/agenda` 和正式版安卓、鸿蒙、iOS 的课表用的也是这里的 `agenda` 集合（网页带 `?collection=agenda,settings` 只拉这两个集合，规则在 `server/src/shared/agenda.ts`）。网页的“微信和 QQ 也提醒”存在 `settings` 集合的 `agenda-preferences`；服务器按 `agenda:<id>:<日期>` 去重，和 App 打开的转发不会重复发。NEXT 不认识的集合照常忽略。
- **设置的结构**：首页只放常改的——导航栏、今天、主题色、深浅色、上课提醒、拾间AI 可以看到的内容和操作怎么确认、跨设备同步、更新；顶栏按钮、界面疏密与圆角、网页改造、返回键、交互、快捷入口、桌面快捷方式和布局分享都在“更多设置”。

## 更新

原生更新器（`AppUpdater.kt`，“设置 → 更新”）只认 NEXT 自己的发布清单（`/api/site/downloads/android-next?from=<已装版本>`）；网页看到 `CPUAndroid.supportsNativeUpdater()` 和 `CPUWebNextApp/` 后不再弹正式版的更新提示，手动检查转给原生设置页。

- **增量更新**：服务器为当前版本列出增量包时（发布清单 `patches`），只下载增量包，用已安装的 `base.apk` 合成新版（`update/ApkDelta.kt`），核对 SHA-256、包名、版本和签名后才安装；增量包任何一步失败都退回完整安装包。增量包和安装包都从企业盘下载，网站只返回清单和 302 跳转。下载可续传；默认仅在不计流量的网络下自动下载。
- **安装**：通过 `PackageInstaller` 会话安装。Android 12 及以上在用户允许过“安装未知应用”后，自更新不弹系统确认；默认在用户离开拾间约 90 秒后由闹钟触发安装（回到前台会取消），也可以在设置里立即安装。更低版本或系统要求确认时弹出系统安装页。新版第一次运行时显示“已更新到…”和发布说明，可选系统通知。
- **安装包与增量包**：企业盘上的 `CPU-Web-Android-NEXT-V<versionCode>.apk` 和 `CPU-Web-Android-NEXT-V<旧>-V<新>.cpupatch`，入口 `/api/site/downloads/android-next-app`、`/api/site/downloads/android-next-patch?from=`。下载页在 NEXT 发布后显示邀请卡片。
- **打包**：DEX 不压缩存放（`packaging.dex.useLegacyPackaging false`），Release 用 R8 只做裁剪、不混淆不优化（`proguard-rules.pro`）：未用到的 Compose / 图标代码被移除，类名保持可读，两版之间未改的代码字节相同，增量包因此通常只有完整安装包的百分之几。

## 桌面小组件

临近课程 2×2 / 4×2、今日课表 4×2 / 4×4、两日课表 4×4，与 iOS、HarmonyOS 的样式族一致；支持九种主题和系统深浅色，完成的课程变灰，较大卡片标注剩余课程数。

- 原生课表加载后按日期展开写入本地，小组件优先读取这份课表；课表“更多 → 桌面课表小组件”可预览、选择主题、刷新并添加到桌面，也可编辑已添加实例的显示选项。
- 已有本地课表时不自行请求服务端；只对尚无本地数据的旧安装保留订阅接口回退，不复制登录 Cookie。上下课、换日和兜底刷新由系统调度，账号变化清理旧课表和订阅。完整规则见 [小组件显示规则](../docs/schedule-widget-rules.md)。
- 点击小组件打开原生课表并回到本周今日。

## 与网页的协议

UA 追加 `CPUWebScheduleApp/<versionCode> CPUWebScheduleAppVersion/<versionName> CPUTimeNative/1`。`CPUTimeNative/` 让网页按原生外壳处理（`/schedule` 路由交给原生、同步未读数、安装共享课表桥 `web/src/utils/iosNextScheduleBridge.ts`）；`CPUWebScheduleApp` 让网页和服务端继续把它识别为 Android，而不是 iOS。

- `app/src/main/assets/NativeShellBootstrap.js`：页面开始时注入（仅本站来源），隐藏网页栏、创建 `window.CPUTimeNative` 并上报路由、登录状态与外观。消息优先经按来源限定、只接收主框架的 `WebMessageListener` 送达 Kotlin；旧版 WebView 回退到 JavaScript 接口。
- `app/src/main/assets/NativeWebCompatibility.js`：由 `android/bridge/*.ts` 生成，页面加载完成后执行。线上网页尚未提供课表桥时，用现有 Pinia 状态和同源 Cookie 安装兼容桥，并提供原生登录、顶栏状态、返回导航、弹层检测与课程编辑（`CPUAndroidEditor`）。
- 原有 `CPUAndroid` 桥（应用内更新、小组件、图片保存）保留，仅对本站页面开放；新增 `supportsNativeUpdater()`、`openNativeUpdater()`、`getUpdateChannel()`。
- 用户的网页样式和标签根路径由文档开始脚本写入（`WebTheming.documentScript`），样式只放进 `<style id="cpu-android-user-style">`。

修改 `android/bridge`、共享课表桥或网页主题后，在仓库根目录运行：

```sh
npm ci --prefix web
npm run android-next:generate
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
adb shell am start -n cn.lizmt.cpuweb.next/cn.lizmt.cpuweb.schedule.MainActivity --ez debugMockSchedule true
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
| `--ez debugOverlapNotice true` | 示例课表里周三有两门课排在同一时段；带上它才弹「同一时间排了两门课」的提示（每处只弹一次，清数据后再看） |
| `--es debugCoupleColors teal,amber` | 情侣课表里两人的颜色：先是自己的，再是 TA 的（`blue`、`pink`、`purple`、`teal`、`green`、`amber`、`orange`） |
| `--es debugDisplay sundayFirst,offWeek` | 先恢复默认再套用显示设置：`sundayFirst`、`offWeek`、`teacher`、`compact`、`noTime`、`noSaturday`、`noSunday`、`noToday`、`small` / `large`、`rows=140` |
| `--ez debugPublished true` | 假接口里已有自己的分享码 |
| `--ez debugShared true` | 启动后打开一份共享课表 |

自定义、更新页和工作台也有调试参数（同样只在模拟课表模式下生效）：

| 参数 | 作用 |
| --- | --- |
| `--ez debugResetCustom true` | 先把自定义恢复默认 |
| `--es debugLayout assistant` | 套用布局方案：`today`、`assistant`、`classic`、`community`、`minimal`，并打开它的启动页 |
| `--es debugTabs dashboard,schedule,forum` / `--es debugLaunch dashboard` | 直接指定导航栏和启动页 |
| `--es debugAccent C2337A` | 主题色（六位十六进制，不带 `#`；或 `brand`、`dynamic`） |
| `--ez debugBlack true` | 纯黑深色 |
| `--es debugTabStyle docked` / `--es debugLabels selected` | 导航栏样式（`floating`、`docked`）与文字 |
| `--es debugDensity compact` / `--ef debugCorners 0.5` | 界面密度与圆角 |
| `--es debugTweaks hideHot,grayscale` | 网页改造 |
| `--ez debugAgenda true` | 用一周示例日程和待办替换本机日程（会写入 QA 包的数据） |
| `--ez debugAssistant true` | 拾间AI 页加入并打开一段示例对话（新建日程、根据考试安排回答、改课表风格和今天页面，含待确认和已执行的操作），不联网 |
| `--es debugOpen agenda` | 启动后打开某个目的地（`dashboard`、`agenda`、`assistant`、`home` 等） |
| `--es debugSettings tabs` | 打开设置页：`root`、`tabs`、`dashboard`、`theme`、`more`、`layout`、`quick`、`shortcuts`、`web`、`update` |
| `--es debugUpdate ready` | 更新页示例状态：`available`、`downloading`、`ready`、`failed` |
| `--ez debugIntro true` / `--ez debugJustUpdated true` | 显示新版介绍 / “已更新到…” |

`-PminifyDebug=true` 让 Debug 构建也走 R8 裁剪，用来在模拟课表模式下检查 Release 的裁剪结果。

自动测试与模拟器检查不能代替真机验收：需要用真实账号覆盖登录与验证码、本科/研究生课表、快速切周、授权失效、账号切换、断网恢复、课程编辑、背景与导出、所有小组件尺寸与深浅色、冷/热启动与小组件跳转、应用内更新。

## 发布构建

共享 WebView 默认加载：

```text
https://cputime.cn/home
```

Release 构建用 R8 裁剪（不混淆）并把 DEX 不压缩存放，原因见“更新”。本地 release 编译检查（不是正式生产制品）：

```bash
./gradlew :app:assembleRelease
```

正式分发使用 `Android NEXT release artifact` 工作流生成的精确提交 APK（制品 `cpu-web-android-next-unsigned-<SHA>`），用与正式版相同的发布证书签名；不能新建 keystore 替代，否则已安装的 NEXT 无法覆盖更新。签名、生成增量包、上传企业盘和提升 `android-next.json` 的步骤见 [发布操作手册](../docs/android-release-runbook.md)。不要把 keystore、密码或签名配置提交到仓库。

## 可配置参数

| 参数 | 默认值 | 说明 |
|---|---|---|
| `appUrl` | `https://cputime.cn/home` | 共享 WebView 的首个页面（原生课表不受影响） |
| `applicationId` | `cn.lizmt.cpuweb.next` | Android 包名 |
| `appName` | `药大拾间 NEXT` | 桌面显示名称 |

示例：

```bash
./gradlew :app:assembleRelease -PappUrl=https://cputime.cn/home -PapplicationId=cn.lizmt.cpuweb.next -PappName="药大拾间 NEXT"
```
