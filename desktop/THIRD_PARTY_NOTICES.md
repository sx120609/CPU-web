# 第三方组件声明

本目录（`desktop/`）随包分发下列第三方内容。它们各自的版权归原作者所有，**不适用本仓库顶层 LICENSE 的授权条款**。

---

## 1. 内置用户脚本 — 授权状态未解决

| 项目 | 内容 |
|---|---|
| 文件 | `assets/userscripts/monkey.js` |
| 名称 | 💯【超星学习通满分助手】 |
| 版本 | 2.1.6 |
| 作者 | shushoujiu |
| 来源 | GreasyFork 脚本 [436994](https://greasyfork.org/scripts/436994) |
| 声明的许可 | **无**（元数据头中没有 `@license`） |

**这是一个未解决的合规问题，需要仓库所有者处理。**

GreasyFork 与 OpenUserJS 不同，不会对未声明许可的脚本套用默认开源许可 —— 省略 `@license` 等同于版权全部保留。当前仓库对该脚本做了三件都需要授权的事：复制进仓库、实质性修改、随安装包再分发。

本仓库对原脚本的修改（均已在 `desktop/README.md` 记录）：

- 重命名自定义 AI 桥接函数为 `GM_cpuAIRequest`，改为经宿主 IPC 调用药大拾间的 AI 接口
- 收窄 `@match` 范围（移除 `*://*.edu.cn/*` 泛匹配，其余限定 `https://`）
- 移除向第三方题库伪造 `X-Forwarded-For` / `X-Real-IP` 请求头的代码
- 移除向第三方题库发送超星用户 ID（`_uid`）的请求头
- 两个第三方题库接口由明文 HTTP 改为 HTTPS
- 清理失效配置项 `aiApiUrl` 与两条无用的 `@connect`
- 修复图片 content-type 未规范化导致带图题目请求失败的缺陷

原脚本元数据头中的 `@name`、`@author`、`@version`、`@namespace`、`@description`、`@antifeature`、`@downloadURL`、`@updateURL` 均**原样保留**，未做任何删改。

**可选的三条出路：**

1. **改为不内置**（最干净）。首次运行时引导用户自行从 GreasyFork 安装，宿主从 `userData` 目录读取脚本。这样本应用分发的只是一个脚本运行器，与 Tampermonkey 同类，完全绕开再分发问题。改造量很小：`electron/main.ts` 的 `loadBuiltInScripts()` 把 `app.getAppPath()` 换成 `app.getPath("userData")` 并改为扫目录即可，注入管线一行不用动。
2. **取得授权**。在 GreasyFork 脚本 436994 的反馈区联系 shushoujiu 取得书面授权，并在此文件记录授权范围与日期。
3. **移除该脚本**，自行实现所需能力。

在上述任一条落实之前，不建议公开分发包含本脚本的安装包。

---

## 2. 用户脚本的运行时依赖

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

## 3. 运行时框架

| 组件 | 许可 |
|---|---|
| Electron | MIT（内含 Chromium 与 Node.js，各自许可见安装目录下的 `LICENSES.chromium.html` 与 `LICENSE`） |

---

## 4. 品牌资源

`build/icon.png` 与 `assets/tray-icon.png` 取自本仓库 `web/public/icon-512-v3.png`，属于药大拾间站点的品牌标识，**不随代码开源许可授权**。二次分发或衍生项目请自行替换。
