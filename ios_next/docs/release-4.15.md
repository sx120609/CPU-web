# iOS 4.15 (72)

Build 72 is a TestFlight build for internal testing, uploaded on 2026-10-08 while 4.14 (71) waits for App Review. It is not submitted for review. All four targets use version 4.15, build 72.

Compared with 4.14 (71): the week-view display settings (`59cdf725`), the month view's vertical swipe and one load bar per day (`779bd137`), and the acceptance fixes and launch-time changes below (`4f611f03`).

The month view compiled unchanged on the Mac and its bars were looked at in classic, grid and paper in the simulator. The vertical swipe was not exercised: the simulator could not be driven with gestures in this setup.

### Week-view display settings (`59cdf725`)

Written without a Swift toolchain; compiled unchanged on the Mac on 2026-10-08. `NativeScheduleBackgroundChecks` and the other Swift checks, the Swift package (24/24) and the iOS Node suite (57/57) passed.

iOS 26.5 simulator, sample timetable, settings passed as typed launch arguments (`-nativeSchedule.rowHeight '<real>150</real>'`, `-nativeSchedule.sundayFirst '<true/>'`): row height 70 / 100 / 130 / 150, text size small / standard / large, teacher on week cards, period times off, back-to-this-week off, Saturday and Sunday switches, Sunday first — in classic, and a sample of them in minimal, grid, table, paper and board. Two defects found there and fixed:

- Classic put the teacher after the room on one line, and a week column is too narrow for both: the name was cut to 「李…」. The teacher is on a line of its own.
- Classic's period axis needs about 42pt for the number and both times. At a row height of 70% the labels ran into each other. A short row keeps the start time; a very short one the number alone.

Not exercised: 显示本周不上的课 (the sample timetable has one week), the settings page itself (the controls were not tapped; values were injected), and a physical device.

### Launch reports from 4.13 (67)

The admin page's crash groups for 2026-10-06/07, symbolicated with the 4.13 (67) dSYM:

- Three hangs of 1.2 to 3 seconds: the main thread inside `Activity.request`, called from `NativeLiveActivityController.reconcile` — a synchronous call to a system service, once per course of the coming week, back to back. The loop now yields to the main run loop after each request.
- Five launch watchdog kills (`0x8BADF00D`, scene-create), each caught at a different place: UIKit creating the scene, SwiftUI laying out, the accessibility settings loader, `NWPathMonitor()` in `HybridWebViewStore.init`, `ScheduleEnvelope.decode` under `PhoneWatchScheduleStore.init`, and `Activity.request` again. No single cause shows; four of the five are on iOS 27.0 / 27.0.1. The network monitor is now created off the main thread. The Watch store's decode at launch is unchanged.

Neither change has been observed on a device, and the reports cannot be reproduced in the simulator: whether they become rarer is to be read from the same admin page after a build with these changes ships.
