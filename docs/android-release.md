# 安卓发布与更新验证

## 分发边界

- APK 只经企业盘分发。公开入口与旧 APK 链接都选择发布清单指定的文件；上传更高版本不会自动发布它。
- 用户上传的图片、视频和附件保留 `/uploads/` 入口，由服务器按实际存储配置处理。缩略图参数由服务器翻译为对应服务的格式。
- 网页编译资源按站点静态资源配置分发，APK 不加入静态资源同步。

## 发布步骤

1. 修改 `android/app/build.gradle` 的候选版本，暂时保留 `server/src/releases/android.json` 的已发布版本。推送后等待精确提交的 Android 和 Linux 工作流成功。
2. 下载该提交的 `cpu-web-android-unsigned-<SHA>` 制品，使用现有发布证书签名。保留旧安装包和签名凭据，不把密钥提交到仓库。
3. 将新文件上传到企业盘原发布目录，文件名为 `CPU-Web-Android-V<versionCode>.apk`。不要覆盖旧版本或创建同名文件。
4. 在工作目录 `output/` 中准备候选 JSON，字段与 `server/src/releases/android.json` 相同。大小、SHA-256 和版本必须来自实际签名 APK；`sourceCommit` 与 `buildRun` 指向生成该 APK 的成功 Android 工作流。
5. 从仓库根目录运行：

   ```powershell
   node --import ./server/node_modules/tsx/dist/loader.mjs server/src/scripts/verifyAndroidRelease.ts --candidate=output/android-candidate.json --apk=web/public/downloads/CPU-Web-Android-V38.apk --promote
   ```

   命令会校验本地 APK、签名、包名、版本、GitHub 来源和企业盘下载字节。全部通过后才更新正式发布清单。没有 `--promote` 时只验证，不写入清单。
6. 选择性提交发布清单及签名包。前后端共用这份清单；Linux 工作流会在编译网页之前再次验证企业盘和安装包，并将验证记录上传为制品。
7. 获得部署授权后，以 `DEPLOY_BUILD_MODE=ci` 部署精确提交制品。部署脚本在记录成功前会检查公开版本接口、企业盘跳转和下载哈希。

复查已发布版本：

```powershell
node --import ./server/node_modules/tsx/dist/loader.mjs server/src/scripts/verifyAndroidRelease.ts --public-only --site=https://cputime.cn
```

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
