# 第三方组件声明

本目录（`desktop/`）随包分发下列第三方内容。它们各自的版权归原作者所有，**不适用本仓库顶层 LICENSE 的授权条款**。

---

## 1. 内置用户脚本

| 项目 | 内容 |
|---|---|
| 文件 | `assets/userscripts/monkey.js` |
| 基于 | 💯【超星学习通满分助手】v2.1.6 |
| 原作者 | shushoujiu |
| 来源 | GreasyFork 脚本 [436994](https://greasyfork.org/scripts/436994) |
| 授权 | 已取得原作者授权，可修改并随本客户端分发 |

本仓库分发的是在原脚本基础上的修改版。原脚本元数据头中的 `@name`、`@author`、`@version`、`@namespace`、`@description`、`@antifeature`、`@downloadURL`、`@updateURL` 均原样保留，未做删改。

本仓库所做的修改：

- 重命名自定义 AI 桥接函数为 `GM_cpuAIRequest`，改为经宿主 IPC 调用药大拾间的 AI 接口
- 收窄 `@match` 范围（移除 `*://*.edu.cn/*` 泛匹配，其余限定 `https://`）
- 移除向第三方题库伪造 `X-Forwarded-For` / `X-Real-IP` 请求头的代码
- 移除向第三方题库发送超星用户 ID（`_uid`）的请求头
- 两个第三方题库接口由明文 HTTP 改为 HTTPS
- 清理失效配置项 `aiApiUrl` 与两条无用的 `@connect`
- 修复图片 content-type 未规范化导致带图题目请求失败的缺陷

脚本的运行配置由客户端接管（见 `desktop/README.md` 的「学习辅助脚本」一节），不再依赖脚本自带的配置面板。

---

## 2. 校园网认证模块 — 移植自 cpu_net（GPL-3.0）

| 项目 | 内容 |
|---|---|
| 目录 | `electron/campus-net/` |
| 来源 | [SoraNoNeko/cpu_net](https://github.com/SoraNoNeko/cpu_net) —— CPU 网络连接助手 |
| 原实现 | C# / WPF / .NET |
| 许可 | **GPL-3.0** |

本目录下的校园网认证协议（网关地址、端口、URL 参数拼接规则、运营商后缀、JSONP 响应解析、
IP 段模式判定、连通性探测策略）是对 cpu_net 相应逻辑的**重新实现与移植**，属于衍生作品。

**许可关系是干净的**：GPLv3 与本仓库采用的 AGPLv3 相互兼容（AGPLv3 第 13 条与 GPLv3 第 13 条
提供了双向的显式兼容条款），合并后的作品整体以 AGPL-3.0-or-later 分发即满足两者要求。
这与上文第 1 节那个未声明许可的用户脚本是**完全不同的情况**。

移植时相对原实现所做的修改，均已在 `electron/campus-net/` 的注释中就地说明，主要有：

- 学号密码由安装目录下的明文 `config.yaml` 改为 Electron `safeStorage` 加密存储，且与非敏感设置分文件
- 日志脱敏无条件生效（原版把"不写明文密码"挂在一个用户可开的开关上，默认会把含明文密码的完整登录 URL 写进日志并显示在界面）
- 密码做 `encodeURIComponent`（原版不编码，密码含 `&`/`%`/`+`/`#`/空格 会把 URL 拼坏）
- 学号增加 `trim` 与 `^[A-Za-z0-9]+$` 校验（原版只在键入时过滤，粘贴可绕过）
- 轮询改为自调度并加入 `inFlight` 防重入（原版是 `async void` 定时器，5 秒周期配 5 秒超时会让请求叠加）
- 新增指数退避与熔断（原版掉线后每 5 秒无限重试、密码错误也照撞，有被学校侧封锁的实际风险）
- 默认检测间隔由 5 秒放宽到 15 秒
- 设置改为整体覆盖写（原版的字段级 merge 导致布尔关不掉、数值设不回 0、运营商清不空）
- 新增 `powerMonitor` 唤醒/解锁事件触发检测

未移植：WPF 界面、SMTP 邮件通知、自制安装向导与卸载器、Velopack 自更新与更新代理配置、
手写注册表自启（改用 `app.setLoginItemSettings`）、`SetThreadExecutionState` 阻止休眠。
注销接口在原仓库中不存在，本移植也未实现。

宿舍电费查询未从 cpu_net 移植：主仓服务端已通过校内出站 Agent 实现同一能力，
客户端直连会把无鉴权的校内接口和签名盐一起打进安装包。

---

## 3. 用户脚本的运行时依赖

`assets/vendor/` 下的文件由 `npm run vendor:deps` 从公共 CDN 抓取，对应用户脚本元数据头声明的 `@require` 与 `@resource`。它们原本是每次打开页面时从 CDN 现取现 `eval`；改为随包分发是为了让校园网离线可用，并避免 CDN 被投毒时在用户的超星会话中执行任意代码。

文件名是依赖 URL 的 SHA-256 前 40 位，内容哈希记录在 `assets/vendor/manifest.json`，可用 `npm run vendor:verify` 校验。

| 组件 | 版本 | 许可 | 版权 |
|---|---|---|---|
| Vue | 3.3.4 | MIT | Evan You |
| vue-demi | 0.14.0 | MIT | Anthony Fu |
| Element Plus | 2.3.12 | MIT | Element Plus 贡献者 |
| Element Plus Icons Vue | 2.1.0 | MIT | Element Plus 贡献者 |
| Pinia | 2.1.6 | MIT | Eduardo San Martin Morote |
| jQuery | 3.7.1 | MIT | OpenJS Foundation 及贡献者 |
| jquery.nicescroll | 3.7.6 | MIT | InuYaksa |
| blueimp-md5 | 2.19.0 | MIT | Sebastian Tschan |

以上均为 MIT 许可，允许再分发，条件是保留版权声明与许可文本。各文件的压缩产物中保留了上游的版权注释。

### 需要单独说明的一项

| 项目 | 内容 |
|---|---|
| 文件 | `assets/vendor/7ca7baa134a89728b3574d70a00feddc77a603db.txt` |
| 来源 | `https://www.forestpolice.org/ttf/2.0/table.json` |
| 内容 | 约 347 KiB 的 JSON 映射表，用于还原超星页面的混淆字体字形 |
| 许可 | **未知**，来源站点未提供许可声明 |

该表由用户脚本的 `@resource ttf` 声明引入。若走上文第 1 节的"改为不内置"路线，这一项会随之消失。

---

## 4. 运行时框架

| 组件 | 许可 |
|---|---|
| Electron | MIT（内含 Chromium 与 Node.js，各自许可见安装目录下的 `LICENSES.chromium.html` 与 `LICENSE`） |

---

## 5. 品牌资源

`build/icon.png` 与 `assets/tray-icon.png` 取自本仓库 `web/public/icon-512-v3.png`，属于药大拾间站点的品牌标识，**不随代码开源许可授权**。二次分发或衍生项目请自行替换。
