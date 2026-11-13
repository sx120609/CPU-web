# iOS 4.21 release

4.20 (83) is 可分发 in App Store Connect as of 2026-11-13, so its train is closed and this build is 4.21. An upload of the same code as 4.20 (84) went through the whole transfer and was then refused: 「The train version '4.20' is closed for new build submissions」.

## Build 84

Archived on 2026-11-13 with Xcode 27.1 from `93600fdf` plus the version bump; all four targets carry 4.21 (84) and the app's device family is iPhone and iPad. `check-legacy-linkage.py` passed (52 app and 7 widget ActivityKit imports are weak). The archive is `~/Library/Developer/Xcode/Archives/2026-11-13/CpuTime-4.21-84.xcarchive`; the refused `CpuTime-4.20-84.xcarchive` beside it is of no further use.

The command-line upload failed again with 「App Store Connect access for “34T668D87P” is required」. From Xcode's Organizer the first attempt (of the 4.20 archive) answered 「Unable to authenticate with App Store Connect」 and the retry a minute later went through; the 4.21 archive uploaded on its first attempt: 「CpuTime 4.21 (84) uploaded」.

Since 4.20 (83) it carries:
- Widgets (`350e5e1c`, `4cad29b6`): a text size setting, switches for the week number, breaks, progress and finished classes, a live countdown from an hour before class and a progress bar during it on the home and lock screens, a 本周课表 widget, the two-day widget at the iPad's extra-large size, the user's priorities when courses overlap, and a live preview pinned to the top of the widget settings.
- Live Activities (`4cad29b6`): 「上课时收起」 and 「日程也显示实时活动」. Both switches stay hidden until the server advertises the new channels, and the server has not been deployed with them.
- 自由时间课程 under 更多 (`4cad29b6`), which also needs the server's `unscheduled` list.
- The couple timetable (`4a9072b2`, `d218ca29`): the strip no longer rebuilds every day on each slide, the week view can be 并排 or 合并, and a 「课表怎么用」 guide opens once and stays under 更多.
- 简约 course cards on today's column get a deeper fill and a border, so they no longer blend into the day's band (`4cad29b6`).

## Checking

Each batch was built for Debug and Release and checked with the widget gallery exports, the check scripts under `ios_next/scripts`, `node --test ios_next/tests/*.mjs` and `swift test --package-path ios_next` before it was pushed.

Not exercised: this archive on a device or simulator, a widget on a real home screen (timers and text scaling included), Live Activities against real APNs with the new channels, the couple strip's frame rate and the merged view on a device, the guide's first presentation with a real account, and 自由时间课程 with a real account.

## App Store

4.21 was created in App Store Connect on 2026-11-13 with build 84 and submitted at about 13:58; it is 正在等待审核, set to release automatically. 「此版本的新增内容」, as the user approved it:

> · 新增「本周课表」小组件；两日课表小组件支持 iPad 超大尺寸。
> · 小组件可调文字大小，可选择是否显示周次、课间、上课进度，以及是否隐藏已上完的课；设置页顶部可实时预览效果。
> · 临近上课时，桌面和锁屏小组件显示实时倒计时，上课中显示进度。
> · 情侣课表和叠加课表的周视图可选「并排」或「合并」，翻页更流畅。
> · 新增「课表怎么用」使用指引。
> · 修复「简约」风格下当天课程与当天色带颜色重合、看不清的问题。

The export compliance answer for build 84 is 「不属于上述的任意一种算法」, chosen with the user's authorization. The review notes' first line now describes this release; the other lines are unchanged:

> 本次更新：新增本周课表小组件，小组件支持文字大小等显示设置和实时倒计时；情侣课表和叠加课表的周视图可选并排或合并；新增课表使用指引；若干界面修复。

The 「协议更新」 answer that blocked 4.20's submission on 2026-11-12 did not come up.

### Withdrawn the same afternoon

At about 14:25 a student at 南京中医药大学 showed a Live Activity announcing their 14:00 class for 14:25: the server timed every school by the default school's bells. The user asked for that to be fixed before anything ships, so the submission was cancelled at about 14:30 (the version reads 被开发者拒绝, the submission 已移除); build 84 was never reviewed.

The fix is mostly the server's (each school's activities follow its own table, see `docs/live-activity-v2-implementation.md`), and reaches installed versions once the server is deployed. The app's part, declaring the timetable's own bells and not carrying one account's timing to the next, is not in build 84: 4.21 needs a new build before it is submitted again.
