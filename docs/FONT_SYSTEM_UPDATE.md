# 字体系统升级说明

## 更新内容

本次更新优化了字体配置，使用自托管字体 + 系统字体回退策略，确保全平台显示一致且不依赖第三方字体 CDN。

### 字体方案

#### 英文字体
- **Inter Variable** - 保持原有，现代无衬线字体，专为屏幕显示优化

#### 中文字体
- **HarmonyOS Sans SC** (鸿蒙黑体) - 华为字体，通过项目自有 CDN 加载
  - 按 HarmonyOS Sans Fonts License Agreement 使用并原样分发
  - 字形设计现代、清晰
  - 支持 3 个字重：Regular (400)、Medium (500)、Bold (700)
  - CDN 来源：阿里云私有 OSS + ESA `static.cputime.cn`

#### 等宽字体
- **JetBrains Mono** - 专业编程字体，替代 Roboto Mono
  - 更好的字符区分度（0/O, 1/l/I）
  - 连字支持
  - 专为代码设计

### 字体回退策略

完整的字体栈确保在各平台都有优秀显示：

```css
--cpu-font-sans: "Inter Variable", "HarmonyOS Sans SC", 
                 -apple-system, BlinkMacSystemFont, "PingFang SC", 
                 "Microsoft YaHei", "Segoe UI", sans-serif;

--cpu-font-mono: "JetBrains Mono", "SF Mono", "Menlo", 
                 "Consolas", monospace;
```

#### 各平台显示效果

| 平台 | 英文 | 中文 |
|---|---|---|
| **macOS/iOS** | Inter → SF Pro (系统) | HarmonyOS Sans SC → PingFang SC (回退) |
| **Windows** | Inter | HarmonyOS Sans SC → 微软雅黑（回退） |
| **Android** | Inter | HarmonyOS Sans SC |
| **Linux** | Inter | HarmonyOS Sans SC |

如果自有 CDN 字体暂时不可用，浏览器才会继续使用苹方、微软雅黑等系统字体。

### 技术细节

1. **自有 CDN 加载**
   - HarmonyOS Sans SC 作为 Vite 构建资源输出到版本化路径
   - 生产发布时由现有静态资源同步流程上传到所选对象存储；阿里云 OSS 通过 `static.cputime.cn` 分发
   - VoiceHub 复用同一套自有 CDN 字体资源
   - 使用 `font-display: swap` 避免文字闪烁

2. **性能优化**
   - 使用 WOFF2 格式和长期 CDN 缓存
   - 字体资源采用固定版本目录，避免缓存串版
   - 本机已经安装鸿蒙字体时优先使用本机文件

3. **兼容性**
   - VoiceHub 子应用同步更新
   - 保持 MiSans 兼容性映射

### 文件变更

#### 更新的文件
- `web/package.json` - 移除 Noto Sans SC、Roboto Mono，添加 JetBrains Mono
- `web/src/main.ts` - 更新字体导入
- `web/src/styles/index.scss` - 更新字体变量
- `web/src/styles/harmonyos-sans.css` - 引入构建内的 HarmonyOS Sans 字体
- `web/vite.config.ts` - 将字体输出到自有 CDN 的固定版本路径
- `voicehub/app/assets/css/main.css` - 更新字体变量和 MiSans 自有 CDN 映射

#### 新增的文件
- `web/src/assets/fonts/` - 未修改的 HarmonyOS Sans SC WOFF2 字体及来源校验信息
- `web/public/licenses/fonts/HarmonyOS-Sans-LICENSE.txt` - HarmonyOS Sans 完整许可协议

### 字体许可

字体许可如下：

- **Inter**: OFL 1.1 (Open Font License)
- **JetBrains Mono**: OFL 1.1
- **HarmonyOS Sans**: HarmonyOS Sans Fonts License Agreement；字体文件保持未修改并随软件保留声明
- **系统字体**: 各操作系统自带

## 升级步骤

```bash
# 1. 安装新依赖
npm install --prefix web

# 2. 构建测试
npm run build --prefix web

# 3. 启动开发服务器测试
npm run dev --prefix web
```

## 验证

构建成功后：

1. 打开浏览器开发者工具 Network 面板
2. 筛选 Font 类型
3. 确认 HarmonyOS Sans 请求来自 `static.cputime.cn` 且返回 200
4. 检查页面中英文混排显示效果

## 回滚

如需回滚到之前版本：

```bash
git revert HEAD
npm install --prefix web
```

## 相关链接

- [Inter 字体](https://rsms.me/inter/)
- [JetBrains Mono](https://www.jetbrains.com/lp/mono/)
- [HarmonyOS Sans 官方说明](https://developer.huawei.com/consumer/cn/doc/doccenter-ux-design/font-0000001828772001)
