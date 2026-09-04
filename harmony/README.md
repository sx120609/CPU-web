# 药大拾间 HarmonyOS App

这是和 Android WebView 壳保持同一规格的 HarmonyOS Stage 模型工程。

## 能力

- ArkUI `Web` 组件加载站点页面。
- 注入 `CPUHarmony` JavaScript Bridge。
- 通过仅暴露方法的 `CPUHarmony` 原生代理与网页通信，兼容 ArkWeb 的 JavaScript Proxy 约束。
- 支持版本号、复制文本、外链打开、图片保存到相册、图片/文档选择上传。
- 支持相机、麦克风按需授权，权限请求仅允许来自 `cputime.cn`。
- 支持 2×2、2×4、4×4 桌面课表卡片，以及 1×2 横条、1×1 圆形、1×2 矩形三种锁屏课表卡片。
- 课表卡片支持 30 分钟刷新、离线缓存、主题同步和带学期/周次的深链回跳。
- 网页图片选择走系统图库 Photo Picker，普通附件继续走系统文件选择器。
- 支持 `cpuweb://schedule` 深链，从服务卡片恢复当前学期与周次。
- 使用现有站点 logo，未重绘图标。

## 基础信息

- 应用名：药大拾间
- 包名：`cn.lizmt.cpuweb`
- 版本：`2.0.9 (18)`
- 默认入口：`https://cputime.cn/schedule`

## 构建

本机需要安装 DevEco Studio / HarmonyOS SDK。项目不再包含旧开发者账号的签名路径或凭据，首次打开后请使用当前“药大拾间”开发者账号配置自动签名或导入该账号签发的发布证书。

1. 用 DevEco Studio 打开 `harmony` 目录。
2. 登录当前“药大拾间”开发者账号，并在 Project Structure 中为 `cn.lizmt.cpuweb` 配置签名证书。
3. 锁屏卡片需先在 AppGallery Connect 的“开放能力接入”申请并开启“锁屏卡片”，然后重新生成包含该能力的发布 Profile。
4. 执行 `Build Hap(s) / APP(s)`。

命令行环境可用时，也可以在 `harmony` 目录执行：

```bash
hvigorw --mode module -p product=default -p module=entry@default -p buildMode=debug assembleHap
```

## 发布注意

如果后续要上架应用市场，应用图标请使用仓库现有 logo：`web/public/icon-512-v2.png` 或按平台要求导出的 1024 PNG。

发布签名必须使用当前开发者账号为 `cn.lizmt.cpuweb` 签发的 `.cer` 和发布 Profile（`.p7b`）；本地 `.p12`、CSR 和密码不进入仓库。
