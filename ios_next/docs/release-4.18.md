# iOS 4.18 (78)

Submitted for App Store review on 2026-11-07 from Chrome (App Store Connect) together with the five sponsorship in-app purchases, six items in one submission: 正在等待审核. Version 4.18 was created that day after 4.17 (77) became 可分发. Release settings are unchanged: released automatically to all users once approved, ratings kept. 「此版本的新增内容」, as the user chose it:

> · 登录时可以选择学校，南京医科大学、南京中医药大学的同学也能使用；需要扫码验证的学校可直接在 App 内完成验证。
> · 课表、小组件和灵动岛按各校的节次显示。
> · 新增 App 内赞助：在「我的」页点「支持拾间」，赞助后开通 VIP 并获得 AI 点数。
> · 修复课程修改后与原课程同时显示、日程在课表中的显示样式、首次启动卡在启动画面，以及教务登录过期后反复提示授权的问题。

The App Review notes were rewritten for this version: the school choice on the login page (the review account belongs to 中国药科大学), the sponsorship entry (「我的」 → 「支持拾间」 → 「去赞助」), that sponsorship uses five consumable in-app purchases (¥6–¥128) that grant VIP and AI points, sandbox purchases included, and that the app offers no outside payment.

Build 78 was archived with Xcode 27.1 from `925e6fb1` plus the version bump; all four targets carry 4.18 (78). `check-legacy-linkage.py` passed (52 app and 7 widget ActivityKit imports are weak). The command-line upload failed with 「App Store Connect access for “34T668D87P” is required」, so the user uploaded it from Xcode's Organizer.

## In-app purchases

The five consumables `cn.cputime.mobile.sponsor.{6,18,30,68,128}` (Apple IDs 6831932378, 6831932726, 6831933293, 6831933695, 6831934585) were created in App Store Connect on 2026-11-07 and are submitted with this version: the first consumable has to go to review together with an app version. Each is added from its own page with 「添加以供审核」, which opens a menu; choose the existing 草稿提交, or nothing is added. Their review screenshot is the sponsorship sheet rendered with fixture data (`CPU_DEBUG_SPONSOR=mock`). App Store Server Notifications V2, production and sandbox, point at `https://cputime.cn/api/payments/apple/notifications`; the server side was deployed to production from `925e6fb1` on 2026-11-07 before this submission.

## What changed since 4.17 (77)

- Native login: school choice, QR scan verification (`nativeMfa`) and per-school period tables for the timetable, widgets and Live Activity (`aaedad00`, `a81898a2`, `925e6fb1`).
- Native sponsorship through StoreKit 2 (`74fb1f6d`); see the README section 「赞助（App Store 内购）」.
- `83b1667d`, `42b6448e`, `39228e37`, `450ce72a`: an edited course no longer shows beside its original, 日程 items are drawn in the timetable style, no frozen launch screen on a first start, and school login recovery without false re-authorization prompts.

Not exercised: a real sandbox purchase on a device, and a physical device in general.

## Rejected, then build 79

On 2026-11-09 App Review rejected 4.18 (78) under Guideline 2.1(a): on an iPad Pro 11-inch (M4) with iPadOS 27.2 the reviewer could not sign in because of a "server timeout". Their screenshot, taken at 06:04 Pacific (22:04 Beijing time), shows the login page reporting 「登录服务启动超时，请稍后重试。」. That was not the server. The day's afternoon outage was hours earlier, and the evening deployment of `a708e35b` began at 22:10.

The fault was in the app, and it hit every fresh install, on iPhone and iPad alike. Since `39228e37`, a first start without a session shows the login gate at once. The gate cancels any main-frame navigation to a path that is not a login page, and that included the web view's own first load of `/home`. The page therefore stayed on `about:blank` and the site app never started. Every native login call then waited 10 s for a bridge that could not appear. This was reproduced with fresh installs of a Release build on the iPad Pro 11-inch and iPhone 17 Pro simulators (iOS 27.0).

`b26fb3a4` fixes it in two ways:
- The gate now lets the web view's first load through. That is the load made while no history item exists yet.
- A login call that finds no page and no load in progress starts the login page.

After the fix, both simulators load the school list without an error.

Build 79 was archived from `93b638b1` plus that fix and the build-number bump; the agenda screenshot work on `main` is not in it. All targets carry 4.18 (79), and `check-legacy-linkage.py` passed (52 app and 7 widget ActivityKit imports are weak). The command-line upload failed again with 「App Store Connect access … is required」, so it was uploaded from Xcode's Organizer.

Not exercised: a full sign-in with the review account, and a physical device.
