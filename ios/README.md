# 药大拾间 iOS 客户端

这是 Android WebView 客户端的原生 iOS 迁移版，最低支持 iOS 17。App 默认打开 `https://cputime.cn`，并包含 WidgetKit 课表小组件。

## 已迁移能力

- WKWebView 壳、Cookie/DOM 存储、返回手势、启动页和网络错误重试
- 同域页面在 App 内打开，外部网页、电话、邮件和短信交给系统处理
- 网页文件选择、媒体权限和附件下载
- `CPUIOS` JavaScript 原生桥：版本信息、剪贴板、外链、图片预览、保存到相册和小组件配置
- 三类 WidgetKit 小组件，共对应 Android 的五种有效布局：
  - 临近课程：小号、中号
  - 今日课表：中号、大号
  - 两日课表：大号

Android 的 APK 应用内更新没有迁移；iOS 发布后应使用 App Store 更新机制。

## 运行

用 Xcode 打开 `ios.xcodeproj`，选择 `cpuweb` scheme 和模拟器或真机后运行。

命令行模拟器构建：

```bash
xcodebuild \
  -project ios.xcodeproj \
  -scheme cpuweb \
  -sdk iphonesimulator \
  -configuration Debug \
  build
```

不要用 `CODE_SIGNING_ALLOWED=NO` 测试小组件。该选项只适合验证源码能否编译，生成的 App 不具备 App Group entitlement，主 App 无法把课表配置共享给 Widget。

首屏地址由 `CPU_APP_URL` build setting 控制，默认值为 `https://cputime.cn`。

## 签名与小组件

App 和小组件扩展使用以下标识：

- App：`cn.lizmt.cpuweb`
- Widget Extension：`cn.lizmt.cpuweb.widgets`
- App Group：`group.cn.lizmt.cpuweb`

在真机或归档前，需要在 Apple Developer 后台为两个 App ID 启用同一个 App Group，并在 Xcode 中选择具备这些能力的开发团队。登录教务后，在课表页的“更多”中点击“添加 iOS 小组件”，客户端会保存独立的小组件凭据并刷新所有时间线；随后长按主屏幕，从系统小组件图库添加“药大拾间课表”。
