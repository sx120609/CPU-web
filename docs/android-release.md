# 安卓发布与更新验证

接手打包或发布时，先读 [Android 打包发布操作手册](android-release-runbook.md)：包含候选 CI 复用、本机签名环境、企业盘与部署入口、完整命令和故障排查。本页定义发布门禁与真机验收要求。

## 分发边界

- APK 只经企业盘分发。公开入口与旧 APK 链接都选择发布清单指定的文件；上传更高版本不会自动发布它。
- 药大拾间 NEXT（`cn.lizmt.cpuweb.next`）是与正式版并存的独立测试版应用，用 `server/src/releases/android-next.json`。它的 APK 和增量包也只经企业盘分发，网站只返回清单和跳转；客户端用已安装的 APK 合成新版后，按完整安装包的同一套规则核对 SHA-256、包名、版本和签名。操作见发布手册的“药大拾间 NEXT”。
- 仓库的 `web/public/downloads/` 只保留发布清单当前指定的 APK，供 Linux 工作流校验签名、包名和版本；历史版本保留在企业盘，不再提交到仓库。
- 用户上传的图片、视频和附件保留 `/uploads/` 入口，由服务器按实际存储配置处理。缩略图参数由服务器翻译为对应服务的格式。
- 网页编译资源按站点静态资源配置分发，APK 不加入静态资源同步。

## V39（4.0.0）原生外壳的前置条件

4.0.0 起 UA 同时带 `CPUWebScheduleApp` 与 `CPUTimeNative/1`。旧版服务端和网页会把任何 `CPUTimeNative/` 当作 iOS（屏蔽赞助与会员入口、登录统计记为 iOS、`clientInfo` 判为 iOS）。因此必须先部署包含 `server/src/utils/loginClient.ts`、`server/src/middleware/iosCommerce.ts` 与 `web/src/utils/clientInfo.ts` 修正的精确提交，再把 V39 写入发布清单。随包的桥接脚本不依赖网页部署，原生课表在旧网页上也能读取。

## 发布步骤

1. 修改 `android/app/build.gradle` 的候选版本，暂时保留 `server/src/releases/android.json` 的已发布版本。推送后等待精确提交的 Android 和 Linux 工作流成功。
2. 下载该提交的 `cpu-web-android-unsigned-<SHA>` 制品，使用现有发布证书签名。保留旧安装包和签名凭据，不把密钥提交到仓库。
3. 将新文件上传到企业盘原发布目录，文件名为 `CPU-Web-Android-V<versionCode>.apk`。不要覆盖旧版本或创建同名文件。
4. 在工作目录 `output/` 中准备候选 JSON，字段与 `server/src/releases/android.json` 相同。大小、SHA-256 和版本必须来自实际签名 APK；`sourceCommit` 与 `buildRun` 指向生成该 APK 的成功 Android 工作流。
5. 从仓库根目录运行：

   ```powershell
   $candidate = 'output/android-candidate.json'
   $release = Get-Content $candidate -Raw | ConvertFrom-Json
   $apk = Join-Path 'output' $release.fileName # 指向实际签名 APK 的位置
   node --import ./server/node_modules/tsx/dist/loader.mjs server/src/scripts/verifyAndroidRelease.ts "--candidate=$candidate" "--apk=$apk" --promote
   ```

   命令会校验本地 APK、签名、包名、版本、GitHub 来源和企业盘下载字节。全部通过后才更新正式发布清单。没有 `--promote` 时只验证，不写入清单。
6. 选择性提交发布清单及签名包，并在同一提交中删除 `web/public/downloads/` 里上一版 APK，使该目录只剩当前版本。前后端共用这份清单；Linux 工作流会在编译网页之前再次验证企业盘和安装包，并将验证记录上传为制品。
7. 获得部署授权后，以 `DEPLOY_BUILD_MODE=ci` 部署精确提交制品。部署脚本在记录成功前会检查公开版本接口、企业盘跳转和下载哈希。

复查已发布版本：

```powershell
node --import ./server/node_modules/tsx/dist/loader.mjs server/src/scripts/verifyAndroidRelease.ts --public-only --site=https://cputime.cn
```

## 旧版强制更新期限

`server/src/releases/android-update-policy.json` 定义本轮更新要求：Android V59（4.0.18）为最低受支持版本，所有更旧客户端共用 72 小时期限。新版修复了大量 Bug 和安全问题，提示要求用户更新至当前已发布的最新版。

服务首次启动此规则时，将起始时间写入已有 `SiteSetting` 表的 `android-update.android-security-v59.starts-at`，在接收请求前完成初始化。截止时间为该时间加 72 小时；重启、再次部署、设备重装或清除缓存均不延长期限，无需数据库结构迁移。后续普通版本发布不自动提高此轮最低版本或重开期限。

版本接口返回 `updateRequirement` 和 `serverTime`，并禁止缓存。旧版在期限内可稍后更新；到期后弹窗不能通过“稍后”、遮罩或返回键关闭，安装、浏览器下载与复制链接仍可使用。网页以服务端时间和单调时钟判断截止时间，并在回到前台时重新检查。旧域名上的 2.x 客户端也显示本轮必需更新提示。

服务端根据原生 `CPUWebScheduleApp/<versionCode>` UA 拦截到期旧版的 `/api` 请求，返回 HTTP 426 / `code: 4260`。版本查询、APK 下载、页面启动配置、健康检查、退出登录和隐私操作保留访问；网页、iOS、鸿蒙及 V59 以上不受限制。此规则限制在线接口和更新弹窗，不能远程删除旧 APK 已缓存的离线课表，也不把 UA 视为可信设备认证。网页与服务端部署后生效，现有 V59 安装包无需重新签名或上传。

## 更新恢复行为

V38 保存系统下载任务 ID、待安装文件及其目标版本。退出或进程重建后，重新打开拾间会继续读取原下载任务，不会再次创建下载；已下载的包可以继续安装。授权安装权限后返回应用会恢复安装，取消安装后可以手动重试。确认新版本已安装后清除该安装缓存，并清理无任务引用的过期缓存。

## 真机验收

自动检查不等于真机验收。使用测试手机记录机型、系统版本、旧版和目标版本，并逐项记录结果：

- 从旧版引导页进入浏览器，下载企业盘 APK 并覆盖安装，确认账号和设置保留。
- 在支持恢复的新版中开始下载，离开应用后再回来，检查同一任务的进度。
- 在下载期间由系统结束应用进程，再打开应用，检查任务 ID 和已下载内容仍可恢复。
- 下载完成后进入安装授权页面，允许后返回，确认继续安装。
- 取消系统安装后回到拾间，点击继续安装，不重新下载。
- 断网、空间不足或下载失败时显示明确状态，并能重试。
- 安装完成后检查版本、缓存清理及应用内课表正常。

2026-09-05：设备连接未建立，用户要求停止连接排查。此次真机验收未完成，不得用自动测试结果代替。
