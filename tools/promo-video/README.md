# 药大拾间宣传片

52 秒、1920×1080、30 fps 的品牌宣传片。画面是 `index.html` 里的 HTML/CSS 动画，配乐由 `score.py` 用 numpy 合成。成片不含任何第三方素材、采样或版权音乐。

| 时间 | 段落 | 内容 |
|---|---|---|
| 0–6s | 开场 | 散落的校园入口碎片 →「现在，把它们拾到一起。」 |
| 6–12s | 品牌 | Logo 逐笔绘出，「药大拾间 · CPUer 校园互助与服务平台」 |
| 12–18s | 01 课表 | 周视图课表、下一节课小组件 |
| 18–24s | 02 教务 | 绩点、培养方案进度、考试倒计时；统一认证授权、不保存学校密码 |
| 24–30s | 03 社区 | 课程点评、树洞、提问、二手交流信息流 |
| 30–36s | 04 药苑之声 | 唱片与频谱、正在播出、歌词 |
| 36–40s | 05 服务 | 公告推送、校园服务九宫格 |
| 40–44s | 多端 | Web、Android、HarmonyOS、Windows、macOS |
| 44–52s | 收尾 |「拾起每一段校园时光」· cputime.cn · 非官方平台声明 |

## 导出

需要 Playwright（含 Chromium）、ffmpeg、python3 和 numpy。

```bash
node tools/promo-video/render.mjs                     # 成片 → output/promo/yaoda-shijian-promo.mp4
node tools/promo-video/render.mjs --stills 7,15.5,48  # 导出指定秒数的静帧，检查画面
node tools/promo-video/render.mjs --from 12 --to 18   # 只渲染一段（无配乐），检查动效
```

可选参数：`--fps 60`、`--crf 14`、`--out <路径>`。`output/` 已被 `.gitignore` 忽略，成片不进仓库。

直接用浏览器打开 `index.html` 可以实时预览，但需要通过 HTTP 访问，否则字体加载会失败（例如在仓库根目录运行 `npx http-server`，再访问 `/tools/promo-video/`）。空格键播放或暂停，方向键前后跳 1 秒，`?t=15.5` 可以定格在指定时间。

## 修改

- 文案在 `index.html` 各个 `<section class="scene">` 里，时间轴在下方脚本的 `scene(...)` 调用中，单位是秒。
- 每一帧都由 `render(t)` 按时间算出，没有 CSS 动画或过渡，所以逐帧截图结果是确定的。新加的动效也要写成 `t` 的函数。
- 改动段落时长时，要同步调整 `score.py` 里的过场点（`cut`）和重击位置，让音乐继续踩在剪辑点上。
- 画面里的课表、成绩、帖子都是虚构示例，不对应真实用户或真实成绩。平台列表只写已经发布的端；iOS 客户端上架之前不要加进去。
