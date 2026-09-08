# HarmonyOS 独立核查与课表重绘

2026-09-08。以 `ios_next` 的原生能力为功能基线，以实际网页版课表为视觉基线。仅修改 HarmonyOS 客户端及其回归构建步骤，不替换网站课表，也不部署服务端。

## 外观与架构

- 保留一个长期存活的 ArkWeb 实例；首页、教务、服务、我的共用原有登录会话与站内路由。课表由 ArkUI 绘制。
- 课表重新按 `web/src/views/Schedule.vue` 及 `schedule/styles` 绘制：两排紧凑工具栏、学期选择、日／周切换、返回今日、刷新、周次面板、日期条、完整 11 节时间轴、圆角空课时格子、居中的周课程块及日时间轴。
- `SchedulePalettes.ets` 由网站主题文件生成。`ScheduleVisuals.ets` 与网页使用相同的课程名规范化、无符号哈希和 HSL 规则；测试逐一对比浅色／深色课程填色、渐变、边框及文字颜色。
- 底栏使用鸿蒙系统 Symbol，API 23 起采用 HDS 悬浮栏及系统自适应材质。SDK 最低版本调整为 HarmonyOS 6.0 / API 20，以匹配 UIDesignKit 依赖；API 20–22 保留标准 Tabs。旧 HarmonyOS 5.x 不在本版兼容范围。

## 功能核查

| 能力 | 实现与验证范围 |
| --- | --- |
| 学期、周次、今日、日／周、详情 | 原生控件；模拟器实际切至第 3 周、返回第 2 周、切日视图、打开课程详情及原生编辑面板 |
| 校历、单双周、本科修改记录、研究生 | 直接复用 `iosNextScheduleBridge.ts`；本科使用已登录真实会话回读，研究生仅完成共享桥测试，没有实际研究生账号验证 |
| 全学期与旧服务端 | 只有明确完整学期范围才本地筛周；实际线上返回单周、`completeSemester:false`，已验证兼容路径；后台逐周预取、去重、缓存优先级有测试 |
| 缓存与竞态 | 12 小时、最多 4 学期、进程内缓存；缓存命中撤销旧前台请求，刷新阻止旧预取覆盖，账号变化清理并作废迟到响应；测试覆盖超时、过期、切账号、快速切周 |
| 连续／重叠课程 | 连续表格分段按网页规则合并，错误节次按实际表格位置纠正；不同课程与个人课程标识保留；重叠时提供课程选择弹层 |
| 断网与恢复 | 对真实 ArkWeb 网络施加临时离线，强刷后原生页面保留已显示课程并提示连接失败；结束后恢复网络。没有把网络失败作为注销操作 |
| 冷／热深链 | 实际 `cpuweb://schedule` 热启动将第 3 周重置为当前第 2 周；强制结束进程后冷启动进入原生课表并恢复读取；宿主未创建时的意图排队有测试 |
| 原生个人课程编辑 | 添加、编辑、隐藏、删除、恢复，支持节次、教师、地点、备注和单双周；真实账号只读取编辑基线并检查表单。写入、CSRF、并发基线冲突及迟到结果通过模拟接口测试，未向真实账号保存测试课程 |
| 主题与背景 | 九套主题、原生相册选择、私有目录保存、可见度设置、移除背景；样式偏好持久化。尚未用用户照片完成真实选择与持久化回读 |
| 分享／日历导出 | 系统文本分享、文档保存器输出所选周 ICS；测试覆盖真实日期、UTC 转换、转义与 75 字节折行。不包含登录 Cookie 或订阅令牌；未实际发送分享，也未完成系统文档保存交互 |
| 桌面／锁屏卡片 | 保留 2×2、2×4、4×4 桌面和三种锁屏配置、订阅、主题与当前周深链；补充缓存所属订阅及 12 小时时效，切账号清理、过期授权和旧请求丢弃测试。没有完成各尺寸真实宿主、锁屏权限和系统后台刷新验收 |
| 原有系统桥 | 图片预览／保存、文件选择、剪贴板、外链、按需媒体授权保留。非站点 HTTP(S) 页面转系统浏览器；补测伪装 authority、非标准端口不得进入有权限的 Web 实例 |

## 证据

本机使用 DevEco Studio 6.1.1.300 / SDK 6.1.1 API 24，模拟器 `CPUWeb_API24`，HDC 目标 `127.0.0.1:5555`，系统 `OpenHarmony-6.1.1.125`。屏幕截图原始大小 1256×2760。

本机证据目录为仓库下 `output/harmony-independent-qa-20260908/`，保留迭代截图及失败构建记录，未把真实账号页面截图与接口回执纳入 Git：

- `20-web-reference-dark.jpeg`、`21-web-reference-light.jpeg`、`22-web-week-reference.jpeg`：同一模拟器中直接打开实际网页版的外观基线。
- `24-redraw-week-light.jpeg`、`25-redraw-day-light.jpeg`、`26-redraw-detail.jpeg`、`27-existing-course-editor.jpeg`：原生重绘与真实课程读取；后续修正了更多图标、编辑面板底部留白等细节。
- `28-offline-refresh.jpeg`：临时离线下的刷新失败与已显示课程保留。
- `week3-layout.json`、`hotlink-layout.json`、`coldlink-layout.json`、`29-cold-link.jpeg`：第 3 周、热启动回第 2 周与冷启动恢复。
- `30-redraw-week-dark.jpeg`：按网页颜色规则绘制的原生深色周课表。
- `live-api-final-readback.json`：实际 `https://cputime.cn` 本科已登录会话，2026–2027 第一学期、第 2 周、12 个课程单元；status、identity、schedule、schedule-edits、calendar 的 HTTP 200 回读，不输出令牌或学校账号。
- `tests.log`：57 项测试通过；`final-build.log`：ArkTS、资源、HAP 打包通过。

本机无签名调试 HAP 的 SHA-256：`42bc97bd68c396efefd146339ff49abbe722f257f0068025f5fb5804139a9037`。成功安装到上述模拟器。该包不是已签名的 AppGallery 发布包。

## 发布边界

GitHub Actions 的 `Linux deployment artifact` 对精确提交 SHA 执行共享桥／主题生成一致性检查和 57 项回归，再构建 server、web、VoiceHub 与提交绑定产物。是否完成 push 以该 SHA 的 CI 和产物实际结果为准，本记录不替代 CI 回执。

开发者签名、AppGallery Connect 锁屏开放能力、发布 Profile、真实设备的后台刷新及正式上架均未验证。没有生产部署，也没有第三方平台提交。

## 后续样式统一与导航修正（2026-09-08）

此节为后续版本，以上截图、57 项测试及 HAP 哈希保留为历史证据。根据用户对视觉效果的反馈，参考 HarmonyOS Design 与 UI UX Pro Max 的移动端排版指导重新实现，再按网页端及 iOS 的布局统一工具栏、时间轴和卡片信息顺序。

- 原生课表采用中性背景、淡色课程块、完整 11 节起止时间和两排工具栏；日视图按实际节次排列，保留跨节合并、重叠选择及原有操作。
- 原生课表与卡片共享九套主题的配色处理；新增独立亮度计算，验证浅深模式课程名称、地点文字至少 4.5:1 对比度。
- 保留网页顶部消息／菜单入口，网页弹层打开时隐藏原生底栏，安全区随系统变化更新。HDS 的默认渐变蒙版明确设置为透明、高度 0，首页底部仅保留胶囊导航材质。
- 临近课程、今日课表、两日课表使用课程优先布局与细彩色标记，应用预览和系统卡片共用渲染组件；修复跨日课程状态、HTML 授权失败响应以及并发登记覆盖尺寸的问题。并发测试修复前只能保存 8 条登记中的 1 条，修复后完整保留各尺寸与类型。
- 系统选择器实际检查了全部 8 个桌面选项的渲染及中文名称。选择器中的旧版大卡片曾出现小卡片布局，修复并重新安装后已恢复两日布局。现有桌面 4×4 卡片显示真实课程，点击后实际回到原生本周课表。

新增本机证据仍位于 `output/harmony-independent-qa-20260908/`，未将真实账号截图提交到 Git：

- `mask-before.jpeg` / `mask-after.jpeg`：首页默认大蒙版修正前后。
- `unified-final-week.jpeg`、`unified-final-day.jpeg`、`unified-week-dark.jpeg`：最终布局的浅深色课表。
- `unified-widget-small.jpeg`、`unified-widget-medium.jpeg`、`unified-widget-today.jpeg`、`unified-widget-two-day.jpeg`、`unified-widget-dark.jpeg`：共用渲染组件预览。
- `gallery-final-0.jpeg` 至 `gallery-final-7.jpeg`：8 个实际系统选择器选项；其中 `gallery-final-2.jpeg` 保留登记竞争失败状态，修复结果为 `gallery-registry-fixed.jpeg`。
- `desktop-final.jpeg`、`widget-tap-final.jpeg`：已有桌面卡片更新及点击回到本周。
- `final-live-readback.json`：真实本科登录会话、2026–2027 第一学期、第 2 周、12 个课程单元，教务状态／身份／课表／日历／个人修改接口 HTTP 200。
- `final-tests.log`：68 项测试全部通过；`redesign-build-5.log`：最终 ArkTS、资源和 HAP 打包通过。

最终无签名调试 HAP SHA-256：`4763bd581a7c45a5e9d89c114c5d972021f638c84c954887cab11c11283db9e5`，已安装至同一 API 24 模拟器。锁屏仍仅验证共用组件预览与配置，不代表真实锁屏宿主、发布签名或后台刷新验收。没有执行生产部署。

## 底栏重建与表单按钮修正（后续反馈）

实际复现了“首页打开快捷入口菜单，再返回”后 HDS 胶囊背景消失、图标覆盖帖子的问题。仅设置底色仍可复现；改为保留底栏组件、用 `Visibility.Hidden` 隐藏网页弹层下的导航后，浅深模式返回均恢复正常。继续关闭额外渐变蒙版。另按用户要求移除原生课表的品牌／消息／菜单顶栏，将高度交给课表；课程编辑的保存改为底部 48 vp 主按钮，周次批量操作为等宽 44 vp 按钮，选中配色使用语义资源。

本机新增证据：`bar-bug.jpeg` 与 `bar-web-return.jpeg` 保留失败状态，`chrome-drawer-open.jpeg`、`chrome-drawer-return.jpeg`、`chrome-bar-dark.jpeg` 为修复后的网页弹层和返回状态；`chrome-schedule.jpeg` 为无顶栏课表；`chrome-editor.jpeg`、`chrome-editor-dark.jpeg` 为新按钮布局。模拟器点击输入框未出现软键盘，不能以 `chrome-keyboard.jpeg` 作为软键盘避让通过的证据。未保存测试课程。

`chrome-tests.log` 的 68 项测试通过，`chrome-final-build.log` 打包通过并安装。此版本无签名 HAP SHA-256：`f14e9f683641762651facec1f9df2ae7b08566e4f541560efad4e43e0509355d`。

## 跟手切周与网页布局对齐（后续反馈）

根据“主要是外观、布局和动画”的反馈，本轮对照同一模拟器的实际网页移动课表调整原生页面。保留无品牌顶栏和底部保存按钮，缩小周次标题、统一两排圆角工具栏、日期栏、38 vp 时间列、浅色空格与课程边框。课程按网页同名哈希映射色系；深色平面卡片取渐变深端，浅色课程文字稍加深，并独立验证九套主题、两种外观、366 个课程名组合的文字对比度至少 4.5:1。

原先只有 `PanGesture.onActionEnd` 直接换周，现改为原生 `Swiper`，提供拖动预览、回弹和 260 ms 箭头切换。仅当前周及相邻页构建完整课表，周次不循环。页面使用独立周快照，避免出场页随选中周改变；视图、日期、加载状态和缓存版本变化会更新快照，避免日视图切换后仍显示周表。未缓存周显示加载状态，保留周次导航，不借用其他周课程。

本机证据位于同一 `output/harmony-independent-qa-20260908/`，真实账号截图与回执未提交到 Git：

- `alignment-web-actual.jpeg`：当前线上网页移动端基线。
- `alignment-approved-week.jpeg`、`alignment-approved-dark.jpeg`：最终包浅深色周课表；`alignment-approved-motion.jpeg` 为真实慢拖中间帧，左右日期分别属于第 2、3 周。
- `alignment-day-final.jpeg`、`alignment-day-monday.jpeg`：日视图及切换日期；`alignment-short-swipe.jpeg` 为短滑后保持第 2 周。
- `alignment-paging-receipt.json`：实际回读 2→3→4→3→2→1、首周继续右滑保持第 1 周、箭头回第 2 周；`alignment-boundary-30.jpeg` 为末周继续左滑后保持第 30 周。远周跳转与返回本周也实际检查，校历无对应日期时显示缺省日期。
- `alignment-live-readback.json`：本科真实会话、第 2 周、12 个课程单元及 HTTP 200 回读；没有写入测试课程。
- `alignment-tests.log`：72 项回归通过；`alignment-build-6.log`：最终 ArkTS、资源与无签名 HAP 打包通过，并安装至 API 24 模拟器。

此版本无签名 HAP SHA-256：`14e09bb1f64541d5bc973bb109878a7baa64016250c26b029f8af5cbf231ec9b`。本轮未修改服务卡片及个人课程写入逻辑；模拟器验证不代表已签名真机发布包。本轮没有执行生产部署。
