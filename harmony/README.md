# 药大拾间 HarmonyOS App

这是和 Android WebView 壳保持同一规格的 HarmonyOS Stage 模型工程。

## 能力

- ArkUI `Web` 组件加载站点页面。
- 注入 `CPUHarmony` JavaScript Bridge。
- 同时注入 `CPUAndroid` 兼容别名，避免旧网页代码调用失败。
- 支持版本号、复制文本、外链打开、图片保存到相册、文件选择上传。
- 使用现有站点 logo，未重绘图标。

## 基础信息

- 应用名：药大拾间
- 包名：`com.cpu.yaodashijian`
- 版本：`2.0.8 (17)`
- 默认入口：`https://cpu.lizmt.cn/schedule`

## 构建

本机需要安装 DevEco Studio / HarmonyOS SDK。

1. 用 DevEco Studio 打开 `harmony` 目录。
2. 在 Project Structure 中配置签名证书。
3. 执行 `Build Hap(s) / APP(s)`。

命令行环境可用时，也可以在 `harmony` 目录执行：

```bash
hvigor assembleHap
```

## 发布注意

如果后续要上架应用市场，应用图标请使用仓库现有 logo：`web/public/icon-512-v2.png` 或按平台要求导出的 1024 PNG。
