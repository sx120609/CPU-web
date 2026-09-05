# 药大拾间课表 Android WebView

这是一个轻量 Android WebView 壳，默认打开 `https://cputime.cn/schedule`，用于把移动端课表页打包成 APK。

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
https://cputime.cn/schedule
```

生成 release 包：

```bash
gradle :app:assembleRelease
```

正式分发前需要在 Android Studio 中配置签名证书，或使用 Gradle signingConfig 接入自己的 keystore。不要把 keystore、密码或签名配置提交到仓库。

正式更新使用 `Android release artifact` 工作流生成的精确提交 APK，下载后使用现有发布证书签名，并核对包名、版本号和证书摘要。将签名包加入 `web/public/downloads/` 后，等待该提交的 `Linux deployment artifact` 成功，再部署其制品。

V37 将下载包复制到独立缓存并验证包名、版本和签名，通过 FileProvider 授予安装器读取权限。Web 仅对 V37 及声明 `supportsStagedApkInstall` 的客户端启用应用内更新；旧版打开普通 `/download` 页面交给系统浏览器，避免旧壳拦截 APK 链接。3.x 旧版会收到一次修复引导，手动更新入口始终可用。

## 可配置参数

| 参数 | 默认值 | 说明 |
|---|---|---|
| `appUrl` | `https://cputime.cn/schedule` | WebView 首屏地址 |
| `applicationId` | `cn.lizmt.cpuweb` | Android 包名 |
| `appName` | `药大拾间课表` | 桌面显示名称 |

示例：

```bash
gradle :app:assembleRelease -PappUrl=https://cputime.cn/schedule -PapplicationId=cn.lizmt.cpuweb -PappName=药大拾间
```
