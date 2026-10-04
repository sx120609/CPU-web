# 部门联系工具与拾间AI

本功能在独立副本开发，并仅选择本任务14个文件提交。原工程的未提交修改未被写入或夹带。最初基线为 f5b5a94b40be4e7372a063300ab81107c9947ea1；草稿PR提交前已无冲突地移到远程 main/8d0cf5a870b66a3ea857c41f63a0e3ee6f8855b3。推送分支及运行GitHub构建不包含合并或生产部署授权。

## 干净基线及最新main验证

在 f5b5a94b 的独立副本仅应用14文件补丁后，后端完整构建通过；通讯录、真实普通/流式AI调用和相关教务接口共8个测试文件50项全部通过。该副本的 jwxtParser.ts 与提交版一致，原工程和初次混合副本的该文件未改变。以下首次验证中的三处类型错误属于原有未提交修改，不是本功能补丁的构建错误。

移到上述最新main后重新验证：后端完整构建、前端vue-tsc及完整前端构建通过；项目默认测试159个文件，共778项通过、4项按测试规则跳过、0项失败（不含项目默认排除的数据库及构建产物测试）。首次并行运行碰到Prisma生成期间读到不完整客户端及Windows沙箱的esbuild路径限制；生成完成后在可读环境重跑通过。通讯录预览使用最新main的真实路由与结构化API，继续以无头浏览器检查，不控制用户桌面。

正式Ubuntu24.04/Node24构建及精确提交产物以草稿PR对应的GitHub Actions运行结果为准。生产登录、AI额度完整链路及原生客户端实机仍需验收；不得把本地预览的静态站点外壳当成这些权限流程的验证。

## 接入与行为

- 校园小工具 /services/tools 新增“部门联系”；专用页面 /services/tools/department_contacts，详情通过 ?id=CPU-0035 深链。站内搜索及拾间AI action 注册了同一入口。
- 公开只读 GET /api/tools/department-contacts 支持 q、category、campus、includeSpecial=0|1、offset、limit；GET /api/tools/department-contacts/:id 读取详情。严格校验参数、160字上限、分页上限50，无写接口及数据库迁移。
- 页面提供中文需求搜索、常见部门简称、分类/校区筛选、详情、号码/邮箱/详情链接复制、用户主动 tel 链接、来源日期、未拨测/待核实状态、缺口、空结果、加载失败与重试。移动布局使用现有主题、48/44px级控件和焦点状态。
- 服务端 departmentContactsTool.execute 是页面API与拾间AI共用的结构化查询层。拾间AI现有 JSON/action 架构没有通用函数调用循环；本次在普通与流式处理函数中加入确定性、只读联系查询处理器。没有往模型提示词塞全量通讯录，也不需要模型生成号码。
- 校园卡和宿舍报修先确认校区；教务先区分学生类型与具体业务。本科选课、学生证、四六级只使用相应通知窗口；研究生学籍/成绩单按真实分工匹配，不能把本科选课号码泛化到所有教务事项。仅立即前一轮确实出现本工具澄清时，接受简短补充。
- AI回答附业务范围、来源URL、发布/核对日期和工具详情 action；无适用记录时不给号码。保留现有 /search/assistant 的登录、限流、积分/配额和公开话题限制，未新增自动拨号或发邮件操作。由于未连接数据库，本次没有验证生产登录/扣费/退款链路。

## 数据与溯源

核实的 Library 文件：

- libfile_d038c0c7b3608191b932f38d9147c9f2：CPU_contacts_20261003.json，316495字节、9806行。
- libfile_104acdf11dd881918bdbd5cd0dde3c8b：中国药科大学通讯录资料包_20261003.zip，140882字节。

按当前 Library 技能调用下载流程，在明确本地目录重试一次，均因 Windows Python 缺少 os.setxattr 而失败；未伪称原始文件或资料包已成功下载，未删除元数据来规避下载流程。之后通过 Library read 逐段完整读取 JSON，解析真实字段，生成独立的项目应用数据（字段转驼峰，来源表转数组）。该文件是派生应用数据，并非原始材料的 materialized 副本；provenance 记录精确 Library ID、文件名、读取方式和原始大小。ZIP原始包仍未取得。

server/src/data/departmentContacts.json 保留262条联系记录、77个来源、24项缺口/冲突。190条原有 suggestedDefaultDisplay=true，72条其他记录。编者标记不代表官方认证，也不代表实测有效；未电话拨测或发邮件。来源不明的日期、时间、校区、地址继续保留为空并显示“来源未注明”，没有推断补齐。

默认展示190条建议记录；冲突、季节/假期、人才招聘等记录需主动包含，保留原 note、recordType 和完整来源。较早资料有待核实提示；日期超过两年的资料也提示核实。这些标签表示证据条件，不能证明号码失效。寒暑期通知、招聘联系、图书馆物业不能作为全校常年办事总机或图书馆借阅电话。数据未再次联网更新，资料核对日期仍是2026-10-03。

## 初次混合副本实测记录

| 检查 | 结果 |
| --- | --- |
| 新增 departmentContacts.test.ts | 10/10通过；真实数据、中文/别名/分类/校区/分页、过期/冲突、无结果、安全输入、来源、HTTP只读API、AI多轮及真实普通/流式处理函数 |
| 全项目 Node 测试的服务端组 | 570通过，2跳过，0失败 |
| 全项目 Node 测试的前端 TypeScript 组 | 142通过，0失败 |
| JavaScript测试组 | 最初2个文件因沙箱祖先目录读取限制失败；以允许的本地读取权限补验5个文件后28通过、0失败 |
| 前端 vue-tsc | 通过 |
| 前端完整 build | 通过；初次esbuild受祖先目录读取权限阻断，获自动审批后完成本地构建 |
| 后端完整 build / tsc | 被3处原有错误阻塞；原主副本只读 tsc 出现同样错误，新增查询/API模块单独类型检查通过 |
| lint | 项目没有lint脚本；本任务改动通过git diff --check |
| 浏览器 | 10场景通过，无页面异常；真实联系API，仅无关站点外壳使用本地静态预览配置 |
| 375px与812px布局 | 已修复并复测横向溢出；375px竖屏、812px横屏均无横向滚动；深色、大字、减少动效通过 |
| 复制/主动拨号 | 复制使用浏览器局部替身核对号码，没有写系统剪贴板；校验tel href，没有实际拨号 |
| 无障碍 | 修复本页链接对比度、嵌套main及控件分组语义后，本页axe检查23项通过、0违规、0待确认 |

后端原有错误：

1. server/src/routes/jwxt.ts:789：CalendarResult 缺少 source。
2. server/src/services/scheduleTermConfig.ts:209：CalendarResult 缺少 adjustments。
3. server/src/services/scheduleWidgetData.ts:38：CalendarResult 缺少 adjustments。

按用户要求没有修改这些无关课表代码。全项目测试默认排除依赖 PostgreSQL 的 campusAssistant.test.ts 和构建后运行的 staticRequestBudget.test.mjs，服务端另有2项条件跳过。新增测试已直接运行 askCampusAssistant 和 streamCampusAssistant，未依赖远程模型或编造通讯录。检查环境为Windows/Node26.5，不能替代仓库要求的Ubuntu24.04/Node24 CI制品。

浏览器实测涵盖：工具导航/分页、中文表单/筛选/来源、复制、详情深链/焦点、手机竖横屏、深色/大字/减少动效、空结果/安全输入、专项记录显式展示、冲突详情、加载失败重试。相关截图和机器可读结果位于任务目录 deliverables。无障碍结果以 accessibility-verification.json 为准。

额外AI证据 ai-verification.json 记录实际入口注册、askCampusAssistant/streamCampusAssistant一致性、校园卡多轮澄清、玄武门宿舍报修、本科选课三个流程的真实来源与详情API；直接将这些AI返回的详情URL在浏览器打开核对。未模拟远程模型函数调用，未将页面成功宣称为生产登录后整条AI会话UI已验收。

## 客户端与上线

Web桌面、移动Chromium已实测。现有Android、Flutter、iOS、ios_next、Harmony客户端都通过网站服务入口访问此路由；检查到已有外部链接/系统协议处理。ios_next 原生AI已有 actions/sources 展示及站内URL打开机制，可消费本次响应，无需新响应协议。未修改原生项目，未编译或真机验证这些客户端，也未测试Windows Electron、Safari/WebKit、实际拨号器、剪贴板权限或VPN来源访问。

本地复现（使用独立端口，不占现有默认服务端口）：

1. server目录：node --import tsx scripts/preview-department-contacts.ts
2. web目录：node preview-department-contacts.mjs
3. 打开 http://127.0.0.1:18731/services/tools/department_contacts。预览仅监听127.0.0.1；真实联系API无需DB，无关外壳是测试配置，不代表生产登录/权限状态。
4. 仓库根目录：node tools/run-node-tests.mjs departmentContacts；npm run type-check --prefix web；npm run build --prefix web。

准备上线时先审查本任务14文件改动，并补测生产登录/AI配额及原生客户端入口、来源打开、复制和拨号确认流程，由部门维护者核实冲突/历史记录。按 AGENTS.md 与 docs/production-requirements.md 验证精确SHA对应的Ubuntu24.04/Node24 Linux deployment artifact；获得独立部署授权后才使用该GitHub制品部署。草稿PR仅供审查，不包含合并、数据库写入或生产部署。
