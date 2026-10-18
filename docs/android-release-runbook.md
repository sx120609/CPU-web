# Android 打包发布操作手册

本文给接手仓库的开发者和编码助手使用，不依赖其他聊天的上下文。发布约束见 [android-release.md](android-release.md)，所有 main 推送的门禁见 [production-requirements.md](production-requirements.md)。本文提供实际操作顺序，不代替用户授权。

## 先明确任务边界

| 用户要求 | 应完成的范围 |
| --- | --- |
| 修复、调整界面 | 修改代码、适当验证；说明需要网页更新还是新 APK 才生效。未上线不能说用户已经用到修复。 |
| 打包、返回安装包 | 取得可信构建并签名，返回文件；不自动上传企业盘或部署生产。 |
| 打包发布、发布新版 | 完成下文整条发布流程，包括企业盘、发布清单、最终 CI 和生产切换。用户已有明确授权时，不在每一步重复询问。 |
| 发到测试通道、发 NEXT | 按下文“测试通道与增量包”完成签名、企业盘上传（APK 与增量包）、提升 `android-beta.json`、最终 CI；部署仍需授权。 |
| 测试版转正 | 把已在测试通道验证过的同一个 APK 提升为正式版，不重新构建、不重新签名。 |
| 只推送 | 推送并等待精确 SHA 的 Linux CI 和制品；不部署生产。 |
| 暂不上传、暂不发布 | 停在该边界，交付已有结果并明确尚未发布。后续明确发布指令可改变这一边界。 |

把用户中途追加的修复纳入当前任务，但遵守其指定顺序。用户说“先把当前版本发布，再修其他问题”时，先完成当前发布，不能悄悄把新修改混入已签名的版本。

## 固定信息与入口

- 包名：`cn.lizmt.cpuweb`。
- 候选构建版本：`android/app/build.gradle` 的 `versionCode` / `versionName`。
- 已发布版本：`server/src/releases/android.json`。不要从聊天、README 或文件夹里最高的文件名猜版本。
- 测试通道（药大拾间 NEXT）版本：`server/src/releases/android-beta.json`，格式与正式清单相同；版本号不高于正式版时，测试通道收到的就是正式版。
- 增量包：`CPU-Web-Android-V<旧>-V<新>.cpupatch`，记录在目标版本清单的 `patches` 里，文件与 APK 放在同一企业盘目录。
- Android 工作流：`.github/workflows/android-release.yml`，显示名 `Android release artifact`。
- Linux 工作流：`.github/workflows/linux-deploy-artifact.yml`，显示名 `Linux deployment artifact`。它使用 Ubuntu 24.04 / Node.js 24 构建 Server、Web 和 VoiceHub。
- APK 制品名：`cpu-web-android-unsigned-<完整 source SHA>`；里面是 `app-release-unsigned.apk`。
- Linux 制品名：`cpu-web-linux-<完整最终发布 SHA>`。
- 正式文件名：`CPU-Web-Android-V<versionCode>.apk`。
- 签名证书 SHA-256：`c18b7adc4fc870f75fe3c6c33d643fa4233af54c254c96edf48fcca6743df744`。这是公开证书指纹，不是签名密钥。
- 下载页：<https://cputime.cn/download>。
- 公开版本接口：<https://cputime.cn/api/site/downloads/android>。
- 稳定下载入口：<https://cputime.cn/api/site/downloads/android-app>，它跳转至清单指定的企业盘文件；加 `?channel=beta` 是测试版。
- 增量包入口：`/api/site/downloads/android-patch?channel=<stable|beta>&from=<versionCode>`，同样只跳转到企业盘文件。
- 发布后台：<https://cputime.cn/admin?tab=deployment>，使用已有的超级管理员会话。
- 目前企业盘发布目录在“药大拾间 / Windows”，虽叫 Windows，也存放安卓 APK：<https://bj37249.apps.aliyunfile.com/disk/drive/enterprise/2/6a66c631e82f0fd1befc4d11ae7087bcfda71004>。需要已登录且有权限；目录 URL 不授予访问权。若目录调整，以当前站点分享配置和用户确认的发布目录为准。

APK 只通过企业盘分发。`web/public/downloads/` 的 APK 是供 CI 校验的仓库副本，不是绕过企业盘的另一条生产分发链路。

### 本机签名环境（2026-09-29 核验）

Windows 上的已有发布凭据位于当前用户的 `Documents/CPU-web-release-signing-20260708/`，包含 `key.properties` 和 `upload-release.jks`。`key.properties` 的 `storePassword`、`keyPassword`、`keyAlias` 由脚本在内存中读取。其他机器需取得受控的原发布密钥位置，不能新建一把钥匙替代。

Android SDK 通常在 `$env:LOCALAPPDATA/Android/Sdk`；本机已使用 `build-tools/35.0.0` 的 `apksigner.jar` 和 `aapt.exe`。Android CI 使用 Java 17。执行发布验证脚本前设置 `ANDROID_HOME`，按实际安装位置设置 `JAVA_HOME`。

不要把密码、密钥文件、会话 Cookie、GitHub token、企业盘临时下载 URL 写进提交、日志或交付消息。签名命令使用临时环境变量，结束后清理。不要打印整个 `key.properties`。GitHub 使用现有 `gh` 登录状态；先运行 `gh auth status` 检查即可。

## 1. 找到真正待发布的代码

1. 检查当前工作区、附属 worktree 的状态和远端 `main`。主工作区可能有其他任务未提交的改动，不能全量暂存或重置它们。复用合适的干净 worktree，并显式指定后续命令的工作目录。
2. `git fetch origin main` 后查看新增提交及安卓差异。干净工作区可 `git merge --ff-only origin/main`；有本任务修改时先确认不会覆盖，不做强制重置。
3. 同时读取 Gradle 候选版本和正式清单。若已有人提交了更高版本的候选包，例如“build Android Vxx release candidate”，先检查它的 CI，**不要再凭空加一版**。
4. 若没有候选版本，再按本次改动递增 `versionCode` 和 `versionName`。正式包的 code 必须高于需要覆盖的已安装测试包；测试包用过一个 code 后，正式版可能需要跳号。
5. 对照 `git diff` 确认发布内容。如果没有未发布的安卓变化，先如实说明，不能把已有版本冒称新版。

不要拿本地 `assembleRelease` 输出当正式包。它可以验证编译，但正式分发必须取 GitHub 制品。也不要把临时 `-PwebDebug=true`、测试 `appUrl`、测试包名或 App 名参数带进正式构建。

## 2. 验证候选提交与 CI

首次候选推送应保留旧的 `android.json`，这样 APK 没上传前不会错误地提示新版本。

```powershell
git rev-parse HEAD
git ls-remote origin refs/heads/main
# 使用完整 SHA，不能用缩写过滤运行记录。
gh run list --commit $sourceSha --limit 10 --json databaseId,headSha,name,status,conclusion,url
gh run view $apkRunId --json headSha,name,status,conclusion,jobs,url
gh api "repos/sx120609/CPU-web/actions/runs/$apkRunId/artifacts"
```

`$sourceSha` 和 `$apkRunId` 必须来自实际提交与运行记录。要求 Android 和对应 Linux 工作流均成功，且 APK 和 Linux 的完整 SHA 制品未过期。只看绿色工作流名称不够，必须核对 `head_sha`。

### 可以复用已有候选制品吗？

可以。要求候选版本正确、来源工作流成功、制品仍可取得，并确认该候选之后所有影响 APK 的代码和构建输入都没有改变。检查 `android/`、Android 工作流、生成桥接与主题资源的输入等，不能只比版本号。把复用的完整 SHA 和 run ID 写进候选清单。后续只有 iOS 等无关改动时，不必为相同安卓代码重复构建。

若相关输入变化、制品过期或来源不能证明，就重新构建。在 `main` 上执行 `gh workflow run android-release.yml --ref main` 后，重新查询运行的完整 SHA，不能假设刚触发的运行一定属于此前记录的 HEAD。

## 3. 下载并验证正式制品

```powershell
$outDir = "output/android-release-$versionCode"
New-Item -ItemType Directory -Force "$outDir/unsigned" | Out-Null
gh run download $apkRunId -n "cpu-web-android-unsigned-$sourceSha" -D "$outDir/unsigned"
```

这些变量从实际候选信息读取。`output/` 用于本地工作文件和验收记录；不要依赖某个历史聊天留下的 `output/*.py`、`.ps1`、`.mjs` 必然存在。

下载慢或失败时的处理要点：

- GitHub API `GET /repos/sx120609/CPU-web/actions/artifacts/<artifactId>/zip` 返回签名下载跳转。**GitHub Authorization 只发给 api.github.com，不跟随跳转发送给 Azure/制品主机**，否则可能收到 401。
- 分开取得跳转 URL，再无 Authorization 下载；不在日志中打印临时 URL。需要时重新获取未过期的 URL。
- 使用 HTTP Range 并发下载时，逐段检查 `206`、`Content-Range`、段长和总长度；每个下载进程使用独立文件，完成后再合并。中断父 shell 不保证子下载进程立即退出，不能让旧进程和新进程同时写同一 ZIP。
- 将 ZIP 的 SHA-256 与 GitHub artifact 元数据 `digest` 比较，再做 ZIP 完整性校验和解压。**ZIP 的 digest 与签名后 APK 的 sha256 不是同一个值。**
- 不要把 ZIP/APK 字节经过 PowerShell 文本管道或 `Out-File`。`gh run download -D` 可直接保存文件。Python 调用 `gh api` 读取 JSON 时显式使用 `encoding="utf-8"`，Windows 默认 GBK 可能解码失败。
- 重试必须有超时和次数上限，不为下载方便关闭 TLS 校验，也不退回本地编译包发布。

## 4. 用原证书签名

以下片段在仓库根目录的 PowerShell 中运行。先设置实际的 `$outDir`、`$versionCode`，确认其中的 unsigned APK 来自上一步已验证的 CI。

```powershell
$signingRoot = Join-Path $env:USERPROFILE 'Documents/CPU-web-release-signing-20260708'
$buildTools = Join-Path $env:LOCALAPPDATA 'Android/Sdk/build-tools/35.0.0'
$props = @{}
Get-Content (Join-Path $signingRoot 'key.properties') | ForEach-Object {
    if ($_ -match '^([^#=]+)=(.*)$') { $props[$matches[1].Trim()] = $matches[2].Trim() }
}
$fileName = "CPU-Web-Android-V$versionCode.apk"
$apk = Join-Path $outDir $fileName
$env:CPU_APK_STORE_PASSWORD = $props['storePassword']
$env:CPU_APK_KEY_PASSWORD = $props['keyPassword']
try {
    java -jar "$buildTools/lib/apksigner.jar" sign `
        --ks (Join-Path $signingRoot 'upload-release.jks') `
        --ks-key-alias $props['keyAlias'] `
        --ks-pass env:CPU_APK_STORE_PASSWORD --key-pass env:CPU_APK_KEY_PASSWORD `
        --out $apk "$outDir/unsigned/app-release-unsigned.apk"
    if ($LASTEXITCODE -ne 0) { throw 'APK signing failed' }
    java -jar "$buildTools/lib/apksigner.jar" verify --print-certs $apk
    if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed' }
    & "$buildTools/aapt.exe" dump badging $apk
    if ($LASTEXITCODE -ne 0) { throw 'APK metadata inspection failed' }
    Get-FileHash $apk -Algorithm SHA256
} finally {
    Remove-Item Env:CPU_APK_STORE_PASSWORD,Env:CPU_APK_KEY_PASSWORD -ErrorAction SilentlyContinue
}
```

确认包名、versionCode、versionName、证书指纹都正确。大小和 APK 哈希从**签名后的文件**计算，不能沿用 unsigned APK 的值。之后还会由仓库验证脚本再次强制核对。

## 5. 上传企业盘，再提升清单

1. 打开已有登录会话中的发布目录，确认没有同名文件。上传签名 APK，不覆盖旧版、不创建同名副本、不修改目录分享权限。
2. 浏览器工具支持文件上传时，先读取它的上传说明，使用文件选择器传绝对路径；完成后确认上传任务成功，而不是仅看“已选择文件”。没有该能力或会话失效时明确说明具体缺项，不通过提取 Cookie 绕过登录。
3. 创建 `$outDir/candidate.json`，字段与 `server/src/releases/android.json` 一致：`schemaVersion`、`versionCode`、`versionName`、`packageName`、`fileName`、`size`、`sha256`、`certificateSha256`、`sourceCommit`、`buildRun`。后两项是 **APK 来源提交/Android run**，不是稍后发布清单提交的 SHA 或 Linux run。

```powershell
$published = Get-Content server/src/releases/android.json -Raw | ConvertFrom-Json
$candidate = [ordered]@{
    schemaVersion = 1
    versionCode = [int]$versionCode
    versionName = $versionName
    packageName = $published.packageName
    fileName = $fileName
    size = (Get-Item $apk).Length
    sha256 = (Get-FileHash $apk -Algorithm SHA256).Hash.ToLowerInvariant()
    certificateSha256 = $published.certificateSha256
    sourceCommit = $sourceSha
    buildRun = [long]$apkRunId
}
$candidatePath = [IO.Path]::GetFullPath((Join-Path $outDir 'candidate.json'))
[IO.File]::WriteAllText($candidatePath, ($candidate | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
```

`$versionCode` / `$versionName` 取自实际候选 Gradle 文件。使用无 BOM 的 UTF-8，避免 Windows 文本编码导致 JSON 解析失败。

4. 在仓库根目录运行：

```powershell
$env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android/Sdk'
node --import ./server/node_modules/tsx/dist/loader.mjs server/src/scripts/verifyAndroidRelease.ts `
    "--candidate=$outDir/candidate.json" "--apk=$apk" `
    "--receipt=$outDir/promotion-receipt.json" --promote
if ($LASTEXITCODE -ne 0) { throw 'Release promotion failed; stop here' }
```

脚本会验证本地签名、包信息、GitHub 来源、企业盘文件名/大小及真正下载的字节。全部通过才更新正式清单。上传成功不代表清单已提升，清单提升也不代表生产已经上线。

已上传的 code 发现代码问题后，不要重新签一个不同文件覆盖同名包；应使用新的 versionCode 和文件名。

## 6. 推送最终发布提交并等门禁

把签名 APK 复制到 `web/public/downloads/`，在同一提交中删除该目录上一版 APK；删除仓库副本前保留本地归档，企业盘旧版不删。只暂存本次发布清单和 APK，不要 `git add .`。

推送后记录 `$releaseSha = git rev-parse HEAD` 并确认远端 main 相同。等待该完整 SHA 的 Linux 工作流成功，核对构建步骤和 `cpu-web-linux-$releaseSha` 制品存在、未过期。

这一阶段通常只有 Linux 工作流触发，因为 APK 没有再次改动；不是漏构建。`sourceCommit` 与最终 `$releaseSha` 不同是两阶段发布的正常结果。

若 main 被其他任务推进，先检查新提交及其 CI，不要让后台悄悄部署一个未经核验的最新提交，也不要强推覆盖别人的代码。

## 7. 执行部署并核验完成

有明确发布/部署授权后，使用后台“更新部署”页面执行固定更新命令。确认弹窗涉及数据库兼容性时，先检查变化范围；本次没有数据库变化时如实按此判断，有变化则按 [zero-downtime-deployment.md](zero-downtime-deployment.md) 审查，不能盲目承诺兼容。

也可在已授权且可用的服务器终端，从实际部署仓库目录执行 `DEPLOY_BUILD_MODE=ci bash deploy.sh update`。正常路径不能用本地制品代替 GitHub 制品，也不能用生产机编译代替它。

必须看到日志确认：

- verified Linux deployment bundle 对应预期完整 SHA；
- Build source 为 verified CI artifact；
- 必要的连接排空、QQBot 重连与旧实例回收完成；
- Deployment complete 和 Recorded successful deployment commit 对应本次提交。

“部署中”、按钮已点击、甚至公开版本已切换，都不等于整个部署完成。长连接未排空时不得杀旧进程来制造成功。不要重复点部署；可刷新日志观察进度。

```powershell
node --import ./server/node_modules/tsx/dist/loader.mjs server/src/scripts/verifyAndroidRelease.ts `
    --public-only --site=https://cputime.cn "--receipt=$outDir/public-verification.json"
if ($LASTEXITCODE -ne 0) { throw 'Public release verification failed' }
Invoke-RestMethod https://cputime.cn/api/ready
```

公开验证会检查版本接口和稳定入口跳转后实际 APK 的哈希。核对 `/api/ready` 就绪、转交请求数为 0、应在线的 QQBot 已连接；结合部署日志判断 SHA。单纯前端热更新可能保留旧后端 SHA，不能仅凭后端 SHA 不变就擅自重启服务。

最后打开下载页，确认显示新版本，保存可审阅的发布结果。返回版本号、下载链接/本地签名 APK、校验结果和实际测试限制。没连接测试手机就说未做本轮真机验收，不能把 CI 当作真机结果。真实安装恢复场景见 [android-release.md](android-release.md#真机验收)。

## 测试通道与增量包

### 通道模型

`main` 上的安卓代码就是下一个版本。新版本先发到药大拾间 NEXT（测试通道），确认可用后把**同一个签名 APK** 提升为正式版：文件名、大小、SHA-256 都不变，正式版不再另行构建。V60（4.1.0）是第一个带原生更新器的版本：

- V59 及更早的正式版只认正式通道，用户要从下载页的 NEXT 卡片装测试版（`?channel=beta`，仍从企业盘下载）；装上后若用户没选过通道，第一次检查时自动留在测试通道。
- V60 起用户在“设置 → 更新与测试通道”加入或退出。退出后保留当前版本，直到正式版版本号超过它。
- 正式版需要急修时，从正式清单的 `sourceCommit` 建分支修复；急修版的版本号必须高于当前测试版，测试通道也会收到它，之后尽快再发一个包含该修复的测试版。

### 发布到测试通道

1. 按“1. 找到真正待发布的代码”和“2. 验证候选提交与 CI”准备候选版本；候选推送不改 `android-beta.json`。
2. 按第 3、4 步下载 CI 制品并用原证书签名。
3. 写候选清单（字段同第 5 步），另加 `notes`：给用户看的更新说明，最多 20 条，每条不超过 200 字。
4. 生成增量包。底版只选装有原生更新器的版本（V60 及以上），通常是当前测试版和当前正式版；底版用企业盘上的已签名 APK（或 `output/android-release-<versionCode>/` 的存档），必须与当时发布的文件逐字节相同：

   ```powershell
   node --import ./server/node_modules/tsx/dist/loader.mjs server/src/scripts/buildAndroidDelta.ts `
       "--from=<底版 APK>" --from-version=<底版 versionCode> "--to=$apk" `
       "--candidate=$outDir/candidate.json" "--out=$outDir"
   ```

   脚本生成 `CPU-Web-Android-V<旧>-V<新>.cpupatch`，用它把底版还原成新 APK 并逐字节比对，再把条目写进候选清单的 `patches`。增量包不小于完整包 80% 时脚本不写清单，那一版的用户下载完整安装包。
5. 把签名 APK 和每个增量包上传到企业盘原发布目录（上传办法同第 5 步）。
6. 提升测试通道清单：

   ```powershell
   node --import ./server/node_modules/tsx/dist/loader.mjs server/src/scripts/verifyAndroidRelease.ts `
       --channel=beta "--candidate=$outDir/candidate.json" "--apk=$apk" `
       "--receipt=$outDir/promotion-receipt.json" --promote
   ```

   脚本校验签名、包信息、GitHub 来源和企业盘字节，并从企业盘下载每个增量包和它的底版、重新合成、比对哈希，全部通过才写 `android-beta.json`。测试版版本号必须高于当前正式版和测试版。
7. 只提交 `server/src/releases/android-beta.json`；测试版 APK 不放进 `web/public/downloads/`。推送后等待精确 SHA 的 Linux CI：无参数的发布校验也会检查测试通道清单、测试版签名和全部增量包。
8. 获得部署授权后部署，再运行 `verifyAndroidRelease.ts --public-only --channel=beta --site=https://cputime.cn`。

### 测试版转正

1. 以 `android-beta.json` 的内容作为候选清单；如有装着更新器的旧正式版（V60 及以上），可再为它生成增量包追加进 `patches` 并上传。
2. 按第 5 步运行 `verifyAndroidRelease.ts --candidate=... --apk=... --promote`（默认正式通道），写入 `android.json`。
3. 按第 6、7 步提交清单和签名 APK（并删除 `web/public/downloads/` 里上一版 APK）、等待 CI、经授权部署、公开校验。此后测试通道与正式通道相同，直到下一个测试版。

### 真机核对更新器

用一台装着上一版（V60 及以上）的测试手机：打开“设置 → 更新与测试通道”，确认显示增量包大小、下载后显示“用增量包合成”，Android 12 及以上在授予“安装未知应用”后点“立即安装”不出现系统确认、拾间重启后显示“已更新到…”；再验证“离开拾间后自动安装”：下载完成后回到桌面，约两分钟内版本更新。模拟器可用 `-PappUrl=http://localhost:<端口>/home` 的调试版配合本地假接口和 `adb reverse` 走完同样流程。

## 常见判断与故障

| 现象 | 判断与处理 |
| --- | --- |
| “有新版”但 Gradle 已经是更高 code | 先找已有候选 CI，满足条件就复用，不要机械加号。 |
| GitHub 按短 SHA 查不到运行 | `gh run list --commit` 使用完整 SHA。 |
| Windows 安装共享测试报 FileProvider 找不到临时根路径 | 记录准确失败，检查改动是否涉及安装逻辑；以正式 Ubuntu CI 的同项测试及实际验收判断，不能删除/跳过测试掩盖。 |
| 企业盘已有新 APK，应用却无更新提示 | 检查正式清单是否提升并部署、公开接口的 code，以及 `web/src/utils/androidUpdatePolicy.ts` 的自动提示开关。V60 起由原生更新器检查，每 6 小时最多一次，可在设置里手动检查。 |
| 有增量包却下载了完整安装包 | 增量包只给底版版本号与已安装版本相同、且已安装 APK 的 SHA-256 等于 `fromSha256` 的设备；任一步失败都会退回完整包。核对清单的 `fromSha256` 是否取自当时发布到企业盘的文件。 |
| 同版本反复安装、读取下载失败 | 不把同 code 当升级；保留已有的同版本下载保护。不要为绕过校验而放宽安装验证。 |
| 文件上传结束，但公共校验失败 | 停止提升/部署，查目录、重名文件、大小、哈希、分享配置；不能忽略验证结果。 |
| 原生按钮、课程编辑弹层已改，手机没变化 | Compose/Kotlin 和 APK 内的注入脚本需要新 APK；只部署网页不会更新原生代码。 |
| 帖子页 CSS 改动 | 可随网页部署生效；不要把原生已消费的 safe area 再加一次。固定评论条的留白由页面内部按实际高度预留，避免被原生壳外层 padding 覆盖。 |
| 课表/小组件看起来正常，但用户仍说遮挡 | 检查真实边界条件：小视口、键盘、大字体、非零 safe area、滚动到最底部、12 节、长课名和教室；截图好看或编译通过不能替代这些状态的验证。 |
| 等待中用户追加别的问题 | 记录新增范围，保留当前发布目标；版本已冻结/上传后不要静默更换同名 APK。 |

## 交接记录

在忽略的 `output/` 下保存候选清单、源 Android run/制品记录、最终 Linux run/制品记录、企业盘提升回执、公开验证回执、生产就绪/部署结果和必要截图。不要提交凭据与临时 URL。

给下一位执行者的最小交接是：当前步骤、versionCode/name、APK source SHA/run、最终发布 SHA/run、正式签名包路径、哪些门禁已通过、下一步是什么。仅说“包已打好”不够；签名、上传、提升清单、最终 CI、部署和真机验收是不同状态。
