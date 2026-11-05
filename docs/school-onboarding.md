# 接入一所学校

站点、网页和三端原生壳都按学校档案和学校驱动工作，接入新学校只改服务端，不改原生代码，也不用重新发 App。

## 服务端要写的

1. **学校档案**：`server/src/schools/<id>/profile.ts`，导出一份 `SchoolProfile`，在 `schools/registry.ts` 的 `BUILTIN_SCHOOLS` 里登记。
   - `id`、`name`、`shortName`（小组件标题用「<shortName>课表」）、`brandName`（站内品牌名，例如「南医拾间」）。
   - `ssoLogin`：有统一认证就填 `true`；填 `false` 时网页和原生登录页只给站内账号登录。
   - `defaultPeriods`：本校完整作息，第 1 节起连续编号，几节都可以（上限 20 节）。教务接口没给作息或只给了一部分时，用它补全。
   - `enabled: false`：首次启动写入 School 表时不开放，由平台管理员在后台打开。
2. **学校驱动**：`server/src/schools/<id>/schoolDriver.ts`，导出一个 `SchoolDriver`（接口定义在 `schools/drivers.ts`），并加进 `SCHOOL_DRIVERS`。
   - `ownsToken`：本校的教务令牌和登录 pendingId 都带本校前缀，靠它认出属于哪所学校。
   - `academic`：教务查询，函数签名和返回值跟 `services/jwxtFacade` 一致（课表、校历、成绩、考试等）。校历的 `periods` 给教务里的作息。
   - `beginLogin` / `submitLogin`：统一认证登录。要验证码时返回 `needCaptcha` 和验证码图片。
   - `mfa`（可选）：新设备要扫码确认时填。`guide.app` 写用来扫码的 App 名称、安卓包名、iOS URL Scheme；原生登录页会显示「保存二维码并打开 <App>」。不填 `app` 时，登录页只显示二维码和通用说明。
   - `library`（可选）：图书馆借阅。
   - `forgetAccount`（可选）：删除账号时，清掉本校为这个学号保存的设备凭据等数据。
3. **模块**：在 `schools/catalog.ts` 里，给本校已经实现的模块的 `implementedFor` 加上学校 `id`。

## 不用改的

- **作息**：`services/scheduleData.ts` 用本校的 `defaultPeriods` 补全每份校历的作息表。网页课表、原生课表、桌面小组件和服务端小组件都按这一份画节次，不会混进药大的时间。
- **登录**：原生登录页的学校列表来自 `/api/schools`，选中的学校写进 `cpu-school-choice`。之后的统一认证请求通过 `X-CPU-School` 发往该校，验证码、扫码验证、品牌名都由服务端给。
- **原生壳**：三端只认网页桥接（`web/src/utils/iosNextScheduleBridge.ts`、`nativeLoginSchools.ts`）的通用字段，没有任何按学校名写的分支。

## 检查

- `server/tests/schoolDrivers.test.ts` 会检查：每所内置学校（药大除外）都在 `SCHOOL_DRIVERS` 里有驱动，且驱动的 `schoolId` 和档案一致。
- 上线前用本地数据库把登录、课表、小组件各跑一遍。
