# 网课助手独立发布

客户端 0.3.30 起，打开网课平台时只检查对应组件。并发与 30 秒内重复检查合并；前台最多等待 1.5 秒，超时使用本地版本，后台检查继续。不会在客户端启动时下载不用的组件。任务使用已选定的版本目录，下载不会覆盖运行中的文件。智慧树保持整个登录会话和已打开页面的版本一致，断开后关闭并重新打开工作台才切换。

## 组件与兼容范围

- 学习通：`desktop/assets/userscripts/monkey.js`，版本取 `@version`。
- 多平台：`desktop/assets/userscripts/multiplatform.js`，版本取 `@version`。
- 安全微伴：`desktop/assets/userscripts/weban.js`，版本取 `@version`。
- 智慧树：内置 Vue 页面和 `server/python/zhihuishu/worker.py`、`vendor/*.py`，版本在 `release.json` 的 `zhihuishu`。
- 外壳窗口管理、IPC、Node runner、原生桥以及 Python/原生依赖仍是客户端组成部分；改这些需要发客户端。`protocol` 与 `runtime` 当前均为 1，客户端拒绝不兼容组件，不能通过提升数字让旧运行环境支持新依赖。

智慧树宿主 `loader.py` 由 PyInstaller 打包，支持从验证过的组件目录加载业务脚本。下载目录由主进程选择，第三方网页没有更换目录/执行任意脚本的 IPC。发布签名使用 Ed25519，公钥固化在客户端；缓存重新读取时核验签名、压缩包和实际文件。下载失败、签名错误或启动探测失败保留旧版；页面加载失败回退上一版/内置版，并阻止重复安装已回退的包。

## 发布步骤

1. 修改对应业务代码，递增该组件版本。同版本不同字节禁止发布。不要为了助手业务变更修改 `desktop/package.json` 的客户端版本。
2. 推送后等待精确 SHA 的 `Assistant components` 和 `Linux deployment artifact` 成功。前者单独构建组件和测试冻结宿主，发布 `assistant-<完整 SHA>` GitHub 预发布；不会生成新的客户端安装包。客户端发布时仍有 Windows/macOS 的完整测试。
3. 从这个 GitHub 发布下载 `*.json.gz`、`builtin.json`、`provenance.json`、`SHA256SUMS.txt` 到同一空目录。核对发布标签、Actions SHA 与预期提交相同，不能拿本地构建替代正式产物。
4. 使用维护者机器的 Ed25519 私钥签名并上传：

   `python desktop/scripts/publish-assistants.py --source <下载目录> --commit <完整 SHA> --key <私钥 PEM 路径>`

   需要 Node.js 与 Python requests。脚本通过不回显的提示读取企业盘 API key，不把 key 写入文件。私钥只留在维护者机器，权限 0600，不提交 Git、不上传云盘，必须单独备份。换公钥需要客户端更新。首次部署的维护者私钥保存在本任务仓库之外的 `work/assistant-publisher-key.pem`。
5. 脚本先验证产物校验清单及提交标识，先上传并校验所有变化的包，最后上传签名清单。相同包复用现有 fileId。只有清单发布成功后用户才会看到新版本；发布回执写到下载目录的 `cloud-receipt.json`。
6. 使用客户端检查更新，确认版本、状态、真实加载和未变化时不重复下载。紧急撤回业务变更应以更高的组件版本重新发布已知正常代码，避免客户端版本回退保护拒绝旧号。

## 分发

沿用公开企业盘分享 `TunDZWtpXk5`，`assistant-updates/catalogs` 存放小签名清单，`assistant-updates/packages` 存放带版本/哈希的不可变包。目录 ID 固化在下载器和发布脚本中。客户端只持有公开 share token，不持有企业盘 API key。

每次检查读取最新清单文件的少量元数据，同一进程内清单 fileId 没变时不重复下载正文。只有用户使用的组件版本更高才下载其压缩包。所有字节直接从企业盘返回，不经过主站服务器。原有 `/api/site/userscripts/*` 保留供旧客户端使用，新组件发布不会自动更新这些旧接口；旧客户端需升级到 0.3.30。
