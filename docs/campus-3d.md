# 三维校园

江宁校区的三维模型，入口在 `/services/tools/yaoda-can-fly/campus-3d`（旧地址 `/services/tools/campus-3d` 会跳转），也可以从「校历与地图 → 校园地图」或服务工具卡片「三维校园」进入。路径放在 `yaoda-can-fly` 前缀下，是因为已发布的 Android / iOS 壳只对这个前缀隐藏顶栏和底栏。

模型按 OpenStreetMap、卫星影像和实景照片还原，**非官方**，位置与通行以校内指引为准。页面保留「非官方三维模型」声明和 OpenStreetMap 署名，不内嵌卫星影像。

## 能做什么

- **鸟瞰**：拖动平移、右键或 Ctrl + 拖动旋转倾斜、滚轮缩放；搜索楼宇和宿舍楼号，点建筑看简介；切换四季与昼夜、水面反射、2D 视图，量距离，小地图定位。
- **导览**：按站点自动飞行，逐个停留环绕。
- **自由探索**：第一人称在校园里走，楼、墙、围栏、柱子、车和行人都有碰撞；进湖可以游泳（冬天结冰）；停着的汽车可以开，路边停着的自行车可以骑。

| 操作 | 电脑 | 手机 |
|---|---|---|
| 移动 | WASD，Shift 冲刺，C 蹲，空格跳 | 左侧摇杆，推出圈外冲刺 |
| 看四周 | 鼠标（指针锁定） | 右侧拖动 |
| 查看建筑 / 上车 / 骑车 | 准星对准或靠近后按 E | 点建筑；靠近车辆时点「上车 / 骑车」提示 |
| 开车 | WASD，空格手刹，V 切换视角，E 下车 | 单摇杆：推向哪边就往哪开，往回推先刹车再倒车，松手缓停 |
| 骑车 | WASD，空格跳，B 打铃，V 切换视角，E 下车 | 单摇杆，往回推掉头 |
| 暂停 / 退出 | Esc | 退出按钮 |

## 联机

自由探索时能看到同时在逛的其他人（走路、游泳、开车、骑车都会同步），头顶显示名字，画面上显示在线人数。登录用户显示站内昵称，游客显示「游客123」这类随机名，被封禁的账号不能联机。暂停面板里可以开「隐身」：自己照样看得到别人，别人看不到你。

接口在 `server/src/routes/campus3dPresence.ts`：

| 接口 | 说明 |
|---|---|
| `POST /api/tools/campus-3d/presence/join` | 可选登录；返回 `sid`、`key`（只给本人）、对外的随机 `pid` 和名字 |
| `POST /api/tools/campus-3d/presence/sync` | 约每 250 ms 一次，上报 `[x, y, z, 朝向, 模式, 颜色, 速度]` 与是否隐身；返回附近 600 m 内最近的 40 人 |
| `POST /api/tools/campus-3d/presence/leave` | 离开 |

- 只存在内存里，不写数据库，不留轨迹；12 秒没有上报就算离开，同时最多 400 人。
- 别人只拿得到随机 `pid` 和名字，拿不到账号 id、`sid` 或 `key`；`key` 用定长比较校验。
- 用短轮询而不是 WebSocket / SSE：nginx 只对 `/agent` 做协议升级，前面还有 CDN，而且准入控制会把长连接算作挂起请求。前端走站点自己的 `request` 封装，带 `suppressErrorMessage` 和 `preserveResponseCache`，高频同步既不弹错，也不会把别的接口缓存标成过期。
- 测试：`server/tests/campus3dPresence.test.ts`。

## 代码组织

- `web/src/views/services/Campus3D.vue` 建一个 Shadow DOM，把场景挂进去并传入联机适配器；站点样式和场景样式互不影响。
- `web/src/views/services/campus3d/` 下的 `app.js`、`ui.js`、`style.css`、`images.js`、`osm-data.json`、`osm-outer.json` 由独立的建模工程（cpu-jiangning-3d，不在本仓库）用 `tools/export_cpuweb.py` 生成，**不要手改**，改模型后重新导出。
- 这样生成是为了过站点的 CSP：不允许内联脚本、启用 Trusted Types（`innerHTML` 经过 DOMPurify，会剥掉 SVG），所以界面全部用 DOM 调用搭建；构建产物可能从 CDN 域名加载，所以要上传到 WebGL 的图片都内联成 data URL，避免画布被污染。
- 依赖 npm 的 `three@0.160.0`。

## 性能

- 画面在 GPU 上用 WebGL2 渲染。电脑上：场景 4 倍 MSAA、半分辨率 GTAO、4096 阴影贴图（约每 120 ms 更新）、水面反射、夜间泛光，最后在调色锐化 pass 里完成色调映射和 sRGB 输出。帧率持续偏低时依次关 GTAO、降阴影分辨率、关水面反射。手机默认低画质：2 倍 MSAA，不开阴影、GTAO 和水面反射。
- 只有场景本身走 MSAA，后面的全屏 pass 都写普通目标；GTAO 直接乘进当前帧，不再先复制一份。
- 建筑合并成按材质分的大网格，顶点做了索引；行人和汽车只把视野（放宽 40°，并检查影子落点）里的实例交给 GPU。
- 准星、悬停、点击和落脚点检测用 16 m 网格索引做射线检测，不对全部约 60 万个建筑三角形逐个求交。
- 树、行人、车辆按距离和视野分级；近处草丛只在镜头低时生成。
