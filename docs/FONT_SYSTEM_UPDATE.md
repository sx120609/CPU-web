# 字体系统升级说明

## 更新内容

本次更新优化了字体配置，使用开源字体 + 系统字体回退策略，确保全平台优秀显示效果。

### 字体方案

#### 英文字体
- **Inter Variable** - 保持原有，现代无衬线字体，专为屏幕显示优化

#### 中文字体
- **HarmonyOS Sans SC** (鸿蒙黑体) - 华为开源字体，通过 CDN 加载
  - 开源免费，可商用
  - 字形设计现代、清晰
  - 支持 3 个字重：Regular (400)、Medium (500)、Bold (700)
  - CDN 来源：jsDelivr (npm: @fontsource/harmonysans-sc)

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
| **macOS/iOS** | Inter → SF Pro (系统) | HarmonyOS Sans SC → PingFang SC (系统) |
| **Windows** | Inter | HarmonyOS Sans SC → 微软雅黑 |
| **Android** | Inter | HarmonyOS Sans SC |
| **Linux** | Inter | HarmonyOS Sans SC |

**Apple 设备优势**: 自动使用系统内置的 SF Pro 和 PingFang SC，无需下载额外字体，加载更快。

### 技术细节

1. **CDN 加载**
   - HarmonyOS Sans SC 通过 jsDelivr CDN 加载
   - 使用 `font-display: swap` 避免文字闪烁
   - Unicode-range 优化，仅中文字符使用该字体

2. **性能优化**
   - `preload` 预加载字体 CSS
   - WOFF2 格式，体积小
   - 系统字体优先，减少网络请求

3. **兼容性**
   - VoiceHub 子应用同步更新
   - 保持 MiSans 兼容性映射

### 文件变更

#### 更新的文件
- `web/package.json` - 移除 Noto Sans SC、Roboto Mono，添加 JetBrains Mono
- `web/src/main.ts` - 更新字体导入
- `web/src/styles/index.scss` - 更新字体变量
- `web/index.html` - 引入 HarmonyOS Sans CSS
- `voicehub/app/assets/css/main.css` - 更新字体变量和 MiSans 映射

#### 新增的文件
- `web/public/fonts/harmonyos-sans.css` - HarmonyOS Sans 字体声明

### 字体许可

所有使用的字体均为开源或系统字体：

- **Inter**: OFL 1.1 (Open Font License)
- **JetBrains Mono**: OFL 1.1
- **HarmonyOS Sans**: OFL 1.1
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
3. 确认字体正常加载
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
- [HarmonyOS Sans](https://github.com/google-fonts/harmonysans)
- [jsDelivr CDN](https://www.jsdelivr.com/)
