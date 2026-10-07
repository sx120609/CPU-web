# iOS 4.14 (69)

Release base: remote main `f62f84ad`. Compared with 4.13 (67), the iOS changes are in `1fc48c55`, with the server and Web side in `a9d92248`:

- Six timetable styles: classic (the look until now, still the default) plus minimal, grid, table, paper and board, across the week, day and month views and the share image. A now indicator, and weekend days with classes stay visible when weekends are hidden.
- Tapping a course opens a quick look; its edit button opens the editor. Week export to an `.ics` file is back. Both had been removed in 4.13 (`f01c2cfc`) and are restored on purpose.
- The course editor takes several meeting times per course and periods that are not consecutive.
- A course that overlaps others can be set to show first. The Live Activity takes the same answer.
- Shared timetables (更多 → 共享课表): publish, update and revoke a share code; import a code after a preview; open it read-only; care about one so its classes join the Live Activity.
- Qingming by formula and safer published-holiday matching; the clipped top edge of the date header is fixed.
- The native timetable's dark appearance uses the neutral greys of the site's dark theme (`f62f84ad`) for the page, cells, borders and text, in place of the green-tinted ones. Course colours are unchanged: they stay on the palette shared with Web, Android and HarmonyOS, whose timetables still use the green-tinted dark background.
- The month view's list writes a one-period course as 第 9 节 rather than 第 9-9 节.

All four targets (iPhone app, iPhone widgets, Watch app and Watch widgets) use version 4.14, build 69. Build 68 was uploaded on 2026-10-07 from `708a806f` and is superseded: it lacks the last two items above. The minimum versions remain iOS 15 for the main app, iOS 17 for its widgets and watchOS 10 for Watch targets.

## Server dependency

Two features need the server from `a9d92248`, which is on main but is deployed separately:

- Shared timetables call `GET /api/schedule-shares/mine`, `GET /:code/meta` and revoke without a write token. Against the older server the list of one's own codes stays empty, every publish makes a new code, and revoking fails. Importing and reading a share still work: when `/meta` answers 404 the app asks for the share itself before calling it revoked.
- Display priority is saved in a new `priority` field of the schedule edits. The older server drops the field, so the switch in the editor appears not to stick.

The rest of 4.14 works against the older server. Deploy the server before this version reaches users.

## Validation on 2026-10-07

- Signed generic iOS Release archive succeeded, including all four targets.
- Archive code signature verified; all four bundles carry 4.14 (69). ActivityKit runtime import inspection: all 53 app imports and 7 widget imports are weak. Both calendar purpose strings are present.
- iOS Node suite: 53/53; Swift package: 24/24; server and Web Node suites: 822 passed, 4 skipped (the PostgreSQL integration tests).
- Native schedule store, period, palette (32 comparisons), Chinese calendar, course arrangement, display priority, shared timetable and Live Activity checks passed. The Live Activity check covers priority and the cared timetable.
- `scheduleSharing.integration.test.ts` passed against a local PostgreSQL 16.
- iOS 26.5 simulator, Debug build on the sample timetable: the six styles in the three views, light and dark; course quick look and editor; overlap priority; the sharing page and the read-only timetable.
- The same build against a local server and PostgreSQL, driven by the debug launch actions rather than taps: publish a code, reject one's own code, import from a pasted link, open read-only, pick up the publisher's update, mark the publisher's revoke.

Not verified:

- No physical device run. Requests through the signed-in web session (`NativeScheduleWebViewLoader.api`, the same channel the schedule edits use), saving a priority from the editor, and the Live Activity as it appears on screen were not exercised.
- No run on iOS 15–17 for this binary; see ios-compatibility-qa.md for the earlier scope.
- The simulator used for these runs was removed afterwards.

The delivery report records the exported IPA, exact pushed SHA and GitHub artifact verification. Git push does not submit App Store review or deploy the website.
