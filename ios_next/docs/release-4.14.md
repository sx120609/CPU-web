# iOS 4.14 (71)

Release base: remote main `f62f84ad`. Compared with 4.13 (67), the iOS changes are in `1fc48c55`, with the server and Web side in `a9d92248`:

- Six timetable styles: classic (the look until now, still the default) plus minimal, grid, table, paper and board, across the week, day and month views and the share image. A now indicator, and weekend days with classes stay visible when weekends are hidden.
- Tapping a course opens a quick look; its edit button opens the editor. Week export to an `.ics` file is back. Both had been removed in 4.13 (`f01c2cfc`) and are restored on purpose.
- The course editor takes several meeting times per course and periods that are not consecutive.
- A course that overlaps others can be set to show first. The Live Activity takes the same answer.
- Shared timetables (更多 → 共享课表): publish, update and revoke a share code; import a code after a preview; open it read-only; care about one so its classes join the Live Activity.
- Qingming by formula and safer published-holiday matching; the clipped top edge of the date header is fixed.
- The native timetable's dark appearance uses the neutral greys of the site's dark theme (`f62f84ad`) for the page, cells, borders and text, in place of the green-tinted ones. Course colours are unchanged: they stay on the palette shared with Web, Android and HarmonyOS, whose timetables still use the green-tinted dark background.
- The month view's list writes a one-period course as 第 9 节 rather than 第 9-9 节.

Build 70 adds, over build 69:

- **Taking a photo no longer ends the app.** The app's Info.plist had no purpose string for the camera, the microphone or adding to Photos. None of the three is requested by Swift code, so nothing failed to build, but iOS terminates an app that reaches one without its string: a web file picker offers 拍照或录像, and the share sheet offers 存储图像 for the timetable image and for pictures a page shares. The earlier client (`ios/`) declared all three; they were lost in the rewrite. All three are declared again.
- **Files a page saves are downloaded.** A link with a `download` attribute, a response the web view cannot display and an attachment response used to replace the app's page with the file or do nothing. They now become WKWebView downloads and end in the share sheet (`WebFileDownloader`), in the native shell and in the iOS 15–16 wrapper. Only the site's own addresses and the `blob:` / `data:` URLs its pages build are taken; a file on another host still opens in Safari.
- **The Live Activity refresh task can be scheduled.** `UIBackgroundModes` now lists `fetch`. Without it `BGTaskScheduler` rejected the request and the app swallowed the error, so the fallback that ends an expired Live Activity while the app is suspended never ran.
- From NapTable `6f1c9ea`: the day view's seven-day strip is drawn by each style as the header row of its own week view, with separate marks for the selected day and today (classic keeps its strip); the week and month titles follow the style's typeface; the board keeps its monospaced face for times and dates only, and its day rows carry the end time under the start time.

All four targets (iPhone app, iPhone widgets, Watch app and Watch widgets) use version 4.14, build 71. Builds 68 (from `708a806f`), 69 (from `97a0b63c`) and 70 (from `234bf66d`) were uploaded on 2026-10-07 and are superseded; 69 and 70 were each submitted for review and withdrawn for the build after them. The minimum versions remain iOS 15 for the main app, iOS 17 for its widgets and watchOS 10 for Watch targets.

## Server dependency

Two features need the server from `a9d92248`, which is on main but is deployed separately:

- Shared timetables call `GET /api/schedule-shares/mine`, `GET /:code/meta` and revoke without a write token. Against the older server the list of one's own codes stays empty, every publish makes a new code, and revoking fails. Importing and reading a share still work: when `/meta` answers 404 the app asks for the share itself before calling it revoked.
- Display priority is saved in a new `priority` field of the schedule edits. The older server drops the field, so the switch in the editor appears not to stick.

The rest of 4.14 works against the older server. Deploy the server before this version reaches users.

Three places on the site revoked a `blob:` URL in the same tick as the click that downloads it (the file collection's `saveBlob`, the questionnaire CSV export, the QQ bot admin export). WebKit has not read the blob by then and the download fails, which build 70 reports as 文件没有下载下来. They now revoke after 30 seconds; that fix reaches users with the next Web deployment, not with the app.

## Validation on 2026-10-07

- Signed generic iOS Release archive succeeded, including all four targets.
- Archive code signature verified; all four bundles carry 4.14 (69). ActivityKit runtime import inspection: all 53 app imports and 7 widget imports are weak. Both calendar purpose strings are present.
- iOS Node suite: 57/57; Swift package: 24/24; server and Web Node suites: 822 passed, 4 skipped (the PostgreSQL integration tests).
- Native schedule store, period, palette (32 comparisons), Chinese calendar, course arrangement, display priority, shared timetable and Live Activity checks passed. The Live Activity check covers priority and the cared timetable.
- `scheduleSharing.integration.test.ts` passed against a local PostgreSQL 16.
- iOS 26.5 simulator, Debug build on the sample timetable: the six styles in the three views, light and dark; course quick look and editor; overlap priority; the sharing page and the read-only timetable.
- The same build against a local server and PostgreSQL, driven by the debug launch actions rather than taps: publish a code, reject one's own code, import from a pasted link, open read-only, pick up the publisher's update, mark the publisher's revoke.
- Build 70, iOS 26.5 simulator: the day strip in all six styles in light, and in the five new styles in dark with a day other than today selected; week views of board, table, paper and grid and the board month view.
- Build 70, against the local server with a script injected by the dev server: a `blob:` download, a same-origin `<a download>` and a navigation to a ZIP each ended in the share sheet with the page left in place; a `blob:` URL revoked at once ended in the failure alert.
- The built app's Info.plist carries the five purpose strings and `UIBackgroundModes = fetch`; `check-legacy-linkage.py` now requires them in the archive.

Not verified:

- The camera cannot be exercised in the simulator, which has none: that the app survives 拍照 rests on the purpose strings being in the built Info.plist. Whether iOS now runs the refresh task was not observed either.
- No physical device run. Requests through the signed-in web session (`NativeScheduleWebViewLoader.api`, the same channel the schedule edits use), saving a priority from the editor, and the Live Activity as it appears on screen were not exercised.
- No run on iOS 15–17 for this binary; see ios-compatibility-qa.md for the earlier scope.
- The simulator used for these runs was removed afterwards.

The delivery report records the exported IPA, exact pushed SHA and GitHub artifact verification. Git push does not submit App Store review or deploy the website.

## Build 71: course notes

Build 71 adds one fix over build 70, from `b256dc1b`. That commit was written on a machine without a Swift toolchain; it compiled unchanged on the Mac.

The timetable replaced a course's note with the period label of its merged block (「06-07节」). The quick look showed that label as 备注, the editor loaded it into the note field, and saving wrote it over the note the course had. The calendar import wrote it into the event notes as well.

- `NativeScheduleCourse.sourceNote` keeps the note a course arrived with when `NativeScheduleCourseBlockMerger` replaces `slotNote` with the period label. It is not encoded, so caches, shared timetables and saved edits are unchanged.
- `NativeScheduleCourse.editableNote` is the note a person wrote: neither the academic system's 「06-07节」 nor the 「第 6-7 节」 that a save with an empty note stores. The quick look, the editor's note field and the calendar import read it. The same rule as `noteFromCourse` on the Web, `editableNote` on Android and `scheduleCourseNote` on HarmonyOS.
- The card on the timetable still shows the period label, and the ICS export still writes it into the description.

A note that was already overwritten cannot be restored: the label is what was stored.

Validation of build 71 on 2026-10-07:

- `NativeScheduleStoreChecks` passed with its new cases: a merged block keeps the note it arrived with, a generated label is not a note, and the encoded course carries no `sourceNote`. The period checks, the Swift package (24/24), the palette, calendar, arrangement, priority, shared timetable and Live Activity checks and the iOS Node suite (57/57) passed.
- iOS 26.5 simulator, Debug build on the sample timetable: a course without a note shows no 备注 row in the quick look and an empty note field in the editor; with `CPU_DEBUG_SCHEDULE_NOTE=带实验报告` both show that note.
- Not exercised: saving from the editor against a live server, the calendar import, and a physical device.

## After build 71 (in no build yet)

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
