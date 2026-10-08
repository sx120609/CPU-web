# 情侣课表

情侣课表是课表页（`/schedule`）上的一层叠加，不是单独的页面。两名站内账号绑定后：

- 周视图里两人的课画在同一张网格上，一个人一种颜色：自己的课全用自己的颜色，TA 的课全用 TA 的颜色（`couplePersonTone`，不再一门课一个色），TA 的课名上方有一个「TA」标记。关掉「显示 TA 的课」后回到平时的配色。颜色各选各的，一共七种（蓝、粉、紫、青、绿、黄、橙），存在成员上（`CoupleMember.color`），双方看到的一致；选了对方正在用的颜色就是两人互换，所以两人的颜色始终不同。没选过的成员沿用旧的方式（`CoupleLink.inviterColor`：邀请方蓝或粉，接受方取另一种）。
- 两人的课撞在同一时段时不对半分，也不另画一格：自己的课照常占整格，课的下沿多一行 TA 颜色的小字「TA 课名」，点它看 TA 那门课。其余的课照常占满整格，两边都空的格子就是共同空闲。
- 两人同一节上同一门课（节次和课程名相同）只画自己的那一格，下沿一行带小爱心的「一起」。
- 月视图里每天的格子先列自己的课，最下面单独一行「TA N 门」，用 TA 的颜色。
- 日视图在双人模式下换成专门的版式（`CoupleDayView.vue`，六种风格共用）：时间轴在中间，左边一列是自己的课，右边一列是 TA 的课，各自按自己的重叠分道；一起上的课两边各画一格。
- TA 此刻在上什么课和在一起的天数写在周次那一块的第二行，不另占一行；点它打开管理弹窗，右端的小图标切换“双人 / 只看我”。绑定后“上一周 / 下一周”收成箭头，把宽度让给这一行。
- 顶栏只保留学期、日/周、回到今天和「更多」；刷新、分享、情侣课表、添加到桌面放在「更多」菜单顶部的快捷区。
- 点 TA 的课查看时间、地点和老师；点空格仍然是给自己添加课程。
- 邀请、接受、配色、纪念日、解除绑定都在「更多 → 情侣课表」弹窗里。旧的 `/schedule/couple` 链接和邀请链接跳转到 `/schedule?couple=1` 打开这个弹窗。

## 原生客户端

原生课表页自己画 TA 的课，规则和网页一致：按日期对齐、一个人一种颜色（自己的课全用自己的颜色、TA 的课全用 TA 的颜色）、撞课时在自己的课下沿写一行「TA 课名」、一起上的课写「一起」、日视图时间轴居中、月视图每天一行「TA N 门」。状态行在周次条的第二行，「更多 → 情侣课表」是原生的管理面板（邀请、输入邀请码、互换配色、纪念日、显示开关、解除绑定）。原生端也会上传自己的课表：课表稳定几秒后把当前学期的整学期课表（含个人修改）发给 `PUT /api/couple/schedule`，内容没变时 12 小时内不重复上传。

- 鸿蒙：请求经过随包的页面桥 `window.CPUHarmonyCouple`（`harmony/bridge/couple.ts`）；规则在 `ScheduleCouple.ets`，模型和面板在 `NativeScheduleCouple.ets`，课下方的小字条和日视图在 `NativeScheduleBody.ets`，月视图在 `ScheduleMonthView.ets`。验收脚手架 `prepare-schedule-acceptance.mjs` 接受 `--ps couple active|pending|none`、`--ps coupleColors teal,amber` 和 `--ps panel couple`。隐藏周末时，只有 TA 有课的周末列不会单独显示出来（安卓会显示）。
- 安卓：请求经过随包的页面桥 `window.CPUAndroidCouple`（`android/bridge/couple.ts`），用网页会话的登录态；逻辑在 `ScheduleCouple.kt`，面板和课下方的小字条在 `ScheduleCoupleSheet.kt`，日视图在 `ScheduleCoupleDay.kt`，月视图在 `ScheduleMonth.kt`。「在课表里显示 TA 的课」只保存在本机。调试参数 `--es debugCouple active|pending` 配合 `--ez debugMockSchedule true` 可以不登录看效果。

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
