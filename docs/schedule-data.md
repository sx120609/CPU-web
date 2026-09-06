# 课表与小组件的共用数据链路

`server/src/services/scheduleData.ts` 是本科课表页面、原生小组件、Scriptable 和微信课表查询的公共取数入口。它调用原有 `jwxtTransport`，沿用 Agent 路由、加密会话保存和 SSO 自动换票，不保存学校密码。

## 数据与缓存

- 页面与小组件按同一教务会话、学期、周次共享原始课表缓存。主动刷新会替换同一个缓存项。
- 校历也共用缓存；当前周按中国时区的请求日期重新计算，不使用缓存生成时的当前周。页面成功读取且覆盖今天的校历可直接供小组件确定当前学期。
- 当前学期由学校课表确定，不采用教学周历下拉框中最后发布的旧学期。教学周历尚未发布时，`scheduleCalendarSource.ts` 读取学校首页课表的首末周日期及实际教学周范围，校验连续性后建立日期映射；不以九月或三月的固定日期猜测开学日。
- `server/src/shared/scheduleEdits.ts` 和 `scheduleWeeks.ts` 是页面与服务端共用的改课、隐藏课程、单双周规则。浏览器存储代码保留在 Web 层。
- 小组件从公共数据生成当周及未来七天的日期视图。每个所需周次都读取对应的真实课表，不用本周数据代替下周，也不单独推断学期或开学日期。
- 原有数据库中的最后成功小组件结果只用于失败回退。必须匹配缓存版本、查询周次并覆盖完整展示日期窗口；缺失日期、学期不符、周次不符或无可用校历时返回错误，不将未知数据当作无课。

## 已安装客户端兼容

现有 `/api/jwxt/schedule-widget?token=...` 地址、授权 token 及 `{ code, data, message }` 外壳保持兼容。`today`、`days`、`weekDays`、课程字段与 `strictDate` 沿用原协议。新增的同步时间字段允许旧客户端忽略。内部缓存版本升级不要求重新生成 token。

本次不需要发布 Android/iOS/鸿蒙安装包或重新复制 Scriptable 脚本。主站和实际承载 `jwxt.calendar` 查询的教务 Agent 都需更新；仅更新主站不能替换远端 Agent 的取数逻辑。更新后，已配置的小组件在下一次请求时使用公共取数链路；系统调度的刷新时间仍由设备决定。

## 验证

- `server/tests/scheduleData.test.ts`：共享缓存、页面强制刷新、会话隔离、跨周、缺失校历及取数失败。
- `server/tests/scheduleCalendarSource.test.ts`：教学周历尚未发布、当前学期与旧校历分离、学校首末周日期和范围校验，以及页面与小组件读取下周课程。样例结构及日期来自 2026-09-06 的已登录学校页面。
- `server/tests/scheduleWidgetRoute.test.ts`：原 URL 和 JSON 协议、失败回退、过期日期拒绝、授权撤销和请求期间授权变化。
- `server/tests/scheduleWidget.test.ts`：日期窗口、单双周、课程筛选。
- `web/tests/scriptableWidget.test.ts`：未修改的现有脚本读取新服务端数据与错误响应。

推送仍须通过精确提交的 `Linux deployment artifact`；部署需单独授权。
