# 新版客户端发布方案

## 1. 背景

旧 Android 客户端包名是 `cn.lizmt.cpuweb.schedule`，旧签名密钥已经丢失。Android 不允许同包名不同签名的 APK 覆盖更新，因此旧客户端无法继续无感升级。

新版 Flutter 客户端作为新应用线发布，允许与旧客户端并存安装。

## 2. 客户端身份

- 应用名：药大拾间
- Android package：`cn.lizmt.cpuweb`
- iOS bundle id：`cn.lizmt.cpuweb`
- 当前版本：`3.0.1+22`
- 旧客户端最后版本：`2.1.1 (20)`

版本号从 `21` 开始，是为了让旧客户端识别到“有新版客户端可下载”。

## 3. 发布形态

第一阶段仍是 Flutter 壳：

- Flutter 原生底栏
- Flutter WebView 承载现有 Web 页面
- Web 页面通过 `shell=flutter` 隐藏 Vue 移动底栏
- 外链交给系统浏览器
- 主页面加载失败时显示原生重试页

第二阶段再逐步 Flutter 化：

- 首页
- 我的
- 服务
- 教务入口
- 课表

## 4. 签名策略

生成新 keystore：

```bash
keytool -genkeypair -v -keystore android/app/upload-release.jks -alias cpuweb-release -keyalg RSA -keysize 2048 -validity 10000
```

创建本地签名配置：

```bash
copy android\key.properties.example android\key.properties
```

`android/key.properties` 示例：

```properties
storeFile=app/upload-release.jks
storePassword=...
keyAlias=cpuweb-release
keyPassword=...
```

密钥备份要求：

- 本机加密备份
- 云盘加密备份
- 离线压缩包备份
- 单独记录 alias、store password、key password

## 5. 构建与文件命名

构建 APK：

```bash
flutter build apk --release
```

构建产物：

```text
flutter_client/build/app/outputs/flutter-apk/app-release.apk
```

复制为站点下载文件：

```text
web/public/downloads/CPU-Web-Flutter-V2.apk
```

后续版本递增：

```text
CPU-Web-Flutter-V2.apk
CPU-Web-Flutter-V3.apk
```

## 6. 服务端下载入口

统一使用：

```text
/api/site/downloads/android-app
```

服务端优先查找：

```text
CPU-Web-Flutter-V*.apk
```

如果没有新版 APK，才回退到旧命名：

```text
CPU-Web-V*.apk
```

## 7. 旧客户端迁移

旧客户端无法覆盖升级，用户需要安装新版客户端。推荐话术：

```text
新版客户端已发布。由于旧版安卓签名已无法继续使用，本次需要安装新版客户端。
旧版和新版可以同时存在；安装新版后重新登录即可继续使用。
```

迁移入口：

- 旧客户端课表页更新提示
- 网站安装引导弹窗
- 公告/站内消息
- QQ 群公告

## 8. 上线步骤

1. 确认 `flutter analyze` 无问题。
2. 确认 `flutter test` 通过。
3. 生成并备份新签名密钥。
4. 构建 `flutter build apk --release`。
5. 重命名为 `CPU-Web-Flutter-V2.apk`。
6. 放入 `web/public/downloads/`。
7. 提交代码与 APK。
8. 服务器执行 `./deploy.sh update`。
9. 在 Android 浏览器访问 `/api/site/downloads/android-app`，确认跳转到新版 APK。
10. 旧客户端打开课表，确认能看到新版下载提示。
11. 新客户端安装后确认底栏、登录、课表、服务、外链可用。

## 9. 回滚策略

如果新版 APK 出现严重问题：

- 从 `web/public/downloads/` 移除问题版本 APK。
- 上传上一个稳定版本，例如 `CPU-Web-Flutter-V2.apk` 回滚到 `CPU-Web-Flutter-V1.apk`。
- 如需要隐藏旧客户端迁移提示，将 `ANDROID_APP_LATEST_VERSION_CODE` 暂时改回 `20` 并部署。

注意：已经安装新版客户端的用户不会自动降级，需要重新下载安装旧版本 APK。

## 10. 当前状态

当前机器已经完成 Flutter/Android 构建环境配置：

- Flutter SDK：`3.44.5`
- Dart：`3.12.2`
- JDK：Temurin 17
- Android SDK：`36.0.0`
- Android Build Tools：`36.0.0`
- Android licenses：已接受

已验证通过：

- `flutter analyze`
- `flutter test`
- `flutter build apk --debug`
- 服务端 TypeScript 构建
- Web 前端类型检查
- Web 前端生产构建

调试包产物：

```text
flutter_client/build/app/outputs/flutter-apk/app-debug.apk
```

剩余发布前动作：

- 生成并妥善备份新的 release keystore。
- 填写本机 `android/key.properties`。
- 构建 `flutter build apk --release`。
- 将 release APK 重命名为 `CPU-Web-Flutter-V2.apk` 并放入 `web/public/downloads/`。
