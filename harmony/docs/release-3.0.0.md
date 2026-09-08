# HarmonyOS 3.0.0（20）发布记录

包名：`cn.lizmt.cpuweb`。本次同步应用清单、入口参数、User-Agent 和文档版本，保留原发布证书及 Profile。

## 更新内容

- 默认进入原生课表，完善周／日视图、课程配色及桌面服务卡片。
- 使用原生公共顶栏、底部导航与图片预览，修正安全区和按钮排版。
- 修复重复启动层、论坛返回循环、课表切页后无法滚动，以及底栏触摸穿透。

## 本机打包验证

2026-09-09：95 项鸿蒙与共享桥回归通过，DevEco SDK 6.1.1（API 24）release `assembleApp` 成功。使用既有发布证书签名，华为 `verify-app` 的代码签名与摘要验证通过。最终 APP 中的 `entry-default.hap` 与 `pack.info` 模块名称一致；包内版本为 3.0.0 / 20。

最终包：`D:/DevTools/Huawei/AppGallery/cn.lizmt.cpuweb/packages/cpuweb-harmony-3.0.0-v20-release-r2.app`。

SHA-256：`3aa7f9b0f908a0c877bddc36e49039c898677309e9bad218728b3b2d645ae6ae`。

历史包与本次中间打包尝试保留，私钥、密码和正式包不提交至 Git。本机打包／验签通过不代表应用市场审核或发布完成。AppGallery Connect 上传、平台校验和审核状态待平台回读；锁屏卡片能力仍须按 README 在平台确认。
