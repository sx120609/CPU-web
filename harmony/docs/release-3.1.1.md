# HarmonyOS 3.1.1（32）发布包

包名 `cn.lizmt.cpuweb`，应用名「药大拾间」。版本清单、启动地址和 User-Agent 均为 3.1.1（32）。发布证书沿用原证书，发布 Profile 换成 2026-11-06 生成的「药大拾间发布Profile-锁屏卡片」。

## 更新内容

- 冷启动直接显示本机缓存的课表（缓存最长 30 天），不再停在「正在打开校园服务」等网页加载并确认登录。网页随后回答未登录时，照常换成原生登录页。3.1.0 的上架审核报告检测到启动加载完成时延 4029 ms（目标 4000 ms，Mate 60 / HarmonyOS 6.1）；审核录屏中，已登录的冷启动在转圈页停留约 3.5 秒。
- 锁屏卡片：「锁屏卡片」开放能力于 2026-09-04 审核通过，但 3.1.0 及以前的包使用 2026-09-03 生成的 Profile，其中没有该能力，锁屏卡片列表里不出现本应用。本包的 Profile 含 `com.huawei.service.screenlock.form`。按平台规则，锁屏卡片在用户把卡片添加到桌面后生效，只支持 1×1、1×2 尺寸。

## 来源与验证

- 源码提交：`759da87b836975a71cfbc32e15587e104f1537bf`，通过 `git archive` 导出后独立构建。功能提交为 `a689641a`（冷启动显示缓存课表）。两个提交的 `Linux deployment artifact` 工作流均成功，并生成了对应提交的产物。
- DevEco Studio 6.1.1 / SDK API 24 执行 release `assembleApp` 成功。包内 `buildMode=release`、`debug=false`，版本 3.1.1 / 32，随包桥与源码一致，只含 `pages/Index`。
- 内层 HAP 和外层 APP 均用原发布证书和新 Profile 签名，并通过华为 `verify-app`。三份校验导出的 Profile 都含 `com.huawei.service.screenlock.form`。最终 APP 内的 HAP 与单独签名的 HAP 逐字节一致。
- 鸿蒙回归测试 236 项全部通过。
- 签名包冒烟测试（手机模拟器 API 24）：
  - 从 3.1.0 覆盖安装成功。
  - 访客冷启动、热启动课表深链和冷启动课表深链都显示原生登录页。
- 未进行真机验收：已登录冷启动的实际耗时、锁屏卡片能否添加到锁屏均未在设备上验证。签名与构建验证不代表设备验收或平台审核通过。

## 发布文件

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `cpuweb-harmony-3.1.1-v32-release.app` | 589422 | `2c01bfb36ad3a68c033ba70b1d813462e209b785766a88c24185371326a8cb16` |
| `cpuweb-harmony-3.1.1-v32-release.hap` | 1346713 | `2aee7bb264070a39cf05920c8cd00a1f69512795b36b1007caae5ee9d784702c` |

安装包、构建日志、签名校验记录和冒烟截图保存在 `output/harmony-3.1.1/`。新 Profile 位于签名目录的 `yaoda-shijian-release.p7b`，旧 Profile 备份为 `yaoda-shijian-release-20260903-no-screenlock.p7b`。私钥、密码和安装包不纳入 Git。

## 商店发布

本版不依赖站点部署。软件包上传时选「测试和正式上架」，商店信息沿用已发布版本。提交和审核结果以 AppGallery 控制台为准。

2026-11-06 已在 AppGallery Connect 提交审核：软件包上传于 16:45:05，合法性检测约 50 分钟后显示「已达标」；软件包加密选「加密」，发布国家或地区与 3.1.0 相同。提交后状态为「预审中」。
