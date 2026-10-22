# iPhone Duo

First written 2026-10-19 with Xcode 26.6 (17F113) on macOS 26.4. Updated
2026-10-22 with Xcode 27.1 (27A9275) on macOS 27.0.1 and the iOS 27.1
simulator runtime (24A94232), which includes the iPhone Duo.

The iPhone Duo folds. Closed, the app gets a 5.4-inch display; open, a
7.6-inch one, and the window changes size while the app runs. It goes on sale
on 2026-10-23 with iOS 27.1. Its hardware identifier is `iPhone19,4`
(simulator profile); the admin's client statistics name it 「iPhone Duo」.

## What the device does to an app

Sizes are in points, from Apple's 27.1 SDK as reported by developers who ran
the Duo simulator. They depend on the SDK the app is built with.

| Pose | Built with SDK 26.x (today) | Built with SDK 27.1 | Size classes (27.1) |
| --- | --- | --- | --- |
| Closed | 375×667 window, letterboxed | 466×678; an 84-point status column on the trailing edge leaves 382 for content | compact width, regular height |
| Closed, turned | 667×375 | 678×466 | compact, compact |
| Open | 375×667 | 951×669 | regular, regular |
| Open, turned | 375×667 | 669×951 | regular, regular |

- Only a build made with **Xcode 27.1 or later** (iOS 27.1 SDK) uses the whole
  screen. The iPhone Duo simulator comes with the iOS 27.1 runtime
  (`xcodebuild -downloadPlatform iOS -buildVersion 27.1`). 4.15 (73) was
  archived with Xcode 26.6, so on a Duo it runs in the phone-sized window.
- All four targets (app, widgets, Watch app, Watch widgets) build with
  Xcode 27.1 in Debug and Release without errors. The only new warning was
  the iOS 27 widget family `systemExtraLargePortrait` missing from the
  heartbeat's family names; it is named now. The app's widgets do not offer
  it.
- With the 27.1 SDK, system bars move into a vertical strip on the trailing
  edge, except in the open-turned pose. Only bars owned by system containers
  (`TabView`, `NavigationStack`, sheets) move. The app's `TabView` does;
  `NativeTopBar` is drawn by the app and stays a horizontal bar at the top.
- Safe-area insets are asymmetric: the status column is a trailing inset.
- A partly folded device reports a 40-point division over the fold through
  `GeometryProxy.reservedRegions(kind: .division)` and
  `UIView.reservedRegions(kind:)` (27.1 SDK only). The SDK also has
  `UIHingeInteraction` and SwiftUI's `onHingeChange` for the hinge's status
  and angle; the app does not need them.
- The Duo has Touch ID, not Face ID. The app does not use biometrics.

## Changes made for it

All but the last also apply to iPad and to iPhone landscape.

- **Course cards in narrow columns** (`NativeScheduleCourseCard.fitsFullLayout`).
  The classic week grid switched to its large card at 70-point columns, but the
  large card's 18-point name needs about 92 points. The open display held
  upright and the closed display turned give columns of about 80 points, where
  the classroom was cut to 「@教…」. The switch now follows the width a
  four-character name needs at the week-view text size. The other five styles
  were checked at 669×951 and were already fine.
- **Window size instead of `UIScreen.main`** (`WindowGeometry`). The two sheet
  height caps and the background preview's aspect ratio follow the window; the
  share image uses the view's `displayScale`.
- **The page's foot clearance follows the tab bar.** The injected CSS reserved
  96 px at the foot of every page for the floating tab bar. `ImmersiveWebView`
  now compares UIKit's bottom inset with the device's own: when the tab bar is
  not over the page (along the top on iPad, down the trailing edge on the Duo),
  it sets `data-cpu-foot-clear` and the clearance becomes the home indicator's
  height. The value is held while the keyboard is up, because SwiftUI lifts the
  page above the keyboard and that would read as the tab bar moving away.
  Pushed pages (`data-cpu-page-navigation`) still get 0.
- **Week and month grids step over the fold.** Partly folded with the fold
  running down the open display (the book pose), a day column across the fold
  would put its centred course names on the crease. The week grid becomes two
  grids, each with its own period axis, that meet at the fold
  (`foldPages` in `NativeScheduleView`); the month grid's rows leave the fold
  empty (`ScheduleFoldRow`). The days are divided where the narrower half's
  columns come out widest, the leading half taking the extra day on a tie:
  Monday–Thursday and Friday–Sunday in the week view, and in the classic month
  Monday–Wednesday, because its week-number column takes room on the leading
  half (`ScheduleFoldSplit`, checked by `check-fold-layout.sh`). A half too
  narrow for a 40-point column, or a fold across the view (the open display
  turned upright and partly folded), leaves the grid whole. All six styles.
  The other views were left as they are: the day view's wide cards keep their
  text at the leading edge, and the couple day view already puts its period
  axis in the middle, so the fold falls on the axis between the two people.

Already in place and unchanged: the web view and the schedule respect the
leading and trailing safe area, the week and day grids take their column width
from the space they are given, the iPhone supports both landscape orientations,
`UILaunchScreen` is generated, `UIRequiresFullScreen` is not set, and the app
uses the SwiftUI scene life cycle the iOS 27 SDK requires.

`ios_next/tests/iphone-duo.test.mjs` keeps the launch screen, orientations,
`UIScreen.main`, the foot-clearance rule and the fold-aware grids from
regressing.

## Checking it in the Duo simulator

The simulator app is now Device Hub (`Xcode.app/Contents/Applications`). Its
pose buttons fold, unfold and turn the Duo; nothing on the command line does.
`devicectl device orientation set` is reset to portrait at once while no
Device Hub window shows the device, and `simctl io … screenConfig power`
switches a display off without moving the app to the other one. What does
work from the command line:

```sh
# the closed display, as the device boots
SIMCTL_CHILD_CPU_DEBUG_MOCK_SCHEDULE=1 SIMCTL_CHILD_CPU_DEBUG_MOCK_TABS=1 \
  xcrun simctl launch --terminate-running-process <iPhone Duo> cn.cputime.mobile
xcrun simctl io <iPhone Duo> screenshot --display=primary closed.png    # inner display: primary-1
# any window size on the 27.1 runtime: moves the app to the resizable display
xcrun devicectl device appResize start --device <iPhone Duo> --preferred-size 951x669 &
xcrun devicectl device appResize set --device <iPhone Duo> --preferred-size 669x951
xcrun simctl io <iPhone Duo> screenshot --display=resizable open.png
```

Debug builds also accept `CPU_DEBUG_FOLD=455-495`, a stand-in fold over that
span of the window in points (the open display's middle 40 points), and
`CPU_DEBUG_SCHEDULE_VIEW=day` or `month` to open that view.

Checked on 2026-10-22, iOS 27.1 runtime, sample timetable, default text size:

- Closed display: the status column and the tab bar, as a vertical capsule,
  share the trailing strip; the week grid, the top bar and the welcome screen
  stay clear of it.
- Resizable display at 951×669, 669×951, 678×466 and 466×678, resized while the
  app ran: the week grid takes the width it is given; columns of about 85
  points use the compact card with the whole classroom. At 466×678 the tab bar
  moved to a trailing capsule there as well.
- `CPU_DEBUG_FOLD=455-495` at 951×669: the week grid in classic, table and
  board, the month grid in classic and grid, the day view and the couple day
  view, as described above. Without the fold, the month grid at 466×678 in
  classic and table is laid out as before.
- iPhone 17 Pro, iOS 26.5: week and month views unchanged.

Not checked yet: the real hinge (book and partly folded poses through Device
Hub), the inner display's own bars, sheets and the keyboard on the Duo, and
the web pages' foot clearance on the 27.1 runtime (it needs a signed-in
account).

## Checking it without the Duo simulator

Debug builds accept `CPU_DEBUG_CANVAS`, which lays the whole app out in a
window of a given size on a larger simulator (`DebugDisplayCanvas.swift`):

```sh
# closed: 466×678 with an 84-point trailing strip, compact width, regular height
SIMCTL_CHILD_CPU_DEBUG_MOCK_SCHEDULE=1 SIMCTL_CHILD_CPU_DEBUG_MOCK_TABS=1 \
SIMCTL_CHILD_CPU_DEBUG_CANVAS='466x678+84/CR' \
  xcrun simctl launch --terminate-running-process <iPad Pro 13-inch> cn.cputime.mobile
# fold and unfold every 6 seconds
SIMCTL_CHILD_CPU_DEBUG_CANVAS='466x678+84/CR,951x669/RR' SIMCTL_CHILD_CPU_DEBUG_CANVAS_INTERVAL=6 ...
```

The strip is an `additionalSafeAreaInsets` and the size classes are trait
overrides on a hosting controller, so the UIKit tab bar sees them too. It does
not reproduce the vertical bars, the fold or the camera, and sheets still
present at the simulator's own size.

Checked this way on the iPad Pro 13-inch (M5) simulator, iOS 26.5, default text
size:

- Week view in all six styles at 669×951; classic week view in all four poses;
  day and month views closed and open.
- Folding and unfolding four times in a row: the week pager stayed on the
  current week and the layout followed each size.
- The real shell on the live site: the native top bar and the page stay clear
  of the trailing strip; the page's clearance was 96 px with the tab bar at the
  bottom (closed, closed turned) and 0 px with it along the top (open, open
  turned).

## Still to do

1. In Device Hub, go through closed turned, open, open turned, book and partly
   folded with the pose buttons: the tab bar as a trailing strip, the week and
   month grids stepping over the real fold (and back when the phone is
   opened flat), `NativeTopBar`, sheets, the keyboard, the page clearance, and
   a screen left open while the phone unfolds. The simulator cannot show the
   camera, StandBy or most extensions, so widgets and Live Activities need a
   device.
2. App Store Connect accepts iPhone Duo screenshots: outer display 1398×2034,
   inner display 2007×2853 (portrait), taken from the Duo simulator.
3. Ship a version built with Xcode 27.1; until then a Duo shows the
   phone-sized window.
