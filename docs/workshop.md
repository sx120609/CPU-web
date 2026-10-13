# 创意工坊开发与维护

创意工坊接受自包含的 Web 小游戏、小工具与站点扩展 ZIP。作品提交后进入审核，审核通过的版本才可公开运行。包内容始终在独立 iframe 内运行；作者填写的姓名或其他元信息不能代替账号归属与审核记录。

## 从模板开始

站点提供三种通用模板：`/workshop/game-template.zip`、`/workshop/tool-template.zip` 与 `/workshop/extension-template.zip`。星星接力模板演示 canvas 游戏、菜单、暂停、结果、设置与最近战绩；文本透镜模板演示作者自定义输入、取消、进度、统计输出与可选草稿保存。

仓库内也可生成目录，无需新增依赖：

```sh
node workshop-sdk/bin/cli.mjs init game /tmp/my-game
node workshop-sdk/bin/cli.mjs init tool /tmp/my-tool
node workshop-sdk/bin/cli.mjs init extension /tmp/my-extension
```

生成目录结构：

```text
my-game/
  manifest.json
  index.html
  main.js
  AGENT-PROMPT.txt
  types/
    sdk-types.txt
    shells-types.txt
  workshop/
    sdk.js
    shells.js
    game-shell.css
```

工具使用 `tool-shell.css`。入口 HTML、模块、样式、字体与图片均使用包内相对 URL。开发时可自行使用 Vue、React 或其他构建工具，上传时只提供构建产物，不包含源码依赖目录。

本地预览必须显式启用。生成目录运行 `python3 -m http.server 8000 --directory /tmp/my-game`，在独立浏览器页打开 `http://localhost:8000/?preview=1`。模板只有检测到 `preview=1` 才调用 `createLocalPreviewSDK`；该适配器在 iframe 内拒绝运行。预览存档使用独立 localStorage 前缀，与工坊的账号存档无关。

```sh
node workshop-sdk/bin/cli.mjs pack /tmp/my-game /tmp/my-game.zip
```

打包器检查 manifest、文件类型、路径、符号链接、数量、大小及静态资源引用；ZIP 必须放在作品目录之外。自检不能代替服务端校验和人工审核。审核前应通过上传后的私有预览验证实际权限、屏幕尺寸和暂停行为。

## Agent 开发提示词

`/workshop/develop` 支持选择游戏、工具或站点扩展，填写需求后复制或下载完整中文开发提示词；HTTP 浏览器优先尝试兼容复制，失败时可手动选中复制或下载 TXT。提示词包含 Manifest、当前 SDK / 可选壳类型、最小权限、安全隔离、手机/电脑适配、生命周期清理、真机权限拒绝替代方案及交付检查。

提示词逻辑唯一来源为 `workshop-sdk/src/agent-prompt.js`，网页直接读取 SDK 类型源文件，CLI 生成模板时也读取相同源文件，避免页面与下载内容漂移。模板随附 `AGENT-PROMPT.txt` 和 `types/sdk-types.txt`（游戏/工具另有 `shells-types.txt`）；类型说明可在开发工程改名为 `.d.ts`，上传包不接受 `.ts` 文件。本地适配器只验证界面与基本逻辑，平台权限和生命周期必须在上传后的私有预览及真实设备中另行验证。

## Manifest v1

`manifest.json` 必须位于 ZIP 根目录，模板入口为 `index.html`；自定义入口可指向安全的包内 HTML 文件路径。

```json
{
  "schemaVersion": 1,
  "id": "my-star-game",
  "type": "game",
  "name": "我的星星游戏",
  "version": "1.0.0",
  "description": "点亮星星，获得分数。",
  "entry": "index.html",
  "permissions": ["storage"],
  "game": {
    "orientation": "portrait",
    "controls": ["pointer", "keyboard", "touch"],
    "aspectRatio": 0.5658
  }
}
```

- `id` 使用小写 kebab-case；账号归属和作品身份以服务端生成的 UUID 为准，不能通过 manifest 接管其他作者的作品。
- `type` 为 `game`、`tool` 或 `extension`；游戏需填写 `game.orientation` 和至少一种 `game.controls`，其他类型不能填写 `game`。站点扩展必须填写 `extension: {"slots":["splash","dialog"]}`，可仅声明其中一种位置，其他类型不能填写 `extension`。
- `version` 使用 semver，例如 `1.0.0`；名称与描述填写纯文本。
- `permissions` 可为空，支持 `storage`、`site.public`、`ui.toast`、`ui.confirm`、`navigation`、`fullscreen`、`motion.shake`，不得重复或填写未知权限。未声明的能力由宿主拒绝；修改权限需要上传新版本并重新审核。
- `orientation` 为 `portrait`、`landscape` 或 `any`；`aspectRatio` 为可选 0.1–10 数值（宽 / 高），作品仍需自行适配容器尺寸。

上传 ZIP 上限为 20 MiB，展开后总大小上限 60 MiB，最多 512 个文件，单文件最多 12 MiB，manifest 最多 16 KiB。禁止绝对路径、`..` 路径穿越、符号链接与可执行服务端代码；文件路径不能含空白、百分号、查询参数、片段标记或冒号。资源需在包内；网络请求受宿主 CSP 限制，不能使用主站任意接口。

## 运行通信

iframe 使用 `sandbox="allow-scripts"`，没有 `allow-same-origin`。因此不能直接访问主站 DOM、Cookie、localStorage 或账号凭据。SDK 通过一次握手建立 `MessageChannel`：

1. 子页面向父窗口发送 `{type:"cpu-workshop:ready", protocol:1}`。
2. 宿主验证 `event.source` 是当前作品 iframe，发送 `{type:"cpu-workshop:connect", protocol:1, appId:<作品 UUID>}`，并转交一个 `MessagePort`。
3. SDK 同样验证连接消息来自 `window.parent`，之后 RPC 与生命周期消息只走该端口。

握手需要使用 `postMessage(..., "*")`，因为沙箱页面拥有不透明 origin；来源验证与专属端口决定消息归属。SDK 默认请求超时 8 秒，等待用户确认的交互（包括导航）使用较长超时，连接失败会显示错误，不会自动退回拥有更多权限的运行模式。普通能力响应上限为 256 KiB，与单份存档的 64 KiB 上限分别校验。

请求格式为 `{type:"request", id, method, params}`，响应为 `{type:"response", id, result}` 或 `{type:"response", id, error:{code,message}}`。宿主仅接受下面列出的白名单方法。

| RPC 方法              | params                       | result / 行为                                                         |
| --------------------- | ---------------------------- | --------------------------------------------------------------------- |
| `env.get`             | `{}`                         | 环境、主题、容器尺寸、运行位置与能力列表；不含账号标识或凭据          |
| `storage.get`         | `{}`                         | 单份 JSON 存档，未保存时为 `null`                                     |
| `storage.set`         | `{value:<JSON>}`             | 替换该作品的整份 JSON 存档                                            |
| `storage.remove`      | `{}`                         | 删除该作品存档                                                        |
| `site.getInfo`        | `{}`                         | 网站公开名称和语言；需 `site.public`                                  |
| `site.listWorks`      | `{q?,type?,page?,pageSize?}` | 已公开作品的裁剪目录，单页最多 12 条；需 `site.public`                |
| `ui.toast`            | `{message,type?}`            | 带作品来源的纯文本提示；需 `ui.toast`                                 |
| `ui.confirm`          | `{title,message}`            | 主站确认面板，返回 `{confirmed}`；需 `ui.confirm`                     |
| `navigation.open`     | `{target}`                   | 仅 `workshop`、`games`、`tools`，用户确认后导航；需 `navigation`      |
| `fullscreen.request`  | `{}`                         | 用户在主站点击后申请全屏，返回 `{enabled,reason?}`；需 `fullscreen`   |
| `motion.requestShake` | `{}`                         | 用户在主站授权后监听摇动，返回 `{enabled,reason?}`；需 `motion.shake` |
| `runtime.close`       | `{}`                         | 关闭当前作品；不需要额外权限                                          |

`theme` 为 `light` 或 `dark`；`locale` 当前为 `zh-CN`。`storageAvailable` 反映当前存档能力，作者应支持没有存档权限或登录状态不足时的临时体验。存档按当前用户与服务端作品 UUID 隔离，不按包中自报的 `id` 决定访问范围。

生命周期消息为 `{type:"event", event, data}`，支持 `pause/resume`（`{reason}`）、`show/hide`、`themechange`（`{theme}`）、`resize`（`{width,height}`）和 `shake`（不含原始传感器值）。游戏收到 `pause` 必须停止计时、动画、输入与音频；收到 `resume` 后保持暂停界面，等待用户按“继续”。模板还监听 `visibilitychange`，隐藏后自动暂停。工具壳在宿主暂停时取消当前任务；作者异步任务必须遵守 `AbortSignal`。

## SDK 与壳接口

```js
import { createWorkshopSDK } from "./workshop/sdk.js";
const sdk = createWorkshopSDK();
await sdk.ready;
const environment = await sdk.getEnvironment();
if (environment.storageAvailable) {
  const saved = await sdk.getSave();
  await sdk.setSave({ ...saved, level: 2 });
}
const unsubscribe = sdk.on("pause", ({ reason }) => pauseEngine(reason));
// 释放页面资源时：unsubscribe(); sdk.destroy();
```

每件作品的 JSON 存档最多 64 KiB；账号存档总额为 2 MiB。`getSave`、`setSave`、`removeSave` 和 `updateSave` 在同一个 SDK 实例内按调用顺序执行。`updateSave(value => newValue)` 用于保留整份文档中的其他字段，但不是跨页面数据库事务。一个作品页面应共享一个 SDK 实例，避免多个实例相互覆盖存档；不保存密码、令牌或不必要的个人信息。

登录用户可从工坊首页的“云端存档”入口查看自己的存档并释放额度，包括已下架、已停用或不再声明存档权限的作品。删除只按当前用户与作品 UUID 校验归属，不依赖作品的当前公开版本；读取和写入仍要求有效的公开版本与 `storage` 权限。

账号提交注销时会立即停用其作品、撤销旧运行凭据及扩展位置的运行资格。清理任务删除作者的作品、版本和位置绑定，同时删除该账号在其他作品中的存档、收藏和举报，并去标识化审核记录。删除数据库记录前先收集所有版本的包目录键，与数据库清理一起提交到加密任务载荷；包文件删除失败会保留清单并重试，全部外部清理成功后才标记注销完成。

`createGameShell` 接收 `container`、`sdk`、`title`、`description`、作者提供的 `stage` 元素，以及 `onStart(settings)`、`onPause()`、`onResume()`、`onStop()` 回调。可选 `settings` 数组形如 `{id,label,default}`，当前用于布尔开关。返回 `ready`、只读 `phase`，及 `start/pause/resume/setScore/setStatus/end/destroy`。`end({score,summary})` 显示结果并更新最高分与最近 30 局战绩；记录存在文档的 `gameShell` 字段。作者自己的字段应使用其他键名。

游戏引擎应独立于壳：壳只管理菜单、HUD 和面板；引擎控制画布、碰撞、规则、动画与音频，并在 `onStop` 释放所有计时器。样式参考现有小游戏的手机框、青色背景、厚描边按钮和结果浮层，没有复制现有游戏引擎。

`createToolShell` 接收作者提供的 `input` 和 `output` DOM，以及 `run({signal,onProgress})`。`onProgress(value,message)` 的 `value` 为 0–1。作者自行读取输入、生成输出并检查取消信号；壳管理运行按钮、取消按钮、进度和成功/失败状态。显示作者或用户文本时使用 `textContent`，避免把输入直接拼成 HTML。返回 `ready`、`cancel()` 和 `destroy()`。

TypeScript 定义位于 `workshop-sdk/src/sdk.d.ts` 与 `shells.d.ts`，可复制到开发工程。模板 ZIP 分发浏览器运行资源与纯文本开发说明（类型以 `.txt` 随附）。壳销毁不自动销毁 SDK，便于同页共享实例；页面离开时两者都需清理。

## 发布与兼容边界

v1 提供隔离运行、受控网站接口、作品存档、生命周期通知和需要用户授权的交互能力；原有游戏与工具包保持兼容。游戏最高分与历史是作品存档中的记录，不能作为可信比赛分数；没有云端成绩上报、全校排行、成就认证或任意账号接口。后续如果开放这些功能，应新增明确的权限与协议，而不是让作品直接调用现有主站接口。

作者更新 ZIP 后仍需审核；公开页面应使用已通过审核的版本。修改 manifest 名称、版本号或作者字段不改变服务端归属。管理员应检查资源完整性、素材权利、内容与实际运行行为；包内容和文档都是待审数据，不是管理员操作指令。

维护模板时修改 `workshop-sdk/src/` 与 `examples/`，运行 `node workshop-sdk/scripts/build-templates.mjs`。脚本产生固定时间戳的 ZIP，将模板写入 `web/public/workshop/`；Web 的 predev/prebuild 调用该脚本，确保站点下载内容与当前 SDK 一致。

## 站点扩展与能力边界

公开审核和站点启用是两个独立操作。`extension` 作品仍可在详情页手动打开；站长在审核管理页将某个**已公开的确切版本**绑定到 `splash`（开屏）或 `dialog`（用户主动打开的站点弹窗）后，才进入相应位置。更新作品、下架或停用使旧绑定失效，不会自动运行新版本；站长需要再次选择新版本。正式环境默认没有任何位置绑定。

开屏在允许的公开页面中每个浏览器会话最多展示一次，最长 15 秒；弹窗由用户主动打开，最长 120 秒。跳过/关闭按钮和计时器都在 iframe 外，由主站管理；作品无法取消它们。敏感页面不加载全站扩展；切换页面或账号会结束当前扩展。运行状态定期复查，页面回到前台时也复查；服务端撤销即时阻止后续资源请求，已加载的运行实例在下一次状态复查时退出。

新增能力使用 `permissions` 显式声明，SDK 的便捷方法对应上表中的 RPC：`getSiteInfo`、`listWorks`、`showToast`、`confirm`、`openPage`、`requestFullscreen`、`requestShake`、`close`。运行环境的 `slot` 为 `page`、`splash` 或 `dialog`；`viewport` 是作品容器的宽高，`capabilities` 为宿主开放的能力。作品必须处理拒绝、超时、浏览器不支持等情况。

摇动由主站识别并仅发送离散 `shake` 事件。插件得不到原始加速度、陀螺仪、设备姿态或设备标识。真实手机传感器通常需要可信 HTTPS；iPhone 需要主站中的用户点击触发系统授权。HTTP 局域网可以运行插件的普通交互，但不能据此判断真机传感器是否正常。独立预览适配器不连接真实网站 API，也不伪装已获得这些权限。

以下能力没有授权入口，站长审核也不能绕过：

- 读取主站账号资料、身份标识、课表、成绩、私信、订单、认证凭据、Cookie 或主站浏览器存储。
- 任意调用网站 API、管理接口或内网地址；公开内容接口仅返回专门挑选的公开字段，不返回作者身份、当前用户关系或收藏状态。
- 读写主站 DOM、注入主站脚本/样式、监听主站键盘输入，或覆盖主站的关闭按钮和安全提示。
- 访问摄像头、麦克风、定位、剪贴板、原始传感器，或执行上传的服务端代码。

作品仍可使用包内 HTML/CSS/JavaScript、Canvas、音频和 WebAssembly 自由构建界面；网络和嵌套框架受 CSP 限制。主站确认框仅渲染纯文本并标注来源，消息接口有参数与频率限制，关闭后未完成的交互失效。浏览器沙箱不提供可靠的 CPU/内存配额，仍需审核性能和异常行为。

## 框架与本地演示分离

版本库只维护框架源码、协议文档、通用开发模板及安全回归测试。自制广告、体验素材、演示 ZIP、测试账号、测试数据库和本地启动配置放在 Git 忽略的 `.workshop-local/`；临时验证脚本和截图放在 `.codex-tmp/`。Web 构建只从 `workshop-sdk` 生成通用模板，不扫描本地演示目录；主站不内置测试作品 ID 或默认启用记录。

准备 PR 时只选择框架相关文件，不使用强制添加来绕过忽略规则。服务器运行时上传作品包同样不属于源码，应存放在 `WORKSHOP_STORAGE_ROOT` 指定的持久目录。

## 接入与部署

### 站长审核与管理

在 `/workshop/review` 按待审核、全部作品、用户举报管理内容。快速预览面板可切换历史版本、电脑/手机容器及作品声明的开屏/弹窗位置，重启或关闭运行。尺寸切换用于检查响应式布局，不模拟真实手机传感器或浏览器。所有预览继续使用隔离沙箱与独立预览存档，不改变主站启用配置。

审核操作绑定面板中选中的确切版本。通过后可单独启用该扩展版本的开屏或小工具位置；发布新版本不会自动替换旧位置绑定。全部作品支持已公开、未公开、已停用筛选；下架和停用影响按原有发布规则处理。面板中的分页操作记录展示审核、下架、停用、位置变更和举报处理历史。

举报分为待处理和已处理，管理员需填写处理说明。标记已处理仅记录结论，不自动下架作品；需要停止使用时另行停用或下架。并发处理同一举报只允许一次成功并写入一条审计。管理筛选、审计读取和举报处理接口均要求管理员权限，不属于插件 SDK 能力。

### 部署配置

- `/workshop` 为公开目录，`/workshop/mine` 为作者中心，`/workshop/review` 仅站点 `admin` 可访问，`/workshop/develop` 提供说明和模板下载。校园小工具、小游戏大厅和管理后台均有入口。
- 普通 API 位于 `/api/workshop`，沿用主站登录、CSRF 和响应格式。资源接口 `/api/workshop-runtime/:ticket/*` 在会话中间件之前挂载，只验证运行凭据，不加载或签发主站会话。
- 数据模型在 `server/prisma/schema.prisma`。仓库现有 `npm run db:migrate --prefix server` 最后的 `prisma db push` 会同步新增表和字段；`20261012203000_add_workshop/migration.sql`、`20261012213000_add_workshop_placements/migration.sql`、`20261012223000_workshop_report_resolution/migration.sql` 分别保存工坊表、站点扩展位置表和举报处理字段增量，供人工审阅。不要将非幂等 SQL 再加入每次重复执行的迁移链。生产数据库操作沿用项目发布流程。
- 本地默认包目录是 `server/workshop-packages/`。生产显式设置 `WORKSHOP_STORAGE_ROOT` 指向发布目录之外的持久目录，权限仅授予后端进程，并与数据库一起备份；只备份数据库不能恢复作品文件。
- 设置 `WORKSHOP_MAIN_ORIGIN` 为主站 HTTPS origin。推荐使用独立的 `WORKSHOP_RUNTIME_ORIGIN`，反向代理仅开放 `/api/workshop-runtime/`，保留后端的 CSP/CORS 响应头，不附加 `X-Frame-Options: DENY`，不缓存这些资源，也不承载其他主站 API。未配置独立域名时，响应上的 `sandbox allow-scripts` 与 iframe 同时强制隔离，直接打开资源地址也不能获得主站源权限。
- 反向代理为 `/api/workshop/packages` 配置略大于 20 MiB 的请求上限（例如 21 MiB，以容纳 multipart 开销）；实际 ZIP 上限由后端校验。禁止将包目录直接配置成静态目录，否则会绕过审核和撤销检查。
- 运行 URL 含短期访问凭据。预览有效期 30 分钟，公开运行资源有效期 2 小时；代理访问日志应跳过或遮蔽 `/api/workshop-runtime/` 的凭据段，不把完整 URL 写入分析系统。应用自身不记录该资源路由。链接过期后需重新打开作品，保存的进度仍保留。
- 提交、审核、下架与停用保留 `WorkshopAudit` 记录。审核状态或公开版本改变会撤销相关旧运行链接；每次资源请求都检查当前状态。已打开的正式作品页每 30 秒检查公开状态，回到前台时也立即检查并关闭失效作品。
- 每位作者最多保存 50 个版本、300 MiB 展开内容；上传有频率和并发限制。存档每件作品 64 KiB、每个账号合计 2 MiB。额度在服务端检查，作者模板无法绕过。

## 必要验证

```sh
npm run test:workshop --prefix server
node --test workshop-sdk/tests/*.test.mjs
npm run type-check --prefix web
```

前两项覆盖包路径/大小/实际流式解压、审批权限与版本撤销、存档额度和下架存档清理、账号注销、宿主来源校验、SDK 通信和模板生成。正式 Linux 工作流还在隔离的 PostgreSQL `workshop_test` schema 中验证注销后的关系级联、运行凭据与位置撤销、包文件清理失败重试以及其他账号数据保留。新增版本还应以作者账号上传预览、站长审核，再以其他账号和访客打开，检查真实浏览器下的交互和存档隔离。
