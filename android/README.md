# 药大拾间课表 Android WebView

这是一个轻量 Android WebView 壳，默认打开 `https://cpu.lizmt.cn/schedule`，用于把移动端课表页打包成 APK。

## 构建环境

- Android Studio 最新稳定版
- Android SDK Platform 35
- JDK 17 或更高版本

## 调试构建

用 Android Studio 打开本目录 `android/`，等待 Gradle 同步完成后运行 `app` 模块。

命令行构建需要先安装 Gradle，或在 Android Studio 中为本工程生成 Gradle Wrapper。

```bash
gradle :app:assembleDebug
```

如需调试本机 Vite 开发服务器，可覆盖启动地址：

```bash
gradle :app:assembleDebug -PappUrl=http://10.0.2.2:5173/schedule
```

## 发布构建

默认发布地址已经配置为：

```text
https://cpu.lizmt.cn/schedule
```

生成 release 包：

```bash
gradle :app:assembleRelease
```

正式分发前需要在 Android Studio 中配置签名证书，或使用 Gradle signingConfig 接入自己的 keystore。不要把 keystore、密码或签名配置提交到仓库。

## 可配置参数

| 参数 | 默认值 | 说明 |
|---|---|---|
| `appUrl` | `https://cpu.lizmt.cn/schedule` | WebView 首屏地址 |
| `applicationId` | `cn.lizmt.cpuweb.schedule` | Android 包名 |
| `appName` | `药大拾间课表` | 桌面显示名称 |

示例：

```bash
gradle :app:assembleRelease -PappUrl=https://cpu.lizmt.cn/schedule -PapplicationId=cn.lizmt.cpuweb.schedule -PappName=药大拾间课表
```
