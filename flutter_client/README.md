# 药大拾间 Flutter 客户端

这是新版移动客户端线。它不再沿用旧 Android WebView 包名 `cn.lizmt.cpuweb.schedule`，而是使用新的正式包名：

```text
cn.lizmt.cpuweb
```

第一版版本号：

```text
3.0.1+22
```

其中 `22` 是当前 Flutter V2 release；首发 `21` 高于旧客户端 `2.1.1 (20)`，便于旧客户端迁移提示。

## 开发运行

```bash
flutter pub get
flutter run
```

如需连接本地 Vite 开发服务：

```bash
flutter run --dart-define=CPU_WEB_BASE_URL=http://10.0.2.2:5173
```

正式环境默认打开：

```text
https://cpu.lizmt.cn
```

## Android 发布

当前本机已配置 Flutter SDK、JDK 17 和 Android SDK，可通过：

```bash
flutter analyze
flutter test
flutter build apk --debug
```

正式发布前还需要创建新的 release 签名。

先生成并妥善保存新版签名密钥：

```bash
keytool -genkeypair -v -keystore android/app/upload-release.jks -alias cpuweb-release -keyalg RSA -keysize 2048 -validity 10000
```

然后复制签名配置模板：

```bash
copy android\key.properties.example android\key.properties
```

填写 `android/key.properties` 后构建：

```bash
flutter build apk --release
```

发布文件命名为：

```text
CPU-Web-Flutter-V2.apk
```

放到：

```text
web/public/downloads/CPU-Web-Flutter-V2.apk
```

服务端部署后，`/api/site/downloads/android-app` 会优先跳转到最新的 `CPU-Web-Flutter-V*.apk`。

## 重要约定

- `android/key.properties` 和 keystore 不入仓。
- 新版客户端和旧版客户端可以并存安装。
- 旧客户端不能被新签名 APK 覆盖安装，需要引导用户安装新版客户端。
- 后续版本只递增 `pubspec.yaml` 的 build number，例如 `1.0.1+22`。
