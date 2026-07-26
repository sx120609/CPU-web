# 药大拾间桌面端

面向 Windows 与 macOS 的 Electron 客户端。**主窗口直接就是药大拾间主站**，在此之上提供三样网页做不到的能力：

1. **校园网自动认证** —— 后台探测连通性，掉线自动重连，开机自启，常驻托盘
2. **学习通窗口** —— 独立的受控 Chromium 会话，内置学习辅助脚本
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

### 凭据与退避

学号密码走 `safeStorage`，存在与设置分开的独立文件，只在发起认证时解密，从不进渲染进程 —— `campus:state` 只返回 `hasCredential` 与学号。日志脱敏无条件生效。

连续认证失败会指数退避（带抖动），达到上限后进入暂停状态等待人工处理。服务端返回的消息若指向账号/密码/欠费，**立即**暂停而不等计数 —— 用错误密码每隔几秒撞一次学校的认证服务器，有被封锁的实际风险。

## 学习辅助脚本

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

只产出一个 Windows x64 安装包，写入 `release/`。不做 portable、不做 macOS —— 用户群是校内学生，多给一种格式只会增加"该下哪个"的困惑。

欢迎页不是 MUI 的默认样子。默认向导是左边一条 164px 窄图、右边一片白底加两行系统字 —— 和所有别的向导长得一样。[build/installer.nsh.source](build/installer.nsh.source) 把图控件放大到整个内页对话框，隐藏 MUI 自带的标题与正文控件（文案已经画进图里），再按控件的新尺寸从磁盘重新 `LoadImage` 一次。

最后这一步是必需的：MUI 建页时已经用 `NSD_SetStretchedImage` 把位图压到侧边条尺寸，直接放大控件等于把压烂的小图再拉回来，汉字笔画会糊成一团。同理 [scripts/build-installer-assets.cjs](scripts/build-installer-assets.cjs) 里欢迎图落盘时降到 1x —— NSIS 拉伸走的是最近邻，2x 图被它硬砍一半会把细笔画直接抽掉。

许可页去掉了：使用边界改在首启引导里讲，那里能好好排版，而不是塞进一个滚动文本框。

安装器其余部分按非技术用户配置：

| 配置 | 值 | 理由 |
|---|---|---|
| `oneClick` | `false` | 要有向导才谈得上"好看"——`true` 是全程无界面，装完什么都没看见 |
| `allowToChangeInstallationDirectory` | `false` | 保留向导但不问装到哪，三步走完：欢迎 → 装 → 完成 |
| `perMachine` + `allowElevation` | `false` | 装到当前用户目录，全程不弹 UAC |
| `runAfterFinish` | `true` | 装完直接打开，省一步 |
| `installerLanguages` / `electronLanguages` | 仅 `zh_CN` | 安装包体积小一些，界面不会串英文 |
| `deleteAppDataOnUninstall` | `true` | 本地存着校园网密码与登录凭据，卸载就该一并清掉 |

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

## 更新提示

客户端启动 8 秒后向主站查一次 `GET /api/site/downloads/desktop`，把返回的 `version` 与本地版本按段做数值比较，发现新版就发系统通知，并在「PC 小工具」面板顶部显示一条提示，点「去下载」用系统浏览器打开下载地址。

**刻意不做静默下载替换**：electron-updater 在 Windows 上靠签名里的发布者信息验证更新包，未签名就只能关掉校验，那等于在所有用户机器上装了一条不可验真的代码执行通道。现在的做法里，用户仍然自己决定运行安装包，信任锚点是主站的 HTTPS 证书。拿到签名证书后可以换成 electron-updater 做真正的自动更新。

发新版时服务端要同时更新两个环境变量：

```env
DESKTOP_APP_DOWNLOAD_URL=https://你的云盘直链/药大拾间桌面端-x.y.z-win-x64-安装版.exe
DESKTOP_APP_VERSION=x.y.z
```

`DESKTOP_APP_VERSION` 留空时不会提示更新（无从比较），只会让下载按钮可用。

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
- 答案全部来自药大拾间后台配置的校园 AI 通道，消耗用户的每日额度；模型由站点后台设定，客户端不参与选择。
- 本客户端默认不保存任何密码。校园网密码在用户点「保存凭据」后、学习通账号密码在用户打开「记住密码」开关后，才经系统安全存储（`safeStorage`）加密保存在本机；清除或关闭即删除，密码从不上传。退出登录会向服务端撤销 access token 并清除本地会话数据。
- 使用者应自行判断使用边界并遵守所在学校的学术规范。
