# 创意工坊 SDK 与模板

无需安装依赖，Node.js 22+ 即可生成可编辑的完整作品目录：

```sh
node workshop-sdk/bin/cli.mjs init game /tmp/my-game
node workshop-sdk/bin/cli.mjs init tool /tmp/my-tool
node workshop-sdk/bin/cli.mjs init extension /tmp/my-extension
node workshop-sdk/bin/cli.mjs pack /tmp/my-game /tmp/my-game.zip
```

`examples/` 存放作者代码，`src/` 存放共享 SDK 和壳。`init` 将两者复制到作品目录，生成的目录与 ZIP 都包含独立运行所需资源；请修改生成目录中的 `manifest.json`、`main.js` 和 `index.html`。

显式本地预览：在生成目录启动静态服务（例如 `python3 -m http.server 8000 --directory /tmp/my-game`），打开 `http://localhost:8000/?preview=1`。正常工坊运行不使用预览参数，始终连接宿主。

```sh
node workshop-sdk/scripts/build-templates.mjs
```

此命令生成用于站点分发的 `/workshop/game-template.zip` 、`/workshop/tool-template.zip` 与 `/workshop/extension-template.zip`，也是 Web 开发和构建的准备步骤。ZIP 根目录是 `manifest.json`、`index.html`、`main.js` 与 `workshop/`，没有额外的包裹文件夹。

TypeScript 声明保留在 `src/sdk.d.ts`、`src/shells.d.ts` 中，按需复制到作者的开发工程；上传包只需浏览器执行资源。

完整协议、接口、限制与发布说明见 [开发文档](../docs/workshop.md)。

插件使用 `type: "extension"`，必须声明 `extension: { "slots": ["splash"] }` 或 `dialog`，也可声明两者。游戏与工具不能包含 `extension`。通用插件模板只演示连接环境与关闭自身，不包含广告或传感器演示。

权限为 `storage`、`site.public`、`ui.toast`、`ui.confirm`、`navigation`、`fullscreen`、`motion.shake`，需在 manifest 中按需声明。SDK 提供 `getSiteInfo()`、`listWorks({q?,type?,page?,pageSize?})`（每页最多 12）、`showToast({message,type?})`、`confirm({title,message})`、`openPage("workshop"|"games"|"tools")`、`requestFullscreen()`、`close()` 与 `requestShake()`。宿主不可用时请求会拒绝；本地预览仅提供本地存档与静态环境，其他宿主能力明确返回 `UNSUPPORTED`。确认与权限交互默认超时 60 秒，普通请求 8 秒，可用 `createWorkshopSDK({timeout,interactionTimeout})` 调整。

环境新增 `slot`、`viewport`、`capabilities`、`motionSupported`；不会返回账号信息。事件支持 `pause`/`resume`（`{reason?}`）、`show`/`hide`（`{}`）、`themechange`（`{theme}`）、`resize`（`{width,height}`）及 `shake`（`{}`），不提供原始传感器读数。摇动权限由宿主原生确认与真实用户操作授权；postMessage 本身不会触发 iOS 传感器权限。
