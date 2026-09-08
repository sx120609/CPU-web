# 药大拾间 HarmonyOS App

这是与新版 iOS 客户端采用同一结构的 HarmonyOS Stage 模型应用：ArkUI 原生五栏外壳与原生课表负责高频交互，其他校园模块继续使用同一个 ArkWeb 实例加载现有站点。课表外观按网页版重绘，数据与缓存沿用 `ios_next` 的共享课表桥。最低 HarmonyOS 6.0（API 20），目标 HarmonyOS 6.1.1（API 24）。

## 原生应用能力

- ArkUI 原生底部导航：首页、教务、课表、服务、我的；API 23 起使用 UIDesignKit 的 HDS 悬浮底栏和系统材质，API 20–22 使用标准 Tabs。图标来自鸿蒙系统 Symbol。
- 原生课表按网页版的两排工具栏、日期条、11 节时间轴、圆角空格及彩色课程块重绘；支持学期与周次选择、前后切周／横滑、返回本周今日、日／周视图、课程详情、下拉刷新、空数据、授权失效与失败状态。
- 九套主题从网页主题文件生成；彩色课程的哈希、浅深填色、边框及文字颜色与网页对照测试。日视图沿用网页时间轴，连续节次合并，同一时段重叠课程可逐个查看。
- 首页、教务、服务、我的及其子页面共用一个 ArkWeb 会话，保留 Cookie、DOM 存储、站内路由和侧滑返回。
- 课表使用现有 HttpOnly 登录会话及教务自动恢复，不在鸿蒙端保存学校密码。
- 优先复用网页侧整学期课表桥；确认整学期后在 ArkUI 本地按周筛选。旧服务端只返回单周时，网页桥按当前周附近顺序后台预取，并把完成周次直接推入原生缓存。
- 原生缓存有效期 12 小时、最多保留 4 个学期，仅在当前进程内保存。账号或教务身份变化时清空缓存并作废旧请求，不提供跨账号离线数据。
- 安装包内带有兼容读取逻辑；线上网页尚未提供新版课表桥时，仍可利用现有 Pinia 登录状态、同源 Cookie 和教务恢复流程读取已解析课表。
- 个人课程支持原生添加、修改、隐藏、删除和恢复；使用现有同源课程修改接口与 CSRF。提交前核对账号和服务器修改基线，避免覆盖已发现的并发编辑。研究生编辑沿用网站限制。
- 原生相册选择课表背景、可见度调节、系统文本分享、按所选周导出 ICS 日历。分享与导出不包含订阅地址或登录信息。
- ArkWeb 页面隐藏重复的网页顶栏、移动底栏和页脚，保留原页面内容边距与悬浮底栏下方的可滚动留白；系统／浅色／深色设置与网页同步。

## 服务卡片与系统桥

- 支持 2×2、2×4、4×4 桌面课表卡片，以及 1×2 横条、1×1 圆形、1×2 矩形三种锁屏课表卡片。
- 首次成功加载原生课表后会为尚未配置的用户自动建立专用课表订阅；原生课表内可选择九种主题并手动重新配置。
- 卡片只保存专用订阅地址，不复制登录 Cookie；支持 30 分钟刷新请求、离线缓存、主题同步和带当前周语义的深链回跳。实际刷新由 HarmonyOS 调度。
- `CPUHarmony` 桥继续提供复制文本、外链打开、图片预览与保存、图片／文档选择上传、相机及麦克风按需授权。
- `cpuweb://schedule` 从桌面或锁屏卡片进入原生课表并重新读取当前学期／本周。

## 基础信息

- 应用名：药大拾间
- 包名：`cn.lizmt.cpuweb`
- 版本：`2.1.0 (19)`
- 默认入口：`https://cputime.cn/home`

## 构建

本机需要 DevEco Studio / HarmonyOS SDK。项目不包含开发者账号的签名路径或凭据；首次打开后请使用当前“药大拾间”开发者账号配置自动签名或导入该账号签发的发布证书。

先安装 `web` 的依赖，在仓库根目录生成共享桥和主题资源：

```sh
npm ci --prefix web
node harmony/scripts/build-web-bridge.mjs
node harmony/scripts/build-native-theme.mjs
node --test harmony/tests/*.test.mjs ios_next/tests/web-schedule-bridge.test.mjs
```

1. 用 DevEco Studio 打开 `harmony` 目录。
2. 登录当前“药大拾间”开发者账号，并为 `cn.lizmt.cpuweb` 配置签名证书。
3. 锁屏卡片需在 AppGallery Connect 的“开放能力接入”开启“锁屏卡片”，并重新生成包含该能力的发布 Profile。
4. 执行 `Build Hap(s) / APP(s)`。

当前开发机命令行构建：

```powershell
$env:DEVECO_SDK_HOME = 'D:\DevTools\Huawei\DevEcoStudio-6.1.1.300\sdk'
$env:NODE_HOME = 'D:\DevTools\Huawei\DevEcoStudio-6.1.1.300\tools\node'
$env:Path = "$env:NODE_HOME;$env:Path"
& 'D:\DevTools\Huawei\DevEcoStudio-6.1.1.300\tools\hvigor\bin\hvigorw.bat' `
  --mode module -p product=default -p module=entry@default -p buildMode=debug assembleHap --no-daemon
```

无签名构建只能证明 ArkTS、资源和打包流程可编译，不能证明真机登录、服务卡片权限、后台刷新或上架签名可用。真机验收需覆盖登录恢复、本科／研究生课表、快速切周、账号切换、断网恢复、所有桌面／锁屏卡片尺寸、深浅模式及冷／热启动深链。

本次源码与模拟器验证的范围、证据及未验证项见 [独立核查记录](docs/independent-audit-20260908.md)。GitHub Actions 会检查随包桥／主题资源未过期，并执行课表回归测试；Linux 部署产物不等同于已签名的 HarmonyOS 发布包。
