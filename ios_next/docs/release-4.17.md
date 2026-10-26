# iOS 4.17 (76)

Submitted for App Store review on 2026-10-26 from Chrome (App Store Connect): 正在等待审核, released automatically to all users once approved, ratings kept. 「此版本的新增内容」, as the user confirmed it:

> 修复灵动岛倒计时在长课程（超过 100 分钟）时显示不全的问题；在 iPhone Duo 上，灵动岛的倒计时改为分钟和秒分两行显示。

Build 76 was archived with Xcode 27.1 (iOS 27.1 SDK) from `53584564` and uploaded from the command line (`xcodebuild -exportArchive` with `destination: upload`, automatic signing, the Xcode account signed in). All four targets use version 4.17, build 76. Export compliance was answered 「不属于上述的任意一种算法」: the app only hashes with SHA-256 (CryptoKit) and uses the system's HTTPS.

## What changed since 4.16 (74)

The Live Activity countdown, in `086c2e19` and `f886dba8`:

- Every countdown had a fixed width (46 points at 14pt in the compact island, 48 in the paired rows, 88 at 25pt on the lock screen). With whole-course timing a two-period class starts at "100:00" and a four-period afternoon at about "215:00", which did not fit. Each countdown is now laid over a hidden text as long as its longest value (`countdownTemplate`). The compact island's logo is 24 points and its countdown 16pt; the expanded island's countdown 22pt.
- On the iPhone Duo the Dynamic Island stands upright in the status column, closed and open, and the compact trailing view is about 24 points wide: one line showed 「14:3」. Where iOS 27 reports `isDynamicIslandLimitedInWidth`, the countdown is two lines, the minutes above ":ss", each the same live timer cut down to its part.

Checked in the simulator (iOS 27.1 runtime) with the demo class (`CPU_DEBUG_SCHEDULE_ACTION=live-activity`, `CPU_DEBUG_LIVE_MINUTES`): the iPhone 17 Pro's compact island at 215 and 100 minutes; on the iPhone Duo, with Device Hub's poses pressed by hand, the compact island closed, open and in the book pose, the expanded card, and the lock screen open and closed. See [iPhone Duo](iphone-duo.md). `check-live-activity.sh` and the iOS Node suite (69/69) passed. Not exercised: the paired (couple) rows in the expanded island on the Duo, and a physical device.

## Builds before 76

- 4.16 (74) is 可分发. It was not uploaded from this record: the only 4.16 (74) archive on this Mac was made on 2026-10-23 from `8960d9af` (日程, course custom times, the dorm timetable entry and the Duo's whole screen) and was deleted on 2026-10-26, so its dSYMs are on App Store Connect only.
- 4.16 (75) was refused on upload (the 4.16 train had closed after approval).
- 4.17 (75), from `f5e4f3b8`, has the fixed widths but not the Duo's two lines; it is superseded by 76 and was not submitted.
