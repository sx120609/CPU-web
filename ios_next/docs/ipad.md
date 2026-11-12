# iPad

Written 2026-11-12 with Xcode 27.1 on the iPad Pro 11-inch (M5) simulator
(iOS 27.0) and the iPad Pro 13-inch (M5) simulator (iOS 26.5).

The app has always been built for iPad (`TARGETED_DEVICE_FAMILY = "1,2"`, all
four orientations, no `UIRequiresFullScreen`), but it was the phone's layout
on a larger screen: the week ended two thirds of the way down, the day view
stretched one card across the whole width, sheets opened as small forms that
cut their lists off, and two bars were stacked above every web page. This is
what changed. A phone, and a narrow iPad window, are laid out as before.

## What decides the layout

Nothing here asks which model the device is. The timetable follows the size
of the window it is given (`SchedulePadLayout`), so Split View, Slide Over and
Stage Manager windows get whichever layout fits them.

| Rule | Condition |
| --- | --- |
| Rows stretch to fill the height | width and height both regular, and the grid shorter than the window |
| Side column beside the day view | regular width and at least 760 points of content |
| 当天安排 beside the month, one-row header | regular width and at least 960 points of content |
| Tabs in the top bar | iPad and regular width |

The last one is the exception, and it does ask for an iPad: on an unfolded
iPhone Duo, which is also regular in width, the system moves its own bars to
the trailing edge, and that is left alone (see `iphone-duo.md`).

## The shell

`NativeShellView` stacked the app's own top bar (logo, appearance, refresh,
notifications, 更多) on the system tab bar, which iPadOS 18 and later draw
along the top: two rows before any content. On an iPad wide enough,
`NativePadChrome` puts the five tabs in the middle of the top bar
(`NativePadTabStrip`) and hides the system tab bar on every tab.

- The timetable tab shows this bar too, since it is where the tabs are; its
  refresh button reloads the timetable instead of a web page. On a phone the
  timetable still has no top bar.
- Pages with their own navigation (a forum topic, 投稿, VoiceHub) still take
  the whole window, with no bar at all, as on a phone.
- A window that becomes compact (Slide Over, a narrow split) gets the phone's
  shell back, tab bar at the foot, and the merged bar again when it widens.
- The web pages themselves are the site's: their width and columns come from
  the site's CSS, not from the app.

## The timetable

- **Week.** The rows share the height left under the header, never shorter
  than the row height chosen in the display settings and never more than 2.4
  times it. All six styles, and the two-columns-a-day strip while somebody
  else's timetable is laid on top. A share image is still drawn at the chosen
  height, whatever the window is.
- **Day.** The day keeps the leading column. Beside it stand a small month
  (`ScheduleMiniMonth`: a dot under days with classes, an orange one for 日程
  not yet done, any day of the term opens with a tap) and the day's summary
  and 日程, which no longer sit above the grid. The classic style's rows fill
  the height as the week's do; the other styles' day views size their own
  cards and are left as they are.
- **Month.** The rows share the height, cells list as many course names as
  fit (a phone lists three) in a larger size, and in a wide window 当天安排
  stands beside the calendar instead of under it.
- **Header.** From 960 points of content the term, the week navigator and
  the view controls are one row; a landscape iPad is short of height, not
  width.

## Sheets, sign-in, keyboard

- Sheets with a long list or an editor (更多, 宿舍课表, 共享课表, 情侣课表,
  日程, the course editor, 调整这一次, Apple 日历, 课表风格, the background
  editor, 找共同空闲, the device settings, 拾间 AI) are presented as pages
  (`padPageSheet`, iOS 18 and later). The course quick look, the week picker,
  the overlay picker and the change notice keep their small sheets.
- The sign-in form sits in the middle of a tall window instead of against its
  top edge.
- With a keyboard: ⌘1–⌘5 pick a tab, ⌘← and ⌘→ turn the week or month, ⌘T
  goes back to today, ⌘R refreshes. Buttons in the bars highlight under a
  pointer.

## Checking it

```sh
bash ios_next/scripts/check-pad-layout.sh          # the arithmetic
node --test ios_next/tests/ipad.test.mjs           # the wiring
# the sample timetable inside the shell's chrome
SIMCTL_CHILD_CPU_DEBUG_MOCK_SCHEDULE=1 SIMCTL_CHILD_CPU_DEBUG_MOCK_TABS=1 \
SIMCTL_CHILD_CPU_DEBUG_BELLS=school SIMCTL_CHILD_CPU_DEBUG_VISUAL_SCHEDULE=1 \
SIMCTL_CHILD_CPU_DEBUG_SCHEDULE_VIEW=day SIMCTL_CHILD_CPU_DEBUG_AGENDA=1 \
  xcrun simctl launch --terminate-running-process <iPad> cn.cputime.mobile
```

The simulator cannot be turned from the command line. A landscape-shaped
window is `CPU_DEBUG_CANVAS='1032x760/RR'` on the 13-inch iPad (see
`iphone-duo.md` for the canvas), and `507x1300/CR` is a compact split.

Checked on 2026-11-12, sample timetable and a signed-in session on the live
site:

- iPad Pro 11-inch upright, light: week, day and month fill the screen; the
  merged bar; 更多, 宿舍课表 and the course editor as pages; the sign-in form
  centred.
- iPad Pro 13-inch upright, dark, the system at an accessibility text size
  (the app stops at the largest standard one): week, month
  beside 当天安排, the overlay strip in the grid style, a shared timetable
  opened read-only, and the home and profile pages under the merged bar.
- 1032×760 canvas: one-row header, week, day beside the small month (also
  bound to a partner), the paper style's month, and the services page.
- 507×1300 compact canvas and iPhone 17 Pro: the phone layout, unchanged.
- The canvas alternating between 507×1300 and 1032×760 every six seconds on
  the signed-in shell: each size got its own shell and month layout, twice.
- 951×669 canvas (an unfolded Duo's size): the day view with its side column.

Not checked: a real device, the device turned (only the canvas), Split View
and Stage Manager windows resized by hand, iPadOS 17 (its tab bar is at the
foot; the merged bar replaces it the same way but no runtime was installed),
a hardware keyboard and a pointer, and the window controls iPadOS 26 draws
at the top leading corner of a windowed app, which may sit over the logo.
