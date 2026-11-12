# iOS 4.20 release

4.19 (82) is 可分发 in App Store Connect as of 2026-11-12, so its train is closed and this build is 4.20. (The public lookup API still answered 4.18 that noon.)

## Build 83

Archived on 2026-11-12 with Xcode 27.1 from `16950ac4` plus the version bump; all four targets carry 4.20 (83) and the app's device family is iPhone and iPad. `check-legacy-linkage.py` passed (52 app and 7 widget ActivityKit imports are weak), and AlarmKit and AppIntents link weakly. The archive is `~/Library/Developer/Xcode/Archives/2026-11-12/CpuTime-4.20-83.xcarchive`.

The command-line upload failed again with 「App Store Connect access for “34T668D87P” is required」. It was uploaded from Xcode's Organizer on the first attempt: 「CpuTime 4.20 (83) uploaded」.

Since 4.19 (82) it carries:
- The iPad layout (`16950ac4`): one top bar with the tabs in it, week and month grids that fill the window, a side column beside the day view, 当天安排 beside the month in a wide window, long sheets as pages, a centred sign-in form and keyboard shortcuts. See `ipad.md`.
- 简约 as the timetable style: the default for users who never picked one (`ccc24f1b`), and a stored 经典 becomes 简约 once (`480b9ebd`).
- A prompt when a newer version is on the App Store, checked on every return to the foreground; the user agent carries the app's version (`122e3bc7`).
- Invite links no longer land on `/home/schedule` and 404 (`c9bd0044`).

## Checking

The iPad layout was checked in the iPad Pro 11-inch (iOS 27.0) and 13-inch (iOS 26.5) simulators before it was pushed, as `ipad.md` lists. After the rebase onto the commits above, the Debug build was run again on the 11-inch simulator, which by then was turned on its side: the 简约 week, month and day views in a real landscape window, with the one-row header and the side columns.

Not exercised: this archive on a device or simulator (the checks ran Debug builds of the same source), a physical iPad, a hardware keyboard, and iPadOS 17.

## App Store

Only the upload is done. Version 4.20 has not been created in App Store Connect, 「此版本的新增内容」 is not written, and nothing is submitted for review. Build 83 will ask for the export compliance answer (「不属于上述的任意一种算法」 for every build so far).
