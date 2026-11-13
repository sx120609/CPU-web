package cn.lizmt.cpuweb.schedule;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;

import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

/**
 * What the widgets took from iOS 350e5e1c: 文字大小, the countdown and progress of a class,
 * 隐藏已上完的课, the next day's preview and the settings behind them. The drawings are also
 * saved to build/reports/widget-previews/parity/ to be looked at.
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35, manifest = Config.NONE)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class ScheduleWidgetLiveOptionsTest {
    private static final ScheduleWidgetProvider.WidgetMode COMPACT = ScheduleWidgetProvider.WidgetMode.COMPACT;
    private static final ScheduleWidgetProvider.WidgetMode WIDE = ScheduleWidgetProvider.WidgetMode.WIDE;
    private static final ScheduleWidgetProvider.WidgetMode TODAY_WIDE = ScheduleWidgetProvider.WidgetMode.TODAY_WIDE;
    private static final ScheduleWidgetProvider.WidgetMode TODAY_LARGE = ScheduleWidgetProvider.WidgetMode.TODAY_LARGE;
    private static final ScheduleWidgetProvider.WidgetMode TWO_DAY = ScheduleWidgetProvider.WidgetMode.LARGE;
    /** Wednesday of week 10: 药物化学 08:00–09:40 and 生物化学 14:00–15:40. */
    private static final String WEDNESDAY = "2026-11-11";
    /** Monday: five classes. */
    private static final String MONDAY = "2026-11-09";
    /** Friday: two classes in the morning, then nothing until Monday. */
    private static final String FRIDAY = "2026-11-13";

    @Before
    public void useOfflineHolidays() {
        ChineseCalendarInfo.usePublishedHolidays(new ArrayList<>());
    }

    @After
    public void resetHolidays() {
        ChineseCalendarInfo.usePublishedHolidays(new ArrayList<>());
    }

    // MARK: settings

    @Test
    public void settingsFromAnOlderVersionReadAsTheDefaults() {
        ScheduleWidgetDisplay display = ScheduleWidgetDisplay.decode("{}");
        assertEquals("standard", display.textSize);
        assertTrue(display.showWeek);
        assertTrue(display.showBreaks);
        assertTrue(display.showProgress);
        assertFalse(display.hideCompleted);
        assertTrue(display.holidayAlwaysVisible);
        assertEquals("standard", ScheduleWidgetDisplay.decode(null).textSize);
        assertEquals("standard", ScheduleWidgetDisplay.decode("not json").textSize);
        // A size written by a later version is the standard size; the rest of the settings stay.
        ScheduleWidgetDisplay later = ScheduleWidgetDisplay.decode("{\"textSize\":\"huge\",\"hideCompleted\":true}");
        assertEquals("standard", later.textSize);
        assertTrue(later.hideCompleted);

        ScheduleWidgetDisplay changed = new ScheduleWidgetDisplay();
        changed.textSize = "auto";
        changed.showWeek = false;
        changed.showBreaks = false;
        changed.showProgress = false;
        changed.hideCompleted = true;
        changed.holidayAlwaysVisible = false;
        ScheduleWidgetDisplay read = ScheduleWidgetDisplay.decode(changed.encode());
        assertEquals("auto", read.textSize);
        assertFalse(read.showWeek);
        assertFalse(read.showBreaks);
        assertFalse(read.showProgress);
        assertTrue(read.hideCompleted);
        assertFalse(read.holidayAlwaysVisible);
    }

    @Test
    public void aWidgetFollowsTheAppsTextSizeUnlessItChoosesItsOwn() {
        // An instance saved before this version has no size of its own.
        ScheduleWidgetOptions options = ScheduleWidgetOptions.decode("{\"todayOnly\":true}", TODAY_LARGE);
        assertEquals("", options.textSize);
        assertArrayEquals(new float[]{1f}, options.textScales(), 0f);
        options.display.textSize = "large";
        assertArrayEquals(new float[]{1.12f}, options.textScales(), 0f);
        options.textSize = "small";
        assertArrayEquals(new float[]{0.9f}, options.textScales(), 0f);
        ScheduleWidgetOptions own = ScheduleWidgetOptions.decode("{\"textSize\":\"auto\"}", COMPACT);
        // 自适应 ends at the standard size.
        assertArrayEquals(new float[]{1.16f, 1.08f, 1f}, own.textScales(), 0f);
        assertEquals("standard", ScheduleWidgetOptions.decode("{\"textSize\":\"huge\"}", COMPACT).textSize);
    }

    // MARK: countdown and progress

    @Test
    public void theCountdownRunsToTheEndOfAClassOrTheStartOfOneWithinTheHour() {
        int start = 14 * 60, end = 15 * 60 + 40;
        assertNull(ScheduleWidgetDisplay.countdownTarget(start, end, (12 * 60 + 59) * 60 + 59));
        ScheduleWidgetDisplay.Target lead = ScheduleWidgetDisplay.countdownTarget(start, end, 13 * 3600);
        assertEquals("距上课", lead.title);
        assertEquals(start * 60, lead.second);
        assertEquals("距上课", ScheduleWidgetDisplay.countdownTarget(start, end, (13 * 60 + 35) * 60).title);
        ScheduleWidgetDisplay.Target on = ScheduleWidgetDisplay.countdownTarget(start, end, start * 60);
        assertEquals("距下课", on.title);
        assertEquals(end * 60, on.second);
        assertEquals("距下课", ScheduleWidgetDisplay.countdownTarget(start, end, end * 60 - 1).title);
        // The last minute still counts as the class, but there is nothing left to count.
        assertNull(ScheduleWidgetDisplay.countdownTarget(start, end, end * 60));
        assertNull(ScheduleWidgetDisplay.countdownTarget(start, end, end * 60 + 61));
        // A class without a time has neither.
        assertNull(ScheduleWidgetDisplay.countdownTarget(-1, -1, 13 * 3600));

        assertEquals(-1f, ScheduleWidgetDisplay.progress(start, end, start * 60 - 1), 0f);
        assertEquals(0f, ScheduleWidgetDisplay.progress(start, end, start * 60), 0f);
        assertEquals(0.5f, ScheduleWidgetDisplay.progress(start, end, (14 * 60 + 50) * 60), 0.001f);
        assertEquals(1f, ScheduleWidgetDisplay.progress(start, end, end * 60 + 30), 0f);
        assertEquals(-1f, ScheduleWidgetDisplay.progress(start, end, (end + 1) * 60), 0f);

        assertEquals("23:10", ScheduleWidgetDisplay.clock(23 * 60 + 10));
        assertEquals("05:03", ScheduleWidgetDisplay.clock(5 * 60 + 3));
        assertEquals("1:05:00", ScheduleWidgetDisplay.clock(65 * 60));
        assertEquals("00:00", ScheduleWidgetDisplay.clockTemplate(3599));
        assertEquals("0:00:00", ScheduleWidgetDisplay.clockTemplate(3600));
    }

    @Test
    public void refreshesWhenTheCountdownAppearsAndEndsAndWhileAClassIsOn() throws Exception {
        JSONObject today = ScheduleWidgetProvider.dayForDate(payload(WEDNESDAY), WEDNESDAY);
        ScheduleWidgetDisplay display = new ScheduleWidgetDisplay();
        // An hour before the afternoon class: 距上课 appears.
        assertEquals(at(WEDNESDAY, 13, 0), ScheduleWidgetProvider.nextRefreshAt(today, at(WEDNESDAY, 12, 45), display));
        // Every five minutes while the class is on, for the progress bar.
        assertEquals(at(WEDNESDAY, 14, 7), ScheduleWidgetProvider.nextRefreshAt(today, at(WEDNESDAY, 14, 2), display));
        // The minute after the end, when the class leaves the list, as before.
        assertEquals(at(WEDNESDAY, 15, 41), ScheduleWidgetProvider.nextRefreshAt(today, at(WEDNESDAY, 15, 40), display));
        // Off: only the boundaries, as before.
        display.showProgress = false;
        assertEquals(at(WEDNESDAY, 13, 15), ScheduleWidgetProvider.nextRefreshAt(today, at(WEDNESDAY, 12, 45), display));
        assertEquals(at(WEDNESDAY, 14, 1), ScheduleWidgetProvider.nextRefreshAt(today, at(WEDNESDAY, 13, 45), display));
        assertEquals(at(WEDNESDAY, 14, 32), ScheduleWidgetProvider.nextRefreshAt(today, at(WEDNESDAY, 14, 2), display));
        assertEquals(ScheduleWidgetProvider.nextRefreshAt(today, at(WEDNESDAY, 13, 45)),
                ScheduleWidgetProvider.nextRefreshAt(today, at(WEDNESDAY, 13, 45), display));
    }

    @Test
    public void closesInOnTheMomentTheCountdownRunsOut() throws Exception {
        JSONObject today = ScheduleWidgetProvider.dayForDate(payload(WEDNESDAY), WEDNESDAY);
        ScheduleWidgetDisplay display = new ScheduleWidgetDisplay();
        long start = at(WEDNESDAY, 14, 0), end = at(WEDNESDAY, 15, 40);
        // No countdown is running at noon, or after the last class.
        assertEquals(Long.MAX_VALUE, ScheduleWidgetProvider.countdownStepAt(today, at(WEDNESDAY, 12, 0), display));
        assertEquals(Long.MAX_VALUE, ScheduleWidgetProvider.countdownStepAt(today, at(WEDNESDAY, 16, 0), display));
        // 距上课 with 15 minutes to go: the next step is a little over half way there.
        long now = at(WEDNESDAY, 13, 45);
        assertEquals(now + (long) (15 * 60_000L * 0.55), ScheduleWidgetProvider.countdownStepAt(today, now, display));
        // The system may deliver an alarm late by 0.75 of its distance: even then a step lands before the target.
        for (long current = at(WEDNESDAY, 13, 0); start - current > ScheduleWidgetProvider.COUNTDOWN_FINAL_MILLIS; ) {
            long step = ScheduleWidgetProvider.countdownStepAt(today, current, display);
            assertTrue(step > current);
            long latest = step + (long) ((step - current) * 0.75);
            assertTrue(latest < start);
            current = latest;
        }
        // The last seconds go straight to the target, so a late alarm is at most three seconds late.
        assertEquals(start, ScheduleWidgetProvider.countdownStepAt(today, start - 3_000L, display));
        // Once the class is on the steps close in on its end.
        assertEquals(start + (long) ((end - start) * 0.55), ScheduleWidgetProvider.countdownStepAt(today, start, display));
        assertEquals(end, ScheduleWidgetProvider.countdownStepAt(today, end - 2_000L, display));
        assertEquals(Long.MAX_VALUE, ScheduleWidgetProvider.countdownStepAt(today, end, display));
        display.showProgress = false;
        assertEquals(Long.MAX_VALUE, ScheduleWidgetProvider.countdownStepAt(today, now, display));
    }

    @Test
    public void theHomeScreenWidgetLeavesTheDigitsToTheChronometer() throws Exception {
        ScheduleWidgetOptions options = ScheduleWidgetOptions.defaults(WIDE);
        // 25 minutes before the afternoon class.
        ScheduleWidgetCardRenderer.Frame frame = frame(WIDE, false);
        frame.staticClock = false;
        ScheduleWidgetProvider.painterAt(payload(WEDNESDAY), WIDE, WEDNESDAY, (13 * 60 + 35) * 60, options).paint(frame);
        assertNotNull(frame.countdown);
        assertEquals(14 * 3600, frame.countdown.targetSecond);
        // In the left column, on the label's row under the date header.
        assertTrue(frame.countdown.right > 0.3f && frame.countdown.right < 0.5f);
        assertTrue(frame.countdown.bottom > 0.25f && frame.countdown.bottom < 0.5f);
        assertEquals(11f / 170f, frame.countdown.size, 0.0001f);

        // The class is on: the countdown runs to its end.
        frame = frame(WIDE, false);
        frame.staticClock = false;
        ScheduleWidgetProvider.painterAt(payload(WEDNESDAY), WIDE, WEDNESDAY, (14 * 60 + 30) * 60, options).paint(frame);
        assertEquals((15 * 60 + 40) * 60, frame.countdown.targetSecond);

        // More than an hour before, another day's classes, or the switch off: none.
        frame = frame(WIDE, false);
        frame.staticClock = false;
        ScheduleWidgetProvider.painterAt(payload(WEDNESDAY), WIDE, WEDNESDAY, 12 * 3600, options).paint(frame);
        assertNull(frame.countdown);
        frame = frame(WIDE, false);
        frame.staticClock = false;
        ScheduleWidgetProvider.painterAt(payload(WEDNESDAY), WIDE, WEDNESDAY, 21 * 3600, options).paint(frame);
        assertNull(frame.countdown);
        options.display.showProgress = false;
        frame = frame(WIDE, false);
        frame.staticClock = false;
        ScheduleWidgetProvider.painterAt(payload(WEDNESDAY), WIDE, WEDNESDAY, (14 * 60 + 30) * 60, options).paint(frame);
        assertNull(frame.countdown);

        // A larger text size moves the digits with everything else and scales them.
        options = ScheduleWidgetOptions.defaults(COMPACT);
        options.courseCount = 1;
        options.textSize = "large";
        frame = frame(COMPACT, false);
        frame.staticClock = false;
        ScheduleWidgetProvider.painterAt(payload(WEDNESDAY), COMPACT, WEDNESDAY, (14 * 60 + 30) * 60, options).paint(frame);
        assertNotNull(frame.countdown);
        assertEquals(11f * 1.12f / 170f, frame.countdown.size, 0.0001f);
        // Its right edge is the widget's margin, which the text size does not change.
        assertEquals((170f - 16f) / 170f, frame.countdown.right, 0.001f);
    }

    // MARK: which classes are listed

    @Test
    public void finishedClassesLeaveTheWindowWhenHidden() throws Exception {
        List<JSONObject> monday = courses(MONDAY);
        int afternoon = 14 * 60 + 30;
        // Kept while there is room, as before.
        ScheduleWidgetCardRenderer.CourseWindow kept = ScheduleWidgetCardRenderer.selectCourseWindow(monday, 7, afternoon, false);
        assertEquals(5, kept.courses.size());
        assertEquals(0, kept.skippedCompletedCount);
        // Hidden whether or not the rest would fit.
        ScheduleWidgetCardRenderer.CourseWindow hidden = ScheduleWidgetCardRenderer.selectCourseWindow(monday, 7, afternoon, true);
        assertEquals(3, hidden.courses.size());
        assertEquals("药物分析", hidden.courses.get(0).getString("name"));
        assertEquals(0, hidden.remainingCount);
        assertEquals(2, hidden.skippedCompletedCount);
        ScheduleWidgetCardRenderer.CourseWindow tight = ScheduleWidgetCardRenderer.selectCourseWindow(monday, 2, afternoon, true);
        assertEquals(2, tight.courses.size());
        assertEquals(1, tight.remainingCount);
        assertEquals(3, ScheduleWidgetCardRenderer.listedCount(monday, afternoon, true));
        assertEquals(5, ScheduleWidgetCardRenderer.listedCount(monday, afternoon, false));
        // Another day (no "now") hides nothing; after the last class nothing is left.
        assertEquals(5, ScheduleWidgetCardRenderer.listedCount(monday, -1, true));
        assertEquals(0, ScheduleWidgetCardRenderer.listedCount(monday, 21 * 60, true));
    }

    @Test
    public void aLargeTodayPreviewsTheNextDayInTheRoomThatIsLeft() throws Exception {
        int[] candidates = {3, 2, 1, ScheduleWidgetDisplay.PREVIEW_SUMMARY};
        float[] heights = {160f, 118f, 76f, 28f};
        assertEquals(3, ScheduleWidgetDisplay.previewRows(candidates, heights, 200f));
        assertEquals(2, ScheduleWidgetDisplay.previewRows(candidates, heights, 130f));
        assertEquals(1, ScheduleWidgetDisplay.previewRows(candidates, heights, 80f));
        assertEquals(ScheduleWidgetDisplay.PREVIEW_SUMMARY, ScheduleWidgetDisplay.previewRows(candidates, heights, 30f));
        assertEquals(0, ScheduleWidgetDisplay.previewRows(candidates, heights, 20f));

        // Wednesday has two classes: the timeline leaves room for Thursday's two.
        ScheduleWidgetOptions timeline = ScheduleWidgetOptions.defaults(TODAY_LARGE);
        assertEquals(2, previewRows(WEDNESDAY, 10 * 60 + 20, timeline));
        // 只看今天: no preview.
        timeline.todayOnly = true;
        assertEquals(0, previewRows(WEDNESDAY, 10 * 60 + 20, timeline));
        // A timeline of three or more fills the widget by itself: Monday's five and Tuesday's three do not preview.
        timeline.todayOnly = false;
        assertEquals(0, previewRows(MONDAY, 10 * 60 + 20, timeline));
        assertEquals(0, previewRows("2026-11-10", 10 * 60 + 20, timeline));
        // A list previews whenever there is room: none under Monday's five, Wednesday's two under Tuesday's three.
        ScheduleWidgetOptions list = ScheduleWidgetOptions.defaults(TODAY_LARGE);
        list.timeline = false;
        assertEquals(0, previewRows(MONDAY, 10 * 60 + 20, list));
        assertEquals(2, previewRows("2026-11-10", 10 * 60 + 20, list));
        assertEquals(2, previewRows(WEDNESDAY, 10 * 60 + 20, list));
        // Four of Monday's left to list: one line, the label followed by Tuesday's first class.
        list.display.hideCompleted = true;
        assertEquals(1, previewRows(MONDAY, 10 * 60 + 20, list));
        list.textSize = "large";
        assertEquals(ScheduleWidgetDisplay.PREVIEW_SUMMARY, previewRows(MONDAY, 10 * 60 + 20, list));
        // The medium size never previews.
        assertEquals(0, previewRows(WEDNESDAY, 10 * 60 + 20, ScheduleWidgetOptions.defaults(TODAY_WIDE), TODAY_WIDE));
    }

    // MARK: text size

    @Test
    public void textSizeScalesTheContentInsideTheSameWidget() throws Exception {
        for (ScheduleWidgetProvider.WidgetMode mode : new ScheduleWidgetProvider.WidgetMode[]{COMPACT, WIDE, TODAY_WIDE, TODAY_LARGE, TWO_DAY}) {
            ScheduleWidgetCardRenderer.Family family = ScheduleWidgetProvider.family(mode);
            for (String size : new String[]{"small", "standard", "large", "auto"}) {
                ScheduleWidgetOptions options = ScheduleWidgetOptions.defaults(mode);
                options.textSize = size;
                ScheduleWidgetCardRenderer.Frame frame = frame(mode, false);
                Bitmap bitmap = ScheduleWidgetProvider.painterAt(payload(MONDAY), mode, MONDAY, (10 * 60 + 20) * 60, options).paint(frame);
                // The picture is the widget's size whatever the text size.
                assertEquals(Math.round(family.width * 3), bitmap.getWidth());
                assertEquals(Math.round(family.height * 3), bitmap.getHeight());
                if (size.equals("small")) assertEquals(0.9f, frame.drawnScale, 0f);
                if (size.equals("standard")) assertEquals(1f, frame.drawnScale, 0f);
                if (size.equals("large")) assertEquals(1.12f, frame.drawnScale, 0f);
            }
        }
        // The canvas the content is laid out in shrinks as the text grows; the margin stays 16.
        ScheduleWidgetCardRenderer.Frame scaled = frame(TODAY_LARGE, false).scaled(1.12f);
        assertEquals(364f / 1.12f, scaled.width, 0.01f);
        assertEquals(382f / 1.12f, scaled.height, 0.01f);
        assertEquals(3f * 1.12f, scaled.scale, 0.001f);
        assertEquals(16f, scaled.padding() * scaled.textScale, 0.001f);
    }

    @Test
    public void adaptiveGrowsOnALightDayAndStaysStandardOnAFullOne() throws Exception {
        ScheduleWidgetOptions options = ScheduleWidgetOptions.defaults(TODAY_LARGE);
        options.textSize = "auto";
        options.timeline = false;
        // Friday morning: two classes and three of Monday's under them fit one size up, not two.
        ScheduleWidgetCardRenderer.Frame light = frame(TODAY_LARGE, false);
        ScheduleWidgetProvider.painterAt(payload(FRIDAY), TODAY_LARGE, FRIDAY, (8 * 60 + 30) * 60, options).paint(light);
        assertEquals(1.08f, light.drawnScale, 0f);
        assertFalse(light.tight);
        assertEquals(3, light.previewRows);
        // The one class left on Friday in the medium widget: the largest size.
        ScheduleWidgetOptions medium = ScheduleWidgetOptions.defaults(WIDE);
        medium.textSize = "auto";
        ScheduleWidgetCardRenderer.Frame one = frame(WIDE, false);
        ScheduleWidgetProvider.painterAt(payload(FRIDAY), WIDE, FRIDAY, (10 * 60 + 30) * 60, medium).paint(one);
        assertEquals(1.16f, one.drawnScale, 0f);
        // The small widget stays at the standard size: any larger and 「第10周」 no longer fits beside 11.13.
        ScheduleWidgetOptions small = ScheduleWidgetOptions.defaults(COMPACT);
        small.textSize = "auto";
        one = frame(COMPACT, false);
        ScheduleWidgetProvider.painterAt(payload(FRIDAY), COMPACT, FRIDAY, (10 * 60 + 30) * 60, small).paint(one);
        assertEquals(1f, one.drawnScale, 0f);
        // Monday: five classes fit at the standard size but not with Tuesday's three under them.
        ScheduleWidgetCardRenderer.Frame full = frame(TODAY_LARGE, false);
        ScheduleWidgetProvider.painterAt(payload(MONDAY), TODAY_LARGE, MONDAY, (8 * 60 + 30) * 60, options).paint(full);
        assertEquals(1f, full.drawnScale, 0f);
        // The two-day widget's Monday column: five rows fit one size up, not two.
        ScheduleWidgetOptions twoDay = ScheduleWidgetOptions.defaults(TWO_DAY);
        twoDay.textSize = "auto";
        ScheduleWidgetCardRenderer.Frame columns = frame(TWO_DAY, false);
        ScheduleWidgetProvider.painterAt(payload(MONDAY), TWO_DAY, MONDAY, (8 * 60 + 30) * 60, twoDay).paint(columns);
        assertEquals(1.08f, columns.drawnScale, 0f);
        assertFalse(columns.tight);
        // A large size on a full day shows fewer classes and counts the rest; nothing is pushed out.
        options.textSize = "large";
        full = frame(TODAY_LARGE, false);
        ScheduleWidgetProvider.painterAt(payload(MONDAY), TODAY_LARGE, MONDAY, (8 * 60 + 30) * 60, options).paint(full);
        assertEquals(1.12f, full.drawnScale, 0f);
        assertTrue(full.tight);
    }

    // MARK: gallery

    /** Every case of this change drawn once, in the four styles; looked at by a person, not asserted. */
    @Test
    public void drawsTheGallery() throws Exception {
        int beforeClass = (13 * 60 + 35) * 60;
        int inClass = (14 * 60 + 50) * 60 + 20;
        int morning = (10 * 60 + 20) * 60;
        for (String style : new String[]{"classic", "table", "paper", "board"}) {
            for (boolean dark : new boolean[]{false, true}) {
                String suffix = "_" + style + "_" + (dark ? "dark" : "light") + ".png";
                // 倒计时与进度
                draw("upcoming-small-1_in-class" + suffix, COMPACT, WEDNESDAY, inClass, style, dark, o -> o.courseCount = 1);
                draw("upcoming-small-1_before-class" + suffix, COMPACT, WEDNESDAY, beforeClass, style, dark, o -> o.courseCount = 1);
                draw("upcoming-small-2_in-class" + suffix, COMPACT, MONDAY, inClass, style, dark, o -> { });
                draw("upcoming-medium_in-class" + suffix, WIDE, MONDAY, inClass, style, dark, o -> { });
                draw("upcoming-medium_before-class" + suffix, WIDE, WEDNESDAY, beforeClass, style, dark, o -> { });
                draw("today-medium_in-class" + suffix, TODAY_WIDE, WEDNESDAY, inClass, style, dark, o -> { });
                draw("today-large-timeline_in-class" + suffix, TODAY_LARGE, MONDAY, inClass, style, dark, o -> { });
                draw("today-large-list_in-class" + suffix, TODAY_LARGE, MONDAY, inClass, style, dark, o -> o.timeline = false);
                draw("twoday-list_in-class" + suffix, TWO_DAY, MONDAY, inClass, style, dark, o -> { });
                draw("twoday-timeline_in-class" + suffix, TWO_DAY, MONDAY, inClass, style, dark, o -> o.timeline = true);
                // 下一次课预告
                draw("today-large-timeline_preview" + suffix, TODAY_LARGE, WEDNESDAY, morning, style, dark, o -> { });
                draw("today-large-list_preview" + suffix, TODAY_LARGE, WEDNESDAY, morning, style, dark, o -> o.timeline = false);
                draw("today-large-list_preview-one" + suffix, TODAY_LARGE, MONDAY, morning, style, dark, o -> {
                    o.timeline = false;
                    o.display.hideCompleted = true;
                });
                draw("today-large-list_preview-summary" + suffix, TODAY_LARGE, MONDAY, morning, style, dark, o -> {
                    o.timeline = false;
                    o.display.hideCompleted = true;
                    o.textSize = "large";
                });
                // 隐藏已上完的课、不标课间、不显示周次、不常驻假期
                draw("today-large-timeline_hidden" + suffix, TODAY_LARGE, MONDAY, inClass, style, dark, o -> {
                    o.display.hideCompleted = true;
                    o.display.showBreaks = false;
                    o.display.showWeek = false;
                    o.display.holidayAlwaysVisible = false;
                });
                draw("twoday-list_hidden" + suffix, TWO_DAY, MONDAY, 21 * 3600, style, dark, o -> {
                    o.display.hideCompleted = true;
                    o.tomorrow = true;
                });
                draw("today-medium_hidden-today-only" + suffix, TODAY_WIDE, MONDAY, 21 * 3600, style, dark, o -> {
                    o.display.hideCompleted = true;
                    o.todayOnly = true;
                });
                if (!style.equals("classic") && dark) continue;
                // 文字大小
                for (String size : new String[]{"small", "large", "auto"}) {
                    String tail = "_" + size + suffix;
                    draw("size_upcoming-small-2" + tail, COMPACT, MONDAY, inClass, style, dark, o -> o.textSize = size);
                    draw("size_upcoming-small-1" + tail, COMPACT, WEDNESDAY, inClass, style, dark, o -> { o.textSize = size; o.courseCount = 1; });
                    draw("size_upcoming-medium" + tail, WIDE, WEDNESDAY, beforeClass, style, dark, o -> o.textSize = size);
                    draw("size_today-medium" + tail, TODAY_WIDE, MONDAY, inClass, style, dark, o -> o.textSize = size);
                    draw("size_today-large-timeline-full" + tail, TODAY_LARGE, MONDAY, inClass, style, dark, o -> o.textSize = size);
                    draw("size_today-large-timeline-light" + tail, TODAY_LARGE, FRIDAY, (8 * 60 + 30) * 60, style, dark, o -> o.textSize = size);
                    draw("size_today-large-list-full" + tail, TODAY_LARGE, MONDAY, inClass, style, dark, o -> { o.textSize = size; o.timeline = false; });
                    draw("size_twoday-list" + tail, TWO_DAY, MONDAY, inClass, style, dark, o -> o.textSize = size);
                    draw("size_twoday-timeline" + tail, TWO_DAY, MONDAY, inClass, style, dark, o -> { o.textSize = size; o.timeline = true; });
                    draw("size_rest-small" + tail, COMPACT, "2026-11-14", morning, style, dark, o -> { o.textSize = size; o.todayOnly = true; });
                }
            }
        }
    }

    private interface Adjust {
        void apply(ScheduleWidgetOptions options);
    }

    private static void draw(String name, ScheduleWidgetProvider.WidgetMode mode, String date, int seconds, String style,
            boolean dark, Adjust adjust) throws Exception {
        ScheduleWidgetOptions options = ScheduleWidgetOptions.defaults(mode);
        adjust.apply(options);
        ScheduleWidgetCardRenderer.Frame frame = ScheduleWidgetCardRenderer.Frame.of(
                ScheduleWidgetProvider.family(mode), 3f, new ScheduleWidgetPalette(null, dark, style));
        Bitmap content = ScheduleWidgetProvider.painterAt(payload(date), mode, date, seconds, options).paint(frame);
        int margin = 30;
        Bitmap output = Bitmap.createBitmap(content.getWidth() + margin * 2, content.getHeight() + margin * 2, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(output);
        canvas.drawColor(dark ? Color.rgb(26, 26, 26) : Color.rgb(217, 217, 217));
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setColor(new ScheduleWidgetPalette(null, dark).background());
        canvas.drawRoundRect(new RectF(margin, margin, margin + content.getWidth(), margin + content.getHeight()), 66f, 66f, paint);
        canvas.drawBitmap(content, margin, margin, null);
        File file = new File("build/reports/widget-previews/parity/" + name);
        assertTrue(file.getParentFile().exists() || file.getParentFile().mkdirs());
        try (FileOutputStream stream = new FileOutputStream(file)) {
            assertTrue(output.compress(Bitmap.CompressFormat.PNG, 100, stream));
        }
    }

    private static ScheduleWidgetCardRenderer.Frame frame(ScheduleWidgetProvider.WidgetMode mode, boolean dark) {
        return ScheduleWidgetCardRenderer.Frame.of(ScheduleWidgetProvider.family(mode), 3f, new ScheduleWidgetPalette(null, dark));
    }

    private static int previewRows(String date, int minutes, ScheduleWidgetOptions options) throws Exception {
        return previewRows(date, minutes, options, TODAY_LARGE);
    }

    private static int previewRows(String date, int minutes, ScheduleWidgetOptions options, ScheduleWidgetProvider.WidgetMode mode) throws Exception {
        ScheduleWidgetCardRenderer.Frame frame = frame(mode, false);
        ScheduleWidgetProvider.painterAt(payload(date), mode, date, minutes * 60, options).paint(frame);
        return frame.previewRows;
    }

    private static JSONObject payload(String date) throws Exception {
        return ScheduleWidgetLocalDays.payload(ScheduleWidgetCardRendererTest.snapshotRecord(), date);
    }

    private static List<JSONObject> courses(String date) throws Exception {
        JSONArray source = ScheduleWidgetProvider.dayForDate(payload(date), date).getJSONArray("courses");
        List<JSONObject> courses = new ArrayList<>();
        for (int index = 0; index < source.length(); index++) courses.add(source.getJSONObject(index));
        return courses;
    }

    private static long at(String date, int hour, int minute) {
        Calendar calendar = Calendar.getInstance();
        calendar.clear();
        calendar.set(Integer.parseInt(date.substring(0, 4)), Integer.parseInt(date.substring(5, 7)) - 1,
                Integer.parseInt(date.substring(8, 10)), hour, minute, 0);
        return calendar.getTimeInMillis();
    }
}
