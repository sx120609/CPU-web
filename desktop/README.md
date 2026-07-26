# 药大拾间桌面端

面向 Windows 与 macOS 的 Electron 客户端。**主窗口直接就是药大拾间主站**，在此之上提供三样网页做不到的能力：

1. **校园网自动认证** —— 后台探测连通性，掉线自动重连，开机自启，常驻托盘
2. **学习平台窗口** —— 独立的受控 Chromium 会话，内置学习辅助脚本
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

两个 preload 互不可见：主站窗口挂 `site-preload.ts`（`window.CPUDesktop`），学习平台窗口挂 `learning-preload.ts`（`window.cpuDesktopBridge`）。主站拿不到脚本代理，学习平台也拿不到桌面端能力。

配套约束：

- 全应用只接受 `https`。`http`、`file`、`data`、`javascript` 等一律拒绝。
- 白名单以外的地址交给系统默认浏览器，不在应用内打开。
- `will-navigate`、`will-redirect`、`setWindowOpenHandler` 三处都走同一套判定，并通过 `web-contents-created` 对每一个 webContents 生效，不依赖逐窗口挂载。
- 特权 preload 只挂在应用自己创建的学习窗口上。
- `webview` 标签禁用，权限请求默认全部拒绝（只放行视频全屏）。
- 打包版不提供开发者工具菜单。

## 特权桥的授权模型

用户脚本需要绕过同源策略发请求（题库查询、图片下载），这条通道由主进程代理。仅仅能访问 `window.cpuDesktopBridge` 不构成授权，每次调用要同时通过三道校验：

1. **一次性票据**：主进程在注入脚本时生成 nonce 并放进脚本闭包，页面导航或窗口销毁即回收。
2. **调用方归属**：票据必须来自发放它的那个 webContents。
3. **发起 frame 的地址**：调用发生时，该 frame 必须仍停在脚本 `@match` 与 `injectableHosts` 的交集内 —— 页面里的第三方 iframe（广告、统计）借不到道。

代理请求本身另有限制：只允许 GET/POST；请求头走白名单（不允许脚本自造 `Cookie`/`Authorization`/`Origin`/`Referer`）；每一跳重定向都重新校验目标；有超时与响应体大小上限；**只有超星系域名带会话 Cookie，第三方题库接口一律匿名请求**。

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
npm run dist:mac
```

产物写入 `release/`。

尚未配置代码签名 —— Windows 未签名安装包会触发 SmartScreen，macOS 未公证的包默认无法打开。正式分发前需要准备：

- Windows：OV/EV 代码签名证书，或 Azure Trusted Signing
- macOS：Apple Developer ID 证书，且必须在 macOS 构建机上完成签名与公证（`build/entitlements.mac.plist` 已备好）

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
│   └── learning-preload.ts # 学习平台窗口的特权桥（全局名 cpuDesktopBridge）
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

- 本客户端内置的学习辅助脚本为第三方作品，授权状态尚未解决，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
- 脚本答题会向第三方题库接口发送题目文本；AI 解答走药大拾间的校园 AI 通道并消耗用户的每日额度。
- 本客户端不保存学校密码，也不保存学习平台的账号密码。退出登录会向服务端撤销 access token 并清除本地会话数据。
- 使用者应自行判断使用边界并遵守所在学校的学术规范。
