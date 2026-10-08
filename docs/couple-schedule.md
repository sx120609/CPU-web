# 情侣课表

情侣课表是课表页（`/schedule`）上的一层叠加，不是单独的页面。两名站内账号绑定后：

- 周视图里两人的课画在同一张网格上，TA 的课右上角有一个「TA」标记；只有两人的课撞在同一时段时才左右分开（左半是自己、右半是 TA），其余的课照常占满整格，两边都空的格子就是共同空闲。双人模式按人配色：一方蓝色系、一方粉色系（`coupleCourseTone`），配色保存在关系上（`CoupleLink.inviterColor`，接受方取另一种），双方看到的一致，任意一方可以在弹窗里互换。
- 两人同一节上同一门课（节次和课程名相同）合并成一整格，用双方颜色的渐变并带一个小爱心。
- 日视图同理：撞在同一时段的课分成“我 / TA”两列，其余占满一行。六种课表风格都按自己的画法显示（非经典风格的日视图用该风格的网格）。
- TA 此刻在上什么课和在一起的天数写在周次那一块的第二行，不另占一行；点它打开管理弹窗，右端的小图标切换“双人 / 只看我”。绑定后“上一周 / 下一周”收成箭头，把宽度让给这一行。
- 顶栏只保留学期、日/周、回到今天和「更多」；刷新、分享、情侣课表、添加到桌面放在「更多」菜单顶部的快捷区。
- 点 TA 的课查看时间、地点和老师；点空格仍然是给自己添加课程。
- 邀请、接受、配色、纪念日、解除绑定都在「更多 → 情侣课表」弹窗里。旧的 `/schedule/couple` 链接和邀请链接跳转到 `/schedule?couple=1` 打开这个弹窗。

## 原生客户端

原生课表页自己画 TA 的课，规则和网页一致：按日期对齐、一起上的课合并成一格、只有时间撞在一起的课才左右各占半格、六种风格都按人配色。状态行在周次条的第二行，「更多 → 情侣课表」是原生的管理面板（邀请、输入邀请码、互换配色、纪念日、显示开关、解除绑定）。原生端也会上传自己的课表：课表稳定几秒后把当前学期的整学期课表（含个人修改）发给 `PUT /api/couple/schedule`，内容没变时 12 小时内不重复上传。

- 鸿蒙：请求经过随包的页面桥 `window.CPUHarmonyCouple`（`harmony/bridge/couple.ts`）；规则在 `ScheduleCouple.ets`，模型和面板在 `NativeScheduleCouple.ets`。双人模式的日视图在所有风格下都用网格画。验收脚手架 `prepare-schedule-acceptance.mjs` 接受 `--ps couple active|pending|none` 和 `--ps panel couple`。隐藏周末时，只有 TA 有课的周末列不会单独显示出来（安卓会显示）。
- 安卓：请求经过随包的页面桥 `window.CPUAndroidCouple`（`android/bridge/couple.ts`），用网页会话的登录态；逻辑在 `ScheduleCouple.kt`，面板在 `ScheduleCoupleSheet.kt`。「在课表里显示 TA 的课」只保存在本机。调试参数 `--es debugCouple active|pending` 配合 `--ez debugMockSchedule true` 可以不登录看效果。

## 绑定

- 一方在情侣课表弹窗里生成邀请码（6 位，字母表 `A-Z 2-9` 去掉 `I`/`O`，24 小时有效），另一方输入后即绑定。邀请码只能用一次。
- `CoupleMember.userId` 是主键，数据库层面保证每个账号同时只属于一条关系（含待接受的邀请）。接受别人的邀请时，自己未被接受的邀请会作废。
- 任意一方都可以解除绑定。解除会删除整条 `CoupleLink`，成员、课表快照随之级联删除，对方会收到站内通知。
- 注销账号时 `accountDeletion` 会调用 `deleteCoupleDataForUser` 删除整条关系。

## 课表同步

服务端不保存教务课表，情侣课表读取的是双方各自上传的快照（`CoupleScheduleSnapshot`，每人一行）。

- 课表页（`Schedule.vue`）加载成功 4 秒后，若账号已绑定，就把**当前学期**完整课表（含自定义修改）和校历上传。翻看往年学期时不上传。
- 页面只有单周数据时需要再向教务请求整学期课表，因此同一份自定义修改最多每 6 小时拉取一次；内容指纹没变时最多每 12 小时刷新一次“同步于”时间。
- 未绑定的状态在浏览器里缓存 10 分钟，避免每次打开课表都查询服务端。弹窗里的状态变化会立即更新这份缓存；刚绑定时立即同步一次。
- 服务端对快照做与“分享课表”相同的校验（最多 600 门课、512 KB），内容哈希相同时只更新 `syncedAt`。

## 页面计算

按日期对齐、空闲计算、“此刻”状态在 `web/src/views/schedule/couple.ts`，有单元测试覆盖；叠加层状态在 `useCoupleOverlay.ts`，样式在 `styles/schedule-couple.scss`：

- 两人的课按**日期**对齐，每人用自己的校历解析周次和调休，所以学期不同也不会错位。
- 任何一方当天不在学期内时不显示 TA 的课，避免把“不知道”显示成“没课”。
- “此刻”按北京时间计算，自定义课程的开始/结束时间优先于节次表。

## 接口

全部需要登录，挂在 `/api/couple`：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/` | 当前状态：`none` / `pending`（含邀请码）/ `active`（含双方资料和快照时间） |
| POST | `/invite` | 生成或更换邀请码 |
| DELETE | `/invite` | 取消邀请 |
| POST | `/accept` | 接受邀请码（每 IP 10 分钟 15 次） |
| PATCH | `/` | 设置纪念日（`anniversary`：`YYYY-MM-DD`，不晚于今天；`null` 清除）或自己的颜色（`myColor`：`blue` / `pink`） |
| DELETE | `/` | 解除绑定 |
| PUT | `/schedule` | 上传自己的课表快照 |
| GET | `/schedules` | 读取双方快照 |

## 测试

- `server/tests/coupleSchedule.test.ts`、`web/tests/coupleSchedule.test.ts`、`web/tests/coupleSync.test.ts` 随 `npm test` 运行。
- 鸿蒙：`harmony/tests/editor-bridge.test.mjs`（页面桥）和 `harmony/tests/schedule-parity.test.mjs` 里的情侣课表用例。模型和面板（`NativeScheduleCouple.ets`）只在模拟器的验收脚手架里走过，没有单元测试。
- 安卓：`android/tests/native-bridge.test.mjs`（页面桥）和 `ScheduleParityTest` 里的情侣课表用例（配色与网页一致、合并规则、状态行文字、按日期取 TA 的课）。
- `server/tests/coupleSchedule.integration.test.ts` 需要独立的 PostgreSQL，默认跳过：

  ```bash
  COUPLE_INTEGRATION_TEST=1 DATABASE_URL="postgresql://...@127.0.0.1:5432/couple_test" node tools/run-node-tests.mjs server/tests/coupleSchedule.integration.test.ts
  ```
