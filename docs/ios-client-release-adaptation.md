# iOS 原生客户端上架适配

更新日期：2026-09-25。

- App Store 入口：https://apps.apple.com/cn/app/id6811073406。商店页面要求 iOS / iPadOS 17.0 或更高版本（与 `ios_next` 的部署目标一致），前端常量为 `IOS_APP_MIN_MAJOR_VERSION`。
- 下载页、课表安装引导和拾间 AI 优先推荐 App Store 原生版，并写明系统要求；系统低于 iOS 17 时，安装引导直接展示 Safari 添加到主屏幕的步骤，不显示 App Store 按钮。
- 首页和课表为 iPhone/iPad Safari、Safari 主屏幕版展示非模态下载推荐。关闭或点击“在 App Store 下载”后 7 天内不再提示。原生客户端、桌面 Safari、微信/QQ 等内置浏览器、Chrome 等第三方浏览器以及低于 iOS 17 的设备不展示。桌面模式 iPad 的主屏幕版无法读取系统版本，仍会展示，由商店页面判断兼容性。
- `X-CPU-Client` 新增 `ios-native` / `ios-pwa`，服务端仍映射到 `ios` 平台用于公告投放、iOS 商务限制等业务。原生 UA 优先于旧 Web 包的请求头；鸿蒙的共享 `CPUTimeNative` 标记不会误归到 iOS。
- 用户足迹保留 `usedIosClient` 汇总，新增 `usedIosNativeClient` / `usedIosPwaClient`。登录和已登录会话的 `/user/me` 都会累计使用足迹；恢复会话不会伪造登录时间。
- 后台概览新增 iOS 原生 / Safari 主屏幕版使用人数和今日登录数，用户列表新增对应筛选及标签。使用过两类客户端的用户在两类中分别计数，不能简单相加。历史数据无法可靠拆分，保持“未区分”，不回填为原生安装量。
- 这些账号级统计与「iOS 客户端」页互补：该页来自原生 App 心跳和 MetricKit，按安装去重，统计安装量、设备日活、版本与稳定性；本文的标记按账号记录登录和使用过的 iOS 形态，并覆盖 Safari 主屏幕版。
- 最近登录和每日登录行保存细分客户端标记（`ios` 仅表示历史未区分记录）。按 `loginClient=ios` 筛选时包含全部 iOS 变体。这些统计是登录/使用人数，并非 App Store 下载量。

## 发布

`npm run db:migrate --prefix server` 已接入 `20260925090000_ios_client_variants` 幂等增列迁移。发布时应先迁移数据库、生成 Prisma Client，再启动新版服务。无需重置数据。

该迁移只新增两个带默认值 `false` 的布尔列，不删除、不重命名、不改写已有数据，旧版服务可继续读写。按 [在线更新与蓝绿切换](zero-downtime-deployment.md) 的要求，审查确认后以 `DEPLOY_ALLOW_SCHEMA_EXPAND=1` 执行扩展迁移。

推送 `main` 时遵守 `docs/production-requirements.md`；推送和 GitHub 编译不代表部署授权，部署仍需用户明确要求。

## 验证

```powershell
node --test web/tests/iosClient.test.mjs
cd server
node --import tsx --test tests/loginClient.test.ts
```
