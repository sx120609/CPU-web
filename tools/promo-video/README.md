# 药大拾间宣传片

52 秒、1920×1080、30 fps 的品牌宣传片。产品画面全部来自真实前端：`capture.mjs` 在本地跑起 `web/` 和 VoiceHub，用示例数据把页面渲染出来再截图；`index.html` 负责镜头编排和动效，`score.py` 用 numpy 合成配乐。成片不含第三方素材、采样或版权音乐。

| 时间 | 段落 | 真实画面 |
|---|---|---|
| 0–6s | 开场 | 散落的校园入口碎片 →「现在，把它们拾到一起。」 |
| 6–12s | 品牌 | Logo 逐笔绘出，「药大拾间 · CPUer 校园互助与服务平台」 |
| 12–18s | 01 课表 | `/schedule` 周视图（第 7 周，带当前时间线） |
| 18–24s | 02 教务 | `/jwxt` 成绩页滚动，学业进度卡片和成绩卡片浮出 |
| 24–30s | 03 社区 | `/forum` 信息流里的真实帖子卡片 |
| 30–36s | 04 药苑之声 | VoiceHub 播出排期和歌词播放器 |
| 36–40s | 05 服务 | `/services` 页面滚动，`/announcements` 公告列表浮出 |
| 40–44s | 多端 | 桌面版首页和手机版首页；Web、Android、HarmonyOS、Windows、macOS |
| 44–52s | 收尾 |「拾起每一段校园时光」· cputime.cn · 非官方平台声明 |

## 导出

需要 Playwright（含 Chromium）、ffmpeg、python3 和 numpy。

```bash
# 首次准备：前端依赖，以及 VoiceHub 的构建产物
npm ci --prefix web
npm ci --prefix voicehub && npm run build:cpu --prefix voicehub

node tools/promo-video/capture.mjs                    # 拍真实界面 → output/promo/screens/ 和 manifest.json
node tools/promo-video/render.mjs                     # 成片 → output/promo/yaoda-shijian-promo.mp4
node tools/promo-video/render.mjs --stills 7,15.5,48  # 导出指定秒数的静帧，检查画面
node tools/promo-video/render.mjs --from 12 --to 18   # 只渲染一段（无配乐），检查动效
```

`capture.mjs` 不需要数据库，也不需要后端：Vite 开发服务器和 VoiceHub 服务端都在本地临时启动，所有接口请求都在浏览器里被拦截，由 `mock-api.mjs`、`mock-data.mjs` 和 `mock-voicehub.mjs` 应答，结束后会关掉服务器，并还原开发服务器改写的 `web/*.d.ts`。只想重拍某几个镜头时，在命令后面加镜头名的一部分，例如 `node tools/promo-video/capture.mjs forum voicehub`。

渲染可选参数：`--fps 60`、`--crf 16`、`--out <路径>`。`output/` 已被 `.gitignore` 忽略，截图和成片都不进仓库。

用浏览器预览 `index.html` 时要通过 HTTP 访问，否则字体和截图加载会失败。例如在仓库根目录运行 `npx http-server`，再访问 `/tools/promo-video/`。空格键播放或暂停，方向键前后跳 1 秒，加 `?t=15.5` 可以定格在指定时间。

## 修改

- **文案和时间轴：** 文案在 `index.html` 各个 `<section class="scene">` 里，时间轴在脚本的 `scene(...)` 调用中，单位是秒。每一帧都由 `render(t)` 按时间算出，不用 CSS 动画或过渡，所以逐帧截图结果是确定的。新加的动效也要写成 `t` 的函数。
- **画面里的数据：** 改 `mock-*.mjs` 后重新运行 `capture.mjs`。时钟固定在 2026-10-14 13:20（第 7 周周三）。课表、成绩、帖子、公告、歌曲和歌词都是虚构示例，不对应真实用户、真实成绩或真实曲目。
- **新增镜头：** 在 `capture.mjs` 的 `SHOTS` 里加一项。
  - `scroll: true` 会额外导出隐藏了固定顶栏和底栏的整页图，成片里在顶栏和底栏之间滚动。
  - `elements` 会把单个组件裁成浮动卡片。
- **段落时长：** 改动时长后，要同步调整 `score.py` 里的过场点（`cut`）和重击位置，让音乐继续踩在剪辑点上。
- **平台列表：** 只写已经发布的端。iOS 客户端上架之前不要加进去。
