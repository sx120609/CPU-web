# iOS 4.19 release

4.18 (81) was approved before this work reached App Store Connect, so the changes ship as 4.19. An upload of the same code as 4.18 (82) was rejected by App Store Connect: 「The train version '4.18' is closed for new build submissions」.

## Build 82

Archived on 2026-11-11 with Xcode 27.1 from `932d86c1`; every target carries 4.19 (82). `check-legacy-linkage.py` passed (52 app and 7 widget ActivityKit imports are weak), and AlarmKit and AppIntents link weakly. Uploaded from Xcode's Organizer on the first attempt.

Since 4.18 (81) it carries:
- A native 宿舍课表 (`NativeDorm*.swift`): 一周, 空闲, 早八 and 宿舍 pages, with the web's free-time rules ported to `NativeDormRules.swift`; invite links and the web route open it instead of the web page. See `docs/dorm-schedule.md`.
- NapTable's overlay layout: with the 情侣课表 on or a shared timetable laid over, the week view becomes a strip of days side by side, the user's courses and the other person's in two columns per day (`ScheduleOverlayStrip.swift`). Overlapping courses in a half-width column are one card with a 「+N」 badge.
- NapTable's widgets: the timetable widgets follow the timetable style, every size and the lock screen are covered, and a new 日程 widget ticks items off on the home screen (stored locally until the app is next opened and signed in). A Debug-only gallery draws all of them (`CPU_DEBUG_WIDGET_GALLERY=1`).
- Layout fixes found by hand on the simulator: 更多 opens full height; the month view changes month only sideways; text stops at the largest standard size, sheets included (`NativeTextSizeLimit`); 叠加到我的课表's explanation no longer loses its line ends; 日程 at the same time as a class is a thin bar on the class's border instead of a titled strip over its name; dorm cell details open full height.
- Server: 截图识别 turns line breaks the model escaped twice back into real ones (`agendaExtract.ts`). The site was deployed from `932d86c1` (the verified CI artifact) on 2026-11-11.

## Checking

The changes were tried on the iPhone 17 Pro simulator with real taps and swipes through AXe (`~/Tools/axe/axe`), besides the debug launch switches: every 更多 entry, the dorm pages and cell details, the overlay strip across a week boundary both ways, course previews on both sides of the strip, the month view's swipes. Screenshots were also taken on an iPhone SE, in dark mode and at the largest text size.

Found that way and fixed before the build: swiping the overlay strip from Sunday into the next Monday jumped back to the old week's Monday; two overlapping courses split a strip column into one-character slivers; 日程 chips covered course names.

Not exercised: a widget on a real home screen (the iOS 27.0 simulator's Shortcuts service crashes, so any AppIntent widget there, the 4.18 one included, stays a placeholder), the dorm against the real `/api/dorm`, and a physical device.

## App Store

「此版本的新增内容」, as the user approved it:

> · 宿舍课表改为原生页面：一周谁有空、空闲时段、早八名单和宿舍管理都更快更顺手。
> · 情侣课表和叠加同学课表时，周视图改为几天并排的双栏，左边是你、右边是 TA。
> · 小组件跟随课表风格并补齐各尺寸和锁屏样式；新增日程小组件，可在桌面直接勾选完成。
> · 「更多」改为全屏展示；月视图统一左右滑动换月；与课程同时段的日程不再遮挡课程名。
> · 修复系统大字号下部分页面文字过大、被截断，以及截图识别的日程备注里出现多余符号的问题。

The 4.19 version has not been created or submitted in App Store Connect yet: the browser session there had signed out, and the user chose to do that step later.
