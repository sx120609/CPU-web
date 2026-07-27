# 药大拾间桌面端

面向 Windows 与 macOS 的 Electron 客户端。**主窗口直接就是药大拾间主站**，在此之上提供三样网页做不到的能力：

1. **校园网自动认证** —— 后台探测连通性，掉线自动重连，开机自启，常驻托盘
2. **学习通窗口** —— 独立的受控 Chromium 会话，内置“药大拾间·学习通助手”
3. **原生桥** —— 主站可通过 `window.CPUDesktop` 调用桌面端能力

主站加载不出来时（校园网未认证、断网、站点故障）会落到本地启动台 —— 这一页必须存在，因为校园网登录恰恰要在主站不可达的时候用。

## 这不是通用浏览器

这是本客户端最重要的设计约束，实现集中在 [electron/policy.ts](electron/policy.ts)，由 [scripts/policy-test.cjs](scripts/policy-test.cjs) 的断言守着。

应用维护两张白名单，可注入范围严格窄于可导航范围：

| 白名单 | 作用 | 当前成员 |
|---|---|---|
| `navigableHosts` | 允许在应用窗口内打开 | 主站、`chaoxing.com`、`nbdlib.cn`、`hnsyu.net`、`gdhkmooc.com`、`cpu.edu.cn` |
| `injectableHosts` | 允许注入用户脚本、允许持有脚本特权桥 | 只有 `chaoxing.com`、`nbdlib.cn`、`hnsyu.net`、`gdhkmooc.com` |

两处收窄是有意的：

- `cpu.edu.cn` 只可导航不可注入。超星机构账号登录会跳转学校统一认证，不放行会导致登录中断；但统一认证页面不该被注入脚本，更不该拿到特权桥。
- **主站也只可导航不可注入。** 刷课脚本没有任何理由跑在自己的站点上，跑了就等于把脚本特权桥递给主站页面。主站拿到的是另一个桥（见下）。

两个 preload 互不可见：主站窗口挂 `site-preload.ts`（`window.CPUDesktop`），学习通窗口挂 `learning-preload.ts`（`window.cpuDesktopBridge`）。主站拿不到脚本代理，学习通也拿不到桌面端能力。

配套约束：

- 注入与特权桥只接受 `https`。`file`、`data`、`javascript` 等一律拒绝。
- **边界靠"没有地址栏"守，不靠拦截跳转。** 用户没有任何主动输网址的入口，只能顺着白名单站点上的链接走；因此页面点出来的链接一律留在应用里开新标签，不再踢去系统浏览器。早先那版会踢，结果是超星登录链路中间有一跳是明文 `http`，整个登录被弹到系统 Chrome 里，会话断在半路。
- 留在应用里只决定"在哪儿渲染"，不放宽任何能力：`injectableHosts` 之外拿不到用户脚本，也拿不到特权桥。
- `will-navigate`、`will-redirect`、`setWindowOpenHandler` 三处都走同一套判定，并通过 `web-contents-created` 对每一个 webContents 生效，不依赖逐窗口挂载。
- 特权 preload 只挂在应用自己创建的学习窗口上。
- `webview` 标签禁用，权限请求默认全部拒绝（只放行视频全屏）。
- 打包版不提供开发者工具菜单。

## 特权桥的授权模型

用户脚本需要绕过同源策略发请求（题目配图下载等），这条通道由主进程代理。仅仅能访问 `window.cpuDesktopBridge` 不构成授权，每次调用要同时通过三道校验：

1. **一次性票据**：主进程在注入脚本时生成 nonce 并放进脚本闭包，页面导航或窗口销毁即回收。
2. **调用方归属**：票据必须来自发放它的那个 webContents。
3. **发起 frame 的地址**：调用发生时，该 frame 必须仍停在脚本 `@match` 与 `injectableHosts` 的交集内 —— 页面里的第三方 iframe（广告、统计）借不到道。

代理请求本身另有限制：只允许 GET/POST；请求头走白名单（不允许脚本自造 `Cookie`/`Authorization`/`Origin`/`Referer`）；每一跳重定向都重新校验目标；有超时与响应体大小上限；**只有超星系域名带会话 Cookie，其余目标一律匿名请求**。

AI 请求体按服务端 `/api/oauth/v1/responses` 接受的字段做严格白名单，其余字段丢弃。access token 始终留在主进程，不下发渲染进程。

## 校园网自动认证

协议移植自 [cpu_net](https://github.com/SoraNoNeko/cpu_net)（GPL-3.0），实现在 [electron/campus-net/](electron/campus-net/)。认证请求全程走主进程的 `node:http` / `node:dgram`，不经任何 BrowserWindow —— 所以应用其余部分的 https-only 白名单一行都不用为它放宽。

### 只在真的身处校园网时才认证

原实现不判断网络环境：不管人在哪，掉线就往校园网网关撞，撞不通就退避、报错，最后弹「认证失败」。在家用的人会被这套流程反复打扰。

这里多了一层环境判定（[environment.ts](electron/campus-net/environment.ts)）：

1. 先探连通性。能上网就什么都不做 —— 在校内还是在家里都一样。
2. 上不了网时，才去问两个校园网网关在不在。DrCOM 的 `chkstatus` 只在校内可达，收到任何响应就说明人在校园网里。
3. 网关都不应答 → 判定为 `off-campus`，**不尝试认证**，不计失败次数，轮询间隔放宽到 2 分钟。
4. 网关应答 → 用应答的那个决定接入方式，比按 IP 段猜准确。用户显式指定的方式优先；它的网关没应答而另一个应答了，就按实际网络走并记一条日志。

原版的 IP 段启发式判不出「不在校园网」—— 它只会在两种校内接入方式之间二选一。VPN 隧道地址、手机热点、家用 NAT 都会被判成某种校内接入，然后一路撞下去。

### 换网络即时响应

轮询之外还有两个即时信号：`powerMonitor` 的 `resume` / `unlock-screen`，以及网卡地址指纹变化（纯本地读取 `os.networkInterfaces()`，不发请求）。从校外走进校园、切换 WiFi、插拔网线都会立刻触发一次检测，不用等下一个周期。

轮询本身采用分级调度：网络稳定连通后至少间隔 30 秒再做一次轻量探测；认证成功后先按用户设置的基础间隔快速复核；认证失败继续指数退避；确认在校外则放宽到 2 分钟。这样不会让常驻后台的客户端每几秒持续唤醒网络，同时保留校园网掉线后的恢复速度。

### 凭据与退避

学号密码走 `safeStorage`，存在与设置分开的独立文件，只在发起认证时解密，从不进渲染进程 —— `campus:state` 只返回 `hasCredential` 与学号。日志脱敏无条件生效。

连续认证失败会指数退避（带抖动），达到上限后进入暂停状态等待人工处理。服务端返回的消息若指向账号/密码/欠费，**立即**暂停而不等计数 —— 用错误密码每隔几秒撞一次学校的认证服务器，有被封锁的实际风险。

## 贡献与上游

- 学习通助手集成与客户端初版由 **Mom0ka27** 贡献开发。
- 桌面客户端的校园网连接模块基于真红（SoraNoNeko）的 [cpu_net](https://github.com/SoraNoNeko/cpu_net) 项目修改，并针对 Electron、安全存储、日志脱敏与自动重连做了适配。
- 内置学习通辅助脚本基于 shushoujiu 的满分助手修改并获授权；完整来源、修改内容和运行时依赖见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

客户端工具页的“关于”区域会同步展示当前版本、上述贡献来源、开源许可和非学校官方声明。

## 药大拾间·学习通助手

脚本本身见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。这里说的是客户端怎么驾驭它。

### 配置权收在客户端

脚本原本的配置面板入口被隐藏了（客户端注入时处理），而且**就算不隐藏也不好用**：脚本内部同时存在四份互不同步的配置副本 —— 模块级快照、`Cx` 实例快照、以及两个**不同 pinia 实例**各持一份的 store。从它自己的面板保存，只会改到其中一份，另外几份照旧。这是「改了没反应」的真正根因。

所以配置改由客户端持有：存在 `preferences.json` 的 `scriptConfig` 里，注入时通过 `GM_getValue` 一次性喂给脚本，脚本自己改配置也会经 `GM_setValue` 回传，两边始终是同一份。

[script-config.ts](electron/script-config.ts) 负责两件事：

**给全所有键。** 脚本的 `getConfig()` 不做 merge，缺键就是 `undefined`，而后果不是报错而是静默变危险：

- 缺 `interval` / `answerInterval*` → `sleep(undefined)` 算出 `NaN` → 逐题瞬间作答
- 缺 `minAccuracy` → `正确率 < undefined` 恒为 `false` → **正确率 0% 也会自动提交**

**夹回危险取值。** 脚本对这些值零校验：间隔填 0、最小值大于最大值都会让它秒答秒交。这些只能在客户端拦。

界面只暴露真正有读取点的 15 项。脚本自带表单里那个「自动答题」开关全文没有任何读取点，是装饰品，没有放进来。

### 哪些设置要重开窗口

脚本在窗口打开时对配置做快照，所以：

| 改动 | 生效时机 |
|---|---|
| AI 开关 | 立即生效（脚本每道题现读现用） |
| 四个自动化开关、五个间隔、正确率阈值 | **要重新打开学习通窗口** |

设置界面会在改到后者时提示。

### 运行状态回传

脚本自己的面板只保留 20 条日志，且关掉面板就什么都看不见。客户端在脚本的日志与状态出口各加了一行上报（`GM_cpuReport`），把消息转发到主进程存一份，「PC 小工具」面板里能直接看到当前进度与最近日志，不用去学习通窗口里找那个悬浮球。

### 云端脚本更新

从客户端 0.1.2 起，学习通助手不再必须跟随安装包升级。服务端从仓库内的
`desktop/assets/userscripts/monkey.js` 提供版本清单与脚本正文：

- `GET /api/site/userscripts/chaoxing-helper`：名称、版本、大小、SHA-256 与固定正文路径
- `GET /api/site/userscripts/chaoxing-helper/source`：服务器本地脚本正文

客户端启动 4 秒后检查一次，常驻期间每 6 小时检查一次。新正文会先校验名称、版本、大小与
SHA-256，再与安装包内脚本比较 `@match`、`@require`、`@resource`、`@connect` 权限声明。
只有权限边界完全相同才会写入本机缓存；任何一步失败都继续使用上次已校验缓存或内置脚本。
脚本刚更新时不强行重载正在做题的页面，下次进入课程/章节时生效。

这意味着正文逻辑和文案可以随主站部署更新；一旦需要新增可注入页面、联网域名或依赖，仍必须
提升客户端版本并走完整审核、打包与发布流程。

## 学习通「记住密码」

工具页有一个默认关闭的「记住学习通账号密码」开关。开着的时候，在超星账号登录页（`passport2.chaoxing.com`）点登录，输入的账号密码会被 `safeStorage` 加密存进用户数据目录的独立文件（[chaoxing-credentials.ts](electron/chaoxing-credentials.ts)）；下次再打开登录页自动填好。关掉开关或点「清除」即删除文件。

信任边界与校园网凭据一致，只多一件事：密码必须回到登录页的输入框里，否则填不了。为此收窄成 ——

- 明文凭据只经 `chaoxing:credential` 一条通道下发，主进程校验发起 frame 此刻确实停在超星登录页（https + 域名精确匹配），且属于学习通标签；其余来源一律回 `null`。
- 应用外壳（工具页）只能拿到打码后的账号与 `hasCredential`，拿不到密码。
- 开关关闭时主进程对登录页也回 `null`，preload 连输入框都不碰、不装任何捕获钩子。
- 捕获只在登录动作发生时读一次输入框（点登录按钮 / 回车），短信与二维码登录读不到密码，自然不会存。

## 依赖本地化

用户脚本声明了 9 个 `@require` 与 2 个 `@resource`，原本每次打开页面都从公共 CDN 现取现 `eval`。这既意味着校园网不通就用不了，也意味着 CDN 被投毒等于在所有用户的超星会话里执行任意代码。

现在这些依赖随包分发：

```bash
npm run vendor:deps     # 按用户脚本元数据抓取依赖，写入 assets/vendor/ 并生成 manifest.json
npm run vendor:verify   # 校验本地副本与清单中的 SHA-256 是否一致
```

主进程优先读本地副本，缺失时才回落到网络。改动用户脚本的 `@require`/`@resource` 后需要重新执行 `vendor:deps`。

## 本地运行

```bash
npm install
npm start
```

`npm install` 需要放行 Electron 的 postinstall（它负责下载 Chromium 二进制）。`package.json` 里的 `allowScripts` 已声明，只放行 `electron` 一项。若装完 `node_modules/electron/dist/` 是空的，执行 `npm rebuild electron`。

## 校验

```bash
npm run typecheck    # TypeScript 类型检查
npm test             # 地址策略断言 + vendor 依赖完整性校验
npm run test:smoke   # 真实启动一次 Electron，确认主进程不崩、资源路径解析正确
```

`test:smoke` 存在的理由：首页与用户脚本都靠 `app.getAppPath()` 解析路径，这类路径错了不会报错，只会表现为"窗口开着但什么都没发生"。

## 打包

```bash
npm run dist:win
```

Windows x64 安装包写入 `release/`。Apple Silicon macOS 产物由
`.github/workflows/desktop-release.yml` 在 macOS runner 上构建；推送 `desktop-v*` 标签时，
Windows 与 macOS 先分别通过测试和打包校验，再合并发布到同一个 GitHub Release。

### 安装界面不用 NSIS 画

NSIS 的向导界面本质是 Win32 对话框资源：按钮、进度条都是系统控件，能改的只有贴图和显隐。无论怎么换图，底下那条「上一步 / 下一步 / 取消」的灰色按钮栏都还在，一眼就是 1999 年的东西。这是框架的天花板，不是配置问题。

所以真正的安装交互**不经 NSIS**。打包目标使用 `portable`：它先把应用解压到临时目录，
随后启动自定义安装窗口。解压阶段只显示系统原生的「启动预热中」文字与真实进度条；
没有位图、欢迎页、按钮栏或确认弹窗，所以在高 DPI 屏幕上仍然清晰。压缩级别采用 `normal`，
在安装包体积和首次启动速度之间取平衡，避免 `maximum` 高压缩导致长时间无反馈。
NSIS 在这里只负责解压和启动，不负责安装流程。

用户看到的第一个界面是 [src/installer/](src/installer/)：一个无边框、圆角、可拖动的 Electron 窗口，HTML/CSS 写的，视觉语言与首启引导一致。一个「立即安装」按钮，点了原地变进度条，装完自动启动正式版。**打开不会自动开始安装**，这是刻意的。

复制文件、建快捷方式、写卸载项都在 [electron/self-install.ts](electron/self-install.ts)。几个必须处理对的点：

- **环境变量要剥干净。** 便携壳用 `ExecWait` 运行我们，`spawn` 默认继承环境；不显式删掉 `PORTABLE_EXECUTABLE_FILE`，装完启动的正式版会以为自己也是安装态，无限套娃。
- **不参与单实例锁。** 覆盖安装时正式版往往正开着，安装态若去抢锁会直接退出，表现为"双击没反应"。
- **覆盖正在运行的旧版靠改名而不是删除。** Windows 允许重命名正在运行的可执行文件，不允许删除。覆盖失败就把旧文件挪成 `.old-xxx`，下次正常启动时由 `sweepReplacedFiles()` 清掉。
- **卸载是自己删自己。** 进程活着时删不掉自身目录，所以交给一个脱离的 `cmd` 等两秒再 `rmdir`。

卸载项写在 `HKCU\...\Uninstall\cpu-web-desktop`，不需要管理员权限，`UninstallString` 指向正式版 exe 加 `--uninstall`。安装落点沿用旧 NSIS 版的 `%LOCALAPPDATA%\Programs\cpu-web-desktop`，让老用户就地升级而不是并存两份。

### 拿到证书后怎么接

**不要用自签证书。** Windows 判断的是证书链能否追到系统内置的根证书颁发机构，自签的链不到，结果是 SmartScreen 照样弹、部分对话框还会显示「此发布者不受信任」——比不签更可疑。要让它生效得把你的根证书装进每台用户机器的受信任根存储，需要管理员权限逐台操作，分发场景不成立。自签唯一的正当用途是验证签名流水线通不通，不该发给用户。

electron-builder 会自动读这两个环境变量，**代码与配置都不用改**：

```bash
CSC_LINK=/绝对路径/cert.pfx      # 也接受 base64 内容或 https 地址
CSC_KEY_PASSWORD=证书密码
```

设了就签，没设就出未签名包（现在的状态）。硬件令牌或云签名服务走各自的 CSP/KSP，届时改用 `win.signtoolOptions` 或 `win.azureSignOptions`。

三条现实可行的路，按适合本项目排序：

| 路子 | 价格 | 说明 |
|---|---|---|
| [SignPath 开源计划](https://signpath.io/solutions/open-source-community) | 免费 | 本项目是 AGPL 开源，符合目标人群。给 OV 级签名，走它托管的流水线。优先试这条 |
| [Certum 开源证书](https://certum.store/open-source-code-signing-code.html) | 约 ¥200–800/年 + USB 令牌 | 个人可申请，需身份验证，令牌需邮寄 |
| [Azure Trusted Signing](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options) | $9.99/月 | 已对个人开放，但仅限美/加/欧盟/英国的企业与自雇个人 |

传统 OV/EV 证书（¥1000–3000+/年）要营业执照，个人开发者一般卡在这一步。另外 2023 年起 CA/B 论坛强制代码签名私钥必须存放在 FIPS 硬件令牌或云签名服务中，"买个 pfx 文件直接用"已不再可行。

### 没有代码签名的后果

安装包未签名，用户首次运行会看到「Windows 已保护你的电脑 / 未知发布者」，需要点「更多信息 → 仍要运行」。这一步无法通过配置绕过，只能靠说明 —— 站内「PC 小工具」面板的下载区已经写了这段提示。

想消掉这个提示需要代码签名证书。除传统 OV/EV 证书外，个人开发者可考虑 Azure Trusted Signing（按月计费，需要可验证的开发历史）或 SignPath 的开源项目免费计划。

## macOS（仅 Apple Silicon）

macOS 只构建 `arm64`，支持 M1/M2/M3/M4 及后续 M 系列芯片，不提供 Intel 或 universal 包。Windows 上无法可靠地产出并验证 Mac 应用，因此发布流水线固定使用 GitHub Actions 的 Apple Silicon `macos-15` runner：

```bash
npm ci
npm test
npm run test:smoke
npm run dist:mac:arm64
```

流水线会生成 ICNS 图标、构建 DMG 与 ZIP、检查主可执行文件只有 `arm64`、验证 ad-hoc 签名、检查 ASAR 必需资源，并输出 SHA-256 校验文件。校园网协议本身使用跨平台的 Node `http` / `dgram` / `os.networkInterfaces()`；Windows 自安装器、卸载器、注册表与 EXE 静默更新则在主进程入口被平台判断隔离。由于目前没有校园网内的实体 Mac，CI 能证明应用在 M 芯片机器上可以启动和打包，但不能代替真实 Wi-Fi、睡眠唤醒、切网与校园网认证测试。

### 没有 Apple Developer ID 时首次打开

当前产物只有 ad-hoc 完整性签名，没有 Apple Developer ID 签名与 Apple 公证，因此从浏览器下载后会被 Gatekeeper 标记为“无法验证开发者”。小白用户按下面做即可：

1. 打开 DMG，把“药大拾间桌面端”拖入“应用程序”。
2. 先正常双击应用一次；看到拦截提示后关闭提示。
3. 打开“系统设置 → 隐私与安全性”，向下滚动到“安全性”区域。
4. 找到“已阻止使用‘药大拾间桌面端’”一项，点击“仍要打开”。
5. 使用登录密码或 Touch ID 确认，再点一次“打开”。后续启动不会重复这套流程。

“仍要打开”只会在刚刚尝试过启动后出现。另一条更短的路径是：在“应用程序”里右键应用 → “打开” → 再确认“打开”。**不要关闭 Gatekeeper，也不需要运行 `xattr`、`spctl` 等终端绕过命令。**

要彻底消除这一步，需要加入 Apple Developer Program，使用 Developer ID Application 证书签名，再提交 Apple notarization；ad-hoc 签名不能替代它。

## 更新提示

Windows 客户端启动 8 秒后向主站查一次 `GET /api/site/downloads/desktop`，把返回的 `version` 与本地版本按段做数值比较。配置 PDS 分享后，客户端会在后台静默下载，按服务端下发的内容哈希验真，下载完成后提示；退出应用时自动安装，也可在工具页立即重启更新。

macOS 客户端向 `GET /api/site/downloads/desktop-mac` 检查版本，但当前只提示并打开 DMG 下载页，不在后台替换应用。没有 Developer ID 与公证时做静默自更新会把 Gatekeeper、完整性验证和应用退出时机混在一起，故意不启用。

推荐长期分享一个固定文件夹，内部按 `Windows` / `macOS` 分目录。发新版时只需上传新包：服务端会递归目录，为 Windows 选择最后更新的 `.exe`，为 Mac 选择最后更新的 Apple Silicon `.dmg`；每次下载请求再临时换取直链，因此 PDS 临时地址变化不会影响站点入口。

```env
DESKTOP_PDS_SHARE_URL=https://你的企业版域名.apps.aliyunfile.com/disk/s/分享ID?domainId=你的企业版域名
DESKTOP_PDS_SHARE_PASSWORD=
DESKTOP_APP_VERSION=
```

PDS 模式会从标准文件名（如 `药大拾间桌面端-0.1.2-win-x64-安装版.exe`、`药大拾间桌面端-0.1.2-mac-arm64.dmg`）自动提取版本号；`DESKTOP_APP_VERSION` 仅在需要覆盖文件名版本时填写。未配置 PDS 时 Windows 仍会回落到 `DESKTOP_APP_DOWNLOAD_URL` 与 `DESKTOP_APP_DOWNLOAD_PASSWORD`，macOS 则保持“尚未发布”，避免错发 Windows 安装包。

## 配置

默认指向 `https://cpu.lizmt.cn`，OAuth 客户端 ID 为 `cpu-electron`（与服务端 `OAUTH_CLIENT_ID` 的默认值一致）。可用环境变量在构建/运行时覆盖：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `CPU_DESKTOP_ORIGIN` | `https://cpu.lizmt.cn` | 主站地址，必须是 https |
| `CPU_DESKTOP_CLIENT_ID` | `cpu-electron` | OAuth 客户端 ID，需与服务端一致 |

其余品牌与白名单配置集中在 [electron/config.ts](electron/config.ts)。

## 目录结构

```text
desktop/
├── electron/
│   ├── main.ts             # 窗口、托盘、脚本注入、IPC 特权桥、应用生命周期
│   ├── policy.ts           # 地址策略：可导航 / 可注入的唯一判定处
│   ├── shared.ts           # URL 与 @match 匹配工具，主进程与测试共用
│   ├── config.ts           # 品牌、OAuth、白名单、各项上限
│   ├── oauth.ts            # Authorization Code + PKCE 登录、用户信息、登出与撤销
│   ├── oauth-store.ts      # safeStorage 加密的会话存储
│   ├── home-preload.ts     # 首页的受限桥（全局名 cpuDesktopHome）
│   └── learning-preload.ts # 学习通窗口的特权桥（全局名 cpuDesktopBridge）
├── src/home/               # 首页（原生 HTML/CSS/JS，非 Vue）
├── assets/
│   ├── userscripts/        # 内置用户脚本
│   ├── vendor/             # 本地化的脚本依赖 + manifest.json
│   └── tray-icon.png
├── build/                  # 打包资源：图标、macOS entitlements
├── scripts/                # vendor-deps / policy-test / smoke-test
└── THIRD_PARTY_NOTICES.md  # 第三方组件与许可声明
```

## 与主仓的关系

本子项目**不参与主仓的部署链路**：根目录的 `install:all`、`postinstall`、`build`、`deploy.sh` 都不会触及 `desktop/`。这是刻意为之 —— 校园服务器上部署主站时没有理由下载 200 MB 的 Electron 二进制。

根目录提供了独立入口：

```bash
npm run desktop:install
npm run desktop:build
npm run desktop:test
npm run desktop:dist:win
```

## 边界与免责

- 内置学习辅助脚本的来源与授权见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
- 答案来自独立的答题 AI 通道，只发送当前题干、选项与题目图片，不注入站内知识库、历史会话或用户资料；调用会消耗用户的每日额度，模型由站点后台设定，客户端不参与选择。
- 本客户端默认不保存任何密码。校园网密码在用户点「保存凭据」后、学习通账号密码在用户打开「记住密码」开关后，才经系统安全存储（`safeStorage`）加密保存在本机；清除或关闭即删除，密码从不上传。退出登录会向服务端撤销 access token 并清除本地会话数据。
- 使用者应自行判断使用边界并遵守所在学校的学术规范。
